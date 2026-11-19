import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosInstance } from 'axios';
import { createRetryableHttpClient, formatHttpError } from '../../common/http/retryable-http-client';
import { UpstreamTask } from './ark-client.service';

/**
 * MiniMax 官方视频，国内开放平台。H3 走 v2：content 数组提交，成功后从 content.url 取地址。
 */
@Injectable()
export class MinimaxClientService {
  private readonly logger = new Logger(MinimaxClientService.name);
  private readonly http: AxiosInstance;
  readonly configured: boolean;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('MINIMAX_API_KEY', '');
    this.configured = Boolean(apiKey);
    this.http = createRetryableHttpClient({
      baseURL: config.get<string>('MINIMAX_BASE_URL', 'https://api.minimax.cn'),
      apiKey,
      timeoutMs: Number(config.get<string>('MINIMAX_TIMEOUT', '120000')),
      logger: this.logger,
    });
  }

  assertConfigured(): void {
    if (!this.configured) throw new Error('未配置 MINIMAX_API_KEY，无法调用 MiniMax');
  }

  async submitVideo(body: Record<string, unknown>): Promise<string> {
    this.assertConfigured();
    try {
      const { data } = await this.http.post('/v2/video_generation', body);
      const id = data?.task_id ?? data?.data?.task_id ?? data?.id;
      if (!id) throw new Error(data?.base_resp?.status_msg || '任务创建失败：模型未返回任务 ID');
      return String(id);
    } catch (error) {
      throw new Error(formatHttpError(error));
    }
  }

  async getVideo(taskId: string): Promise<UpstreamTask> {
    this.assertConfigured();
    try {
      const data = await this.fetchTask(taskId);
      const task = (data.task as Record<string, unknown> | undefined) ?? (data.data as Record<string, unknown> | undefined) ?? data;
      const status = String(task.status ?? data.status ?? '').toLowerCase();
      const url = await this.pickUrl(task, data);
      if (['success', 'succeeded', 'completed'].includes(status)) {
        return url ? { state: 'succeeded', url } : { state: 'running' };
      }
      if (['fail', 'failed', 'error', 'cancelled'].includes(status)) {
        const base = data.base_resp as { status_msg?: string } | undefined;
        const rawError = task.error;
        const message = typeof rawError === 'string'
          ? rawError
          : (rawError as { message?: string } | undefined)?.message || base?.status_msg;
        return { state: 'failed', error: message || '视频生成失败' };
      }
      return { state: 'running' };
    } catch (error) {
      throw new Error(formatHttpError(error));
    }
  }

  /** 新接口把结果包在 task 里；旧接口是查询参数。新接口没有这笔任务时再查旧接口。 */
  private async fetchTask(taskId: string): Promise<Record<string, unknown>> {
    try {
      const { data } = await this.http.get(`/v2/query/video_generation/${taskId}`, { timeout: 20_000 });
      return (data ?? {}) as Record<string, unknown>;
    } catch (error) {
      const message = formatHttpError(error);
      if (!/404|not found|invalid task/i.test(message)) throw error;
      const { data } = await this.http.get('/v1/query/video_generation', {
        params: { task_id: taskId },
        timeout: 20_000,
      });
      return (data ?? {}) as Record<string, unknown>;
    }
  }

  private async pickUrl(task: Record<string, unknown>, data: Record<string, unknown>): Promise<string | undefined> {
    const content = (task.content ?? data.content) as { url?: string } | undefined;
    const direct = content?.url ?? (task.video_url as string | undefined) ?? (data.video_url as string | undefined) ?? (data.download_url as string | undefined);
    if (typeof direct === 'string' && direct) return direct;
    const fileId = task.file_id ?? data.file_id ?? (data.data as { file_id?: string } | undefined)?.file_id;
    if (!fileId) return undefined;
    const { data: file } = await this.http.get('/v1/files/retrieve', {
      params: { file_id: fileId },
      timeout: 20_000,
    });
    const url = file?.file?.download_url ?? file?.download_url;
    return typeof url === 'string' ? url : undefined;
  }
}
