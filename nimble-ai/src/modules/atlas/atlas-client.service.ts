import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosInstance } from 'axios';
import { createRetryableHttpClient, formatHttpError } from '../../common/http/retryable-http-client';
import { BillingService, MediaKind } from '../billing/billing.service';
import { RedisService } from '../redis/redis.service';

/**
 * 状态查询单独用短超时。客户端默认超时是给提交请求的（ATLASCLOUD_TIMEOUT，默认 5 分钟），
 * 再叠加 GET 的 2 次重试，一次挂起的轮询会空等约 15 分钟，Atlas 完成后界面仍显示生成中。
 */
const PREDICTION_QUERY_TIMEOUT_MS = 20_000;

export type AtlasPredictionState = 'pending' | 'running' | 'succeeded' | 'failed';

export interface AtlasPredictionResult {
  state: AtlasPredictionState;
  outputs: string[];
  error?: string;
  /**
   * 本地等待到点，但 Atlas 仍是 pending/running。
   * 调用方要求交棒时不退款、不把任务判死，等回调或对账写入终态。
   */
  pending?: boolean;
}

/**
 * 模型平台API 统一模型调用客户端
 *
 * 覆盖图片 / 视频 / 音频三类生成的提交与轮询：`POST /model/generate{Image,Video,Audio}` 立即返回
 * `prediction_id`，真正结果通过 `GET /model/prediction/{id}` 轮询取得；两个接口返回的终态结构一致，
 * 统一在 `normalizePrediction` 里解析，图片/视频/音频三类 Provider 不用各写一套状态解析代码。
 *
 * Webhook（生产环境有公网域名后可开启，见 ATLAS_WEBHOOK_ENABLED）与轮询共用同一套"提交时可选携带
 * webhook_url"的机制：`buildWebhookUrl()` 未配置时返回 undefined，调用方按现有轮询工作，语义上零差异。
 */
@Injectable()
export class AtlasClientService {
  private readonly logger = new Logger(AtlasClientService.name);
  readonly http: AxiosInstance;
  readonly configured: boolean;
  readonly webhookEnabled: boolean;
  private readonly webhookPublicUrl: string;
  /** webhook 到达时唤醒正在 pollUntilDone 等待该 prediction 的调用方（一键成片的同步轮询） */
  private readonly waiters = new Map<string, Array<() => void>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly billing: BillingService,
    private readonly redis: RedisService,
  ) {
    const apiKey = this.configService.get<string>('ATLASCLOUD_API_KEY', '');
    this.configured = Boolean(apiKey);
    this.http = createRetryableHttpClient({
      baseURL: this.configService.get<string>('ATLASCLOUD_BASE_URL', 'https://api.atlascloud.ai/api/v1'),
      apiKey,
      // 图片/视频生成耗时可能较长（尤其多参考图/高分辨率场景），默认给足 5 分钟；
      // 调用方均是异步落库、不阻塞 HTTP 响应，这里放宽超时只是兜底网络异常
      timeoutMs: Number(this.configService.get<string>('ATLASCLOUD_TIMEOUT', '300000')),
      logger: new Logger(AtlasClientService.name),
    });
    this.webhookEnabled = this.configService.get<string>('ATLAS_WEBHOOK_ENABLED', 'false') === 'true';
    this.webhookPublicUrl = this.configService.get<string>('ATLAS_WEBHOOK_PUBLIC_URL', '');
    if (this.webhookEnabled && !this.webhookPublicUrl) {
      this.logger.warn('ATLAS_WEBHOOK_ENABLED=true 但未配置 ATLAS_WEBHOOK_PUBLIC_URL，本次启动将按轮询模式运行');
      this.webhookEnabled = false;
    }
  }

  assertConfigured(): void {
    if (!this.configured) throw new Error('未配置 ATLASCLOUD_API_KEY，无法调用 模型平台API 模型');
  }

  /** 未开启 webhook（默认，或未部署公网域名）时返回 undefined，调用方不传该字段、沿用轮询 */
  buildWebhookUrl(): string | undefined {
    return this.webhookEnabled ? this.webhookPublicUrl : undefined;
  }

  /**
   * 所有付费生成的唯一出口，计费在这里统一处理：先扣款再提交，提交失败立刻退回；
   * 提交成功后凭证按 prediction id 保存。Atlas 返回失败时退款，成功时结清。
   * 本地停止等待不会退款。
   * 余额不足会在扣款这一步抛 402，原样往外传，不会被包装成普通错误。
   */
  private async submit(
    kind: MediaKind,
    path: string,
    body: Record<string, unknown>,
    bill = true,
  ): Promise<string> {
    this.assertConfigured();
    const ticket = bill ? await this.billing.chargeMedia(kind, body) : null;
    try {
      const { data } = await this.http.post(path, body);
      const predictionId = data?.data?.id ?? data?.id;
      if (!predictionId) {
        this.logger.error(`${path} 响应缺少 prediction id: ${JSON.stringify(data)}`);
        throw new Error('任务创建失败：模型未返回任务 ID');
      }
      await this.billing.bind(ticket, String(predictionId));
      return String(predictionId);
    } catch (error) {
      await this.billing.refund(ticket);
      throw new Error(formatHttpError(error));
    }
  }

  /** 提交图片生成任务，返回 prediction id */
  submitImage(body: Record<string, unknown>): Promise<string> {
    return this.submit('image', '/model/generateImage', body);
  }

  /**
   * 提交视频生成任务，返回 prediction id。
   * bill=false 时由调用方按用户所选规格自行扣费，避免和内部生成规格的询价混在一起。
   */
  submitVideo(body: Record<string, unknown>, options?: { bill?: boolean }): Promise<string> {
    return this.submit('video', '/model/generateVideo', body, options?.bill !== false);
  }

  /** 提交音频（TTS/音乐）生成任务，返回 prediction id */
  submitAudio(body: Record<string, unknown>): Promise<string> {
    return this.submit('audio', '/model/generateAudio', body);
  }

  /** 供业务层在确认这笔任务不会再成功时退款。本地轮询到点不能调用。 */
  releaseTask(predictionId: string): Promise<void> {
    return this.billing.refundTask(predictionId);
  }

  /**
   * 拉取 Atlas 实时目录 id（媒体 GET /api/v1/models 的 `model` + LLM GET /v1/models 的 `id`）。
   * 只用于启动核对 atlas-models.json，网络失败由调用方忽略，不阻断服务启动。
   */
  async fetchLiveModelIds(): Promise<Set<string>> {
    this.assertConfigured();
    const ids = new Set<string>();
    const { data } = await this.http.get('/models');
    const media = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    for (const item of media) {
      if (item && typeof item.model === 'string') ids.add(item.model);
    }
    const llmBase = this.configService.get<string>('ATLASCLOUD_LLM_BASE_URL', 'https://api.atlascloud.ai/v1').replace(/\/$/, '');
    const apiKey = this.configService.get<string>('ATLASCLOUD_API_KEY', '');
    const res = await fetch(`${llmBase}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`LLM 目录 HTTP ${res.status}`);
    const llmJson = (await res.json()) as { data?: Array<{ id?: string }> };
    for (const item of llmJson.data ?? []) {
      if (typeof item?.id === 'string') ids.add(item.id);
    }
    return ids;
  }

  /**
   * 查询任务状态。settle=false 时成功先不结清扣款，留给后续内部步骤失败时退回。
   * 失败始终退款。网络异常直接抛出，由轮询稍后重试。
   */
  async getPrediction(predictionId: string, options?: { settle?: boolean }): Promise<AtlasPredictionResult> {
    this.assertConfigured();
    let result: AtlasPredictionResult;
    try {
      const { data } = await this.http.get(`/model/prediction/${predictionId}`, {
        timeout: PREDICTION_QUERY_TIMEOUT_MS,
      });
      result = this.normalizePrediction(data?.data ?? data);
    } catch (error) {
      throw new Error(formatHttpError(error));
    }
    const settle = options?.settle !== false;
    if (result.state === 'succeeded' && settle) await this.billing.settle(predictionId);
    if (result.state === 'failed') await this.billing.refundTask(predictionId);
    if (result.state === 'succeeded' || result.state === 'failed') await this.clearUnsettled(predictionId);
    return result;
  }

  private normalizePrediction(data: Record<string, unknown> | undefined): AtlasPredictionResult {
    const status = String(data?.status ?? '').toLowerCase();
    const outputs = Array.isArray(data?.outputs) ? (data!.outputs as unknown[]).map(String) : [];
    if (status === 'completed' || status === 'succeeded') {
      return { state: 'succeeded', outputs };
    }
    if (status === 'failed' || status === 'timeout' || status === 'cancelled') {
      const error = typeof data?.error === 'string' && data.error ? data.error : `任务${status || '失败'}`;
      return { state: 'failed', outputs, error };
    }
    if (status === 'queued' || status === 'created' || status === 'pending') {
      return { state: 'pending', outputs };
    }
    return { state: 'running', outputs };
  }

  /**
   * Webhook 到达时立刻唤醒正在等待该 prediction 的 pollUntilDone。
   * session_id 与 submit 返回的 prediction_id 是同一值。
   * 返回 true 表示当时确实有人在等；没有则调用方要把终态交给业务 handler 落库。
   */
  wakePrediction(predictionId: string): boolean {
    const pending = this.waiters.get(predictionId);
    if (!pending?.length) return false;
    this.waiters.delete(predictionId);
    for (const wake of pending) wake();
    return true;
  }

  /** 本进程里是否还有 pollUntilDone 挂在这个任务上。有的话对账不要抢着落库。 */
  hasWaiter(predictionId: string): boolean {
    return (this.waiters.get(predictionId)?.length ?? 0) > 0;
  }

  /**
   * 轮询直到终态，或直到调用方给出的等待上限。
   * Webhook 只在 Atlas 进入终态时发送，只能提前唤醒下一次查询。
   * 上限到达时若上游仍在处理：不退款。扣款只在 Atlas 返回失败时撤销，成功时结清。
   * 返回 pending，调用方要保持「生成中」，或把 prediction 留给回调和对账。
   */
  async pollUntilDone(
    predictionId: string,
    options: { timeoutMs: number; intervalMs: number },
  ): Promise<AtlasPredictionResult> {
    const deadline = Date.now() + options.timeoutMs;
    for (;;) {
      let result: AtlasPredictionResult;
      try {
        result = await this.getPrediction(predictionId);
      } catch (error) {
        if (Date.now() < deadline) {
          this.logger.warn(
            `查询生成任务失败，稍后重试 prediction=${predictionId}: ${error instanceof Error ? error.message : error}`,
          );
          await this.waitForNextPoll(predictionId, options.intervalMs);
          continue;
        }
        await this.noteUnsettled(predictionId);
        this.logger.warn(`查询失败且 Atlas 未确认终态，不退款 prediction=${predictionId}`);
        return { state: 'running', outputs: [], error: '生成仍在进行', pending: true };
      }
      if (result.state === 'succeeded' || result.state === 'failed') return result;
      if (Date.now() >= deadline) {
        await this.noteUnsettled(predictionId);
        this.logger.warn(`本地停止等待，Atlas 仍在处理，不退款 prediction=${predictionId}`);
        return { state: 'running', outputs: [], error: '生成仍在进行', pending: true };
      }
      await this.waitForNextPoll(predictionId, options.intervalMs);
    }
  }

  /** 本地已经不再阻塞等待、但 Atlas 还没给终态的任务。对账会再查，成功结清、失败才退款。 */
  async listUnsettled(): Promise<string[]> {
    try {
      return await this.redis.getClient().smembers('atlas:unsettled');
    } catch (error) {
      this.logger.warn(`读取未结任务失败: ${error instanceof Error ? error.message : error}`);
      return [];
    }
  }

  private async noteUnsettled(predictionId: string): Promise<void> {
    try {
      await this.redis.getClient().sadd('atlas:unsettled', predictionId);
    } catch (error) {
      this.logger.warn(`记录未结任务失败 prediction=${predictionId}: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async clearUnsettled(predictionId: string): Promise<void> {
    try {
      await this.redis.getClient().srem('atlas:unsettled', predictionId);
    } catch (error) {
      this.logger.warn(`清除未结任务失败 prediction=${predictionId}: ${error instanceof Error ? error.message : error}`);
    }
  }

  private waitForNextPoll(predictionId: string, intervalMs: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timer = setTimeout(settle, intervalMs);
      const onWake = () => {
        clearTimeout(timer);
        settle();
      };
      const list = this.waiters.get(predictionId) ?? [];
      list.push(onWake);
      this.waiters.set(predictionId, list);
    });
  }
}
