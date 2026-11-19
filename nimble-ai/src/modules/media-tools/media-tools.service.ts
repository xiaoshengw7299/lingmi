import { randomUUID } from 'crypto';
import { createReadStream, createWriteStream, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { AtlasModelRegistryService } from '../atlas/atlas-model-registry.service';
import { runWithBilling } from '../billing/billing-context';
import { BillingService } from '../billing/billing.service';
import { GenerationService } from '../generation/generation.service';
import { FfmpegService } from '../media-pipeline/ffmpeg.service';
import { PricingService } from '../pricing/pricing.service';
import { MediaKitClientService } from '../providers/mediakit-client.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage';
import { MediaToolOutput, MediaToolTask } from './entities/media-tool-task.entity';
import { CloneGenerateDto, ListToolTasksDto, RunToolDto } from './media-tools.dto';
import { findTool, MEDIA_TOOLS, priceRuleId, RawOutput, ToolContext, ToolDef, ToolMode } from './media-tools.catalog';
import { EXAMPLE_PREFIX } from './media-tools.content';
import { buildBody, normalizeInputs, normalizeValues, presentTool } from './media-tools.schema';

const SWEEP_INTERVAL_MS = 20_000;
/** 前端轮询时最多这么久问一次上游 */
const POLL_GAP_SEC = 4;
const LOCK_SEC = 600;
/** 同步工具在进程内执行，进程重启会丢；超过这个时间还没结果就判失败退款 */
const SYNC_TIMEOUT_MS = 15 * 60_000;
/** 上游查询只保留 30 天，3 天还没结束的任务按失败处理 */
const ASYNC_TIMEOUT_MS = 3 * 24 * 3600_000;
/** 和 MediaKit 本地上传文件的有效期一致 */
const FILE_TTL_SEC = 30 * 24 * 3600;
const CENT_EPSILON = 1e-6;
const CLONE_TOOL = 'viral-clone';
const REF_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_EXT: Record<RawOutput['kind'], string> = { video: 'mp4', image: 'png', audio: 'mp3', file: 'bin' };
const CONTENT_TYPE: Record<string, string> = { mp4: 'video/mp4', json: 'application/json' };
const EXT_BY_TYPE: Record<string, string> = {
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
};

/** 写回 TOS 时 MediaKit 没有访问权限，例如：AssumeRole error: RoleNotExist */
const WRITEBACK_DENIED = /output writeback failed|AssumeRole|RoleNotExist/i;
const fileKey = (fileId: string) => `mtool:file:${fileId}`;
const toCents = (yuan: number) => (yuan <= 0 ? 0 : Math.max(1, Math.ceil(yuan * 100 - CENT_EPSILON)));
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error ?? ''));

/**
 * 视频工具 / 通用工具：按目录校验参数、预扣费、提交 MediaKit、收结果。
 * 异步任务靠三条路收尾：前端轮询、MediaKit 回调、20 秒一次的对账，谁先到谁处理，Redis 锁保证只处理一次。
 */
@Injectable()
export class MediaToolsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaToolsService.name);
  private readonly callbackUrl: string;
  /** 结果直接写回本桶。控制台没授权时会失败，失败一次后本进程内改为服务端转存 */
  private writeback: boolean;
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(MediaToolTask) private readonly repo: Repository<MediaToolTask>,
    private readonly mediakit: MediaKitClientService,
    private readonly storage: StorageService,
    private readonly billing: BillingService,
    private readonly pricing: PricingService,
    private readonly redis: RedisService,
    private readonly ffmpeg: FfmpegService,
    private readonly generation: GenerationService,
    private readonly registry: AtlasModelRegistryService,
    config: ConfigService,
  ) {
    this.callbackUrl = config.get<string>('MEDIAKIT_CALLBACK_URL', '').trim();
    this.writeback = config.get<string>('MEDIAKIT_TOS_WRITEBACK', 'true') !== 'false';
  }

  async onModuleInit() {
    await this.ensureSchema();
    this.timer = setInterval(() => void this.sweep().catch((error) => this.logger.error(`工具任务对账失败：${messageOf(error)}`)), SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ───────────────────────── 目录与报价 ─────────────────────────

  async catalog() {
    const unitPrices = new Map<ToolMode, number>();
    for (const tool of MEDIA_TOOLS) {
      for (const mode of tool.modes) unitPrices.set(mode, (await this.rate(tool, mode)).unitPrice);
    }
    const exampleUrl = (key: string) => this.storage.getPublicUrl(`${EXAMPLE_PREFIX}/${key}`);
    return MEDIA_TOOLS.map((tool) => presentTool(tool, (mode) => unitPrices.get(mode) ?? 0, exampleUrl));
  }

  /** 提交前的预估价。参数还没填完时返回 null，不报错打扰用户 */
  async quote(userId: string, dto: RunToolDto): Promise<{ cents: number | null }> {
    const { tool, mode } = this.find(dto);
    try {
      const ctx = await this.context(userId, mode, dto);
      return { cents: (await this.price(tool, mode, ctx)).cents };
    } catch {
      return { cents: null };
    }
  }

  // ───────────────────────── 上传与提交 ─────────────────────────

  /** 浏览器直传 MediaKit 的地址。记下文件归属，提交时只认自己上传的文件 */
  async uploadUrl(userId: string) {
    const upload = await this.mediakit.requestUpload();
    await this.redis.set(fileKey(upload.fileId), userId, FILE_TTL_SEC);
    return upload;
  }

  async create(userId: string, dto: RunToolDto) {
    const { tool, mode } = this.find(dto);
    this.mediakit.assertConfigured();
    const ctx = await this.context(userId, mode, dto);
    const problem = mode.check?.(ctx);
    if (problem) throw new BadRequestException(problem);
    await this.assertOwnFiles(userId, mode, ctx);
    const quote = await this.price(tool, mode, ctx);
    const body = buildBody(mode, ctx);

    const record = await this.repo.save(
      this.repo.create({
        userId,
        tool: tool.id,
        mode: mode.id,
        status: 'running',
        params: { inputs: ctx.inputs, values: ctx.values },
        outputs: [],
        chargeCents: quote.cents,
        prepaidCny: quote.official,
      }),
    );
    try {
      const ticket = await this.billing.chargeQuoted('tool', {
        model: quote.ruleId,
        modelName: this.label(tool, mode),
        cents: quote.cents,
        upstreamCents: quote.official * 100,
      });
      await this.billing.bind(ticket, record.id);
    } catch (error) {
      await this.repo.delete(record.id);
      throw error;
    }

    const [channel, name] = mode.path.split('/');
    if (channel === 'tools-sync') {
      void this.runSync(record, name, body);
      return this.present(record);
    }
    try {
      record.upstreamId = await this.submit(record, name, body, mode.tos && this.writeback);
      await this.repo.update(record.id, { upstreamId: record.upstreamId });
    } catch (error) {
      await this.fail(record, error);
      throw new BadRequestException(`提交失败：${messageOf(error)}，费用已退回`);
    }
    return this.present(record);
  }

  // ───────────────────────── 记录 ─────────────────────────

  async list(userId: string, query: ListToolTasksDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await this.repo.findAndCount({
      where: { userId, tool: query.tool, ...(query.succeeded ? { status: 'succeeded' as const } : {}) },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: items.map((item) => this.present(item)), total, page, pageSize };
  }

  async get(userId: string, id: string) {
    let record = await this.owned(userId, id);
    if (record.status === 'running' && (await this.claim(`mtool:poll:${id}`, POLL_GAP_SEC))) {
      await this.refresh(record);
      record = await this.owned(userId, id);
    }
    return this.present(record, await this.generations(record));
  }

  async remove(userId: string, id: string) {
    const record = await this.owned(userId, id);
    if (record.status === 'running') throw new BadRequestException('任务处理中，完成后再删除');
    for (const taskId of this.generationIds(record)) await this.generation.remove(userId, taskId);
    await this.repo.delete(record.id);
    await this.storage.removePrefix(this.dir(record));
  }

  // ───────────────────────── 爆款复刻：用动作视频生成 ─────────────────────────

  async cloneGenerate(userId: string, id: string, dto: CloneGenerateDto) {
    const record = await this.owned(userId, id);
    const motion = record.outputs.find((item) => item.kind === 'video');
    if (record.tool !== CLONE_TOOL || record.status !== 'succeeded' || !motion) throw new BadRequestException('请等动作捕捉完成后再生成');
    const model = await this.registry.resolveModel('video', dto.modelId);
    if (!model.maxReferenceVideos) throw new BadRequestException(`${model.name.replace('|', ' ')} 不支持参考视频，请换一个模型`);
    const motionSec = Number(record.data?.durationSec) || record.params.inputs.video?.[0]?.durationSec || 0;
    if (motionSec > model.maxReferenceDurationSec + 0.5) {
      throw new BadRequestException(`所选模型的参考视频最长 ${model.maxReferenceDurationSec} 秒，请换模型或上传更短的视频`);
    }
    const refImages = (dto.refImages ?? []).map((key) => this.storage.toObjectName(key));
    if (refImages.some((key) => !key.startsWith(`${this.dir(record)}/`))) throw new BadRequestException('参考图无效，请重新上传');

    const task = await this.generation.create(userId, {
      kind: 'video',
      prompt: dto.prompt,
      modelId: model.id,
      ratio: dto.ratio,
      resolution: dto.resolution,
      durationSec: dto.durationSec ?? Math.max(model.minDuration, Math.min(model.maxDuration, Math.round(motionSec) || model.minDuration)),
      generateAudio: dto.generateAudio ?? false,
      refVideos: [motion.key],
      refImages,
    });
    const data = { ...(record.data ?? {}), generations: [task.id, ...this.generationIds(record)] };
    await this.repo.update(record.id, { data });
    return task;
  }

  /** 爆款复刻的人物 / 商品参考图，放在记录目录下，删记录时一起删 */
  async uploadRef(userId: string, id: string, file: Express.Multer.File) {
    const record = await this.owned(userId, id);
    if (record.tool !== CLONE_TOOL) throw new BadRequestException('当前工具不支持参考图');
    if (!file?.mimetype?.startsWith('image/')) throw new BadRequestException('请上传图片');
    if (file.size > REF_IMAGE_MAX_BYTES) throw new BadRequestException('图片不能超过 10MB');
    const ext = (/\.([a-z0-9]{2,5})$/i.exec(file.originalname)?.[1] ?? 'png').toLowerCase();
    const key = await this.storage.upload(`${this.dir(record)}/ref-${randomUUID()}.${ext}`, file.buffer, file.mimetype);
    return { key, url: this.storage.toPublicUrl(key) };
  }

  // ───────────────────────── 收尾 ─────────────────────────

  /** MediaKit 回调没有签名，只当作「去查一次」的信号 */
  async onCallback(taskId: string) {
    const record = await this.repo.findOne({ where: { upstreamId: taskId } });
    if (record) await this.refresh(record);
  }

  private async sweep() {
    const records = await this.repo.find({
      where: { status: 'running', updatedAt: LessThan(new Date(Date.now() - SWEEP_INTERVAL_MS)) },
      order: { updatedAt: 'ASC' },
      take: 20,
    });
    for (const record of records) await this.refresh(record);
  }

  private async refresh(record: MediaToolTask) {
    if (record.status !== 'running') return;
    const age = Date.now() - new Date(record.createdAt).getTime();
    if (!record.upstreamId) {
      if (age > SYNC_TIMEOUT_MS) await this.fail(record, '处理超时');
      return;
    }
    if (!(await this.claim(`mtool:lock:${record.id}`, LOCK_SEC))) return;
    try {
      const task = await this.mediakit.task(record.upstreamId);
      if (task.status === 'completed') await this.finalize(record, task.result ?? {});
      else if (task.status === 'failed' && WRITEBACK_DENIED.test(task.error ?? '') && !record.data?.retried) await this.retryWithoutWriteback(record);
      else if (task.status === 'failed') await this.fail(record, task.error);
      else if (age > ASYNC_TIMEOUT_MS) await this.fail(record, '处理超时');
      else await this.repo.update({ id: record.id, status: 'running' }, { updatedAt: new Date() });
    } catch (error) {
      this.logger.warn(`工具任务回查失败 record=${record.id}：${messageOf(error)}`);
      await this.repo.update({ id: record.id, status: 'running' }, { updatedAt: new Date() });
    } finally {
      await this.redis.del(`mtool:lock:${record.id}`);
    }
  }

  private submit(record: MediaToolTask, name: string, body: Record<string, unknown>, writeback: boolean, attempt = 0): Promise<string> {
    return this.mediakit.submit(name, {
      ...body,
      ...(writeback ? { media_output_destination: this.storage.toTosUri(this.dir(record)) } : {}),
      ...(this.callbackUrl ? { callback_url: this.callbackUrl } : {}),
      client_token: attempt ? `${record.id}-${attempt}` : record.id,
    });
  }

  /**
   * 写回 TOS 被拒（控制台没做授权）：结果已经处理完但存不下来。
   * 不写回再提交一次，结果改由服务端转存，用户无感知，也不重复扣费；本进程后续任务都不再写回。
   */
  private async retryWithoutWriteback(record: MediaToolTask) {
    if (this.writeback) {
      this.writeback = false;
      this.logger.error('MediaKit 无权写回 TOS，已改为服务端转存。请在 MediaKit 控制台「基础配置 > 授权管理」授权访问 TOS');
    }
    const { mode } = this.find(record);
    const body = buildBody(mode, await this.resolveContext(record));
    const upstreamId = await this.submit(record, mode.path.split('/')[1], body, false, 1);
    await this.repo.update({ id: record.id, status: 'running' }, { upstreamId, data: { ...(record.data ?? {}), retried: true }, updatedAt: new Date() });
  }

  private async runSync(record: MediaToolTask, name: string, body: Record<string, unknown>) {
    try {
      await this.finalize(record, await this.mediakit.run(name, body));
    } catch (error) {
      await this.fail(record, error);
    }
  }

  private async finalize(record: MediaToolTask, result: Record<string, unknown>) {
    const { tool, mode } = this.find(record);
    const invalid = mode.verify?.(result);
    if (invalid) return this.fail(record, invalid);
    const outputs: MediaToolOutput[] = [];
    for (const [index, raw] of mode.outputs(result).entries()) {
      const stored = await this.store(record, raw, index);
      if (stored) outputs.push(stored);
    }
    const data = { ...(record.data ?? {}), ...(mode.data?.(result) ?? {}) };
    if (!outputs.length && !mode.data) throw new Error('没有返回处理结果');
    const extra = await this.topUp(record, tool, mode, result);
    const updated = await this.repo.update(
      { id: record.id, status: 'running' },
      { status: 'succeeded', outputs, thumbKey: await this.thumbnail(record, outputs), data, chargeCents: record.chargeCents + extra, error: null },
    );
    if (updated.affected) await this.billing.settle(record.id);
  }

  private async fail(record: MediaToolTask, error: unknown) {
    const message = messageOf(error) || '处理失败';
    this.logger.warn(`工具任务失败 record=${record.id} tool=${record.tool}：${message}`);
    const updated = await this.repo.update({ id: record.id, status: 'running' }, { status: 'failed', error: message.slice(0, 500) });
    if (updated.affected) await this.billing.refundTask(record.id);
  }

  /** 实际用量比预扣多时补扣差额。任务已经做完，余额不够也只扣到 0，不让结果作废 */
  private async topUp(record: MediaToolTask, tool: ToolDef, mode: ToolMode, result: Record<string, unknown>): Promise<number> {
    const actual = mode.price.actual?.(result, this.contextOf(record));
    if (!actual) return 0;
    const rate = await this.rate(tool, mode);
    const extraCny = actual * rate.base - record.prepaidCny;
    const cents = Math.floor(extraCny * rate.markup * 100 + CENT_EPSILON);
    if (cents < 1) return 0;
    try {
      await runWithBilling(record.userId, () =>
        this.billing.chargeQuoted('tool', {
          model: rate.ruleId,
          modelName: `${this.label(tool, mode)}（按实际用量补扣）`,
          cents,
          upstreamCents: extraCny * 100,
          partial: true,
        }),
      );
      return cents;
    } catch (error) {
      this.logger.error(`补扣失败 record=${record.id} ${cents} 分：${messageOf(error)}`);
      return 0;
    }
  }

  /** 写回本桶的结果直接用对象键；临时链接转存到记录目录 */
  private async store(record: MediaToolTask, raw: RawOutput, index: number): Promise<MediaToolOutput | null> {
    if (/^tos:\/\//i.test(raw.url)) {
      const key = this.storage.toObjectName(raw.url);
      if (key.startsWith('tos://')) throw new Error('结果写到了其他存储桶，请检查 MediaKit 输出配置');
      return { kind: raw.kind, label: raw.label, key };
    }
    if (!/^https?:\/\//i.test(raw.url)) {
      this.logger.warn(`无法保存的结果地址 record=${record.id}：${raw.url}`);
      return null;
    }
    const dir = mkdtempSync(join(tmpdir(), 'mtool-'));
    try {
      const source = join(dir, 'source');
      const contentType = await this.storage.downloadUrl(raw.url, source);
      // 临时链接常常没有扩展名（如音频编辑返回的 VOD 地址），按响应类型补上
      const ext = raw.h264 ? 'mp4' : raw.ext ?? /\/[^/?]+\.([a-z0-9]{2,5})(?:\?|$)/i.exec(raw.url)?.[1]?.toLowerCase() ?? EXT_BY_TYPE[contentType ?? ''] ?? DEFAULT_EXT[raw.kind];
      const name = `${this.dir(record)}/${String(index + 1).padStart(3, '0')}.${ext}`;
      if (!raw.h264 && !raw.gunzip) return { kind: raw.kind, label: raw.label, key: await this.storage.uploadFile(name, source, contentType) };
      const output = join(dir, `output.${ext}`);
      if (raw.gunzip) await pipeline(createReadStream(source), createGunzip(), createWriteStream(output));
      else await this.ffmpeg.toH264(source, output);
      return { kind: raw.kind, label: raw.label, key: await this.storage.uploadFile(name, output, CONTENT_TYPE[ext]) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** 列表缩略图：图片结果直接用，视频截一帧。截帧失败前端会显示图标 */
  private async thumbnail(record: MediaToolTask, outputs: MediaToolOutput[]): Promise<string | null> {
    const image = outputs.find((item) => item.kind === 'image');
    if (image) return image.key;
    const video = outputs.find((item) => item.kind === 'video');
    if (!video) return null;
    const dir = mkdtempSync(join(tmpdir(), 'mtool-thumb-'));
    try {
      const output = join(dir, 'thumb.jpg');
      await this.ffmpeg.thumbnail(this.storage.toPublicUrl(video.key), output, true);
      return await this.storage.uploadFile(`${this.dir(record)}/thumb.jpg`, output, 'image/jpeg');
    } catch (error) {
      this.logger.warn(`工具结果截帧失败 record=${record.id}：${messageOf(error)}`);
      return null;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ───────────────────────── 内部 ─────────────────────────

  private find(ref: { tool: string; mode?: string }) {
    const found = findTool(ref.tool, ref.mode);
    if (!found) throw new BadRequestException('工具不存在');
    return found;
  }

  private async context(userId: string, mode: ToolMode, dto: RunToolDto): Promise<ToolContext> {
    const inputs = normalizeInputs(mode, dto.inputs);
    const values = normalizeValues(mode, dto.values);
    const records: ToolContext['records'] = {};
    for (const option of mode.options) {
      if (option.type !== 'record' || !values[option.key]) continue;
      const record = await this.repo.findOne({ where: { id: String(values[option.key]), userId, tool: option.recordTool, status: 'succeeded' } });
      if (!record) throw new BadRequestException(`${option.label}不存在或还没完成`);
      records[option.key] = record.data ?? {};
    }
    return { inputs, values, records };
  }

  private contextOf(record: MediaToolTask): ToolContext {
    return { inputs: record.params.inputs, values: record.params.values, records: {} };
  }

  /** 按记录里存的参数重建上下文，record 类参数重新取被引用记录的 data */
  private async resolveContext(record: MediaToolTask): Promise<ToolContext> {
    const ctx = this.contextOf(record);
    for (const option of this.find(record).mode.options) {
      const id = option.type === 'record' ? ctx.values[option.key] : undefined;
      if (!id) continue;
      const ref = await this.repo.findOne({ where: { id: String(id), userId: record.userId } });
      ctx.records[option.key] = ref?.data ?? {};
    }
    return ctx;
  }

  private async assertOwnFiles(userId: string, mode: ToolMode, ctx: ToolContext) {
    const ids = [
      ...Object.values(ctx.inputs).flat().map((file) => file.fileId),
      ...mode.options.filter((option) => option.type === 'mask' && ctx.values[option.key]).map((option) => String(ctx.values[option.key])),
    ];
    for (const id of ids) {
      // 用户 ID 是数字字符串。Redis 读出来会先 JSON.parse，"12" 会变成数字 12，必须再转回字符串比较
      const owner = await this.redis.get(fileKey(id));
      if (owner == null || String(owner) !== userId) throw new BadRequestException('文件已过期，请重新上传');
    }
  }

  private async rate(tool: ToolDef, mode: ToolMode) {
    const ruleId = priceRuleId(tool.id, mode.id);
    const [rule, markup] = await Promise.all([this.pricing.rule(ruleId), this.pricing.markup(ruleId)]);
    const base = rule?.officialUnitCny ?? mode.price.official;
    return { ruleId, base, markup, unitPrice: base * markup };
  }

  private async price(tool: ToolDef, mode: ToolMode, ctx: ToolContext) {
    const rate = await this.rate(tool, mode);
    const official = Math.max(0, mode.price.quantity(ctx)) * rate.base;
    return { ruleId: rate.ruleId, official, cents: toCents(official * rate.markup) };
  }

  private label(tool: ToolDef, mode: ToolMode) {
    return tool.modes.length > 1 ? `${tool.name} · ${mode.label}` : tool.name;
  }

  private dir(record: MediaToolTask) {
    return `ai-tool/${record.userId}/${record.id}`;
  }

  private async owned(userId: string, id: string) {
    const record = await this.repo.findOne({ where: { id, userId } });
    if (!record) throw new NotFoundException('记录不存在');
    return record;
  }

  private async claim(key: string, ttlSec: number): Promise<boolean> {
    return (await this.redis.getClient().set(key, '1', 'EX', ttlSec, 'NX')) === 'OK';
  }

  private generationIds(record: MediaToolTask): string[] {
    return Array.isArray(record.data?.generations) ? (record.data.generations as string[]) : [];
  }

  private async generations(record: MediaToolTask) {
    const tasks = await Promise.all(this.generationIds(record).map((id) => this.generation.get(record.userId, id).catch(() => null)));
    return tasks.filter((task) => task !== null);
  }

  private present(record: MediaToolTask, generations?: unknown[]) {
    return {
      id: record.id,
      tool: record.tool,
      mode: record.mode,
      status: record.status,
      error: record.error,
      chargeCents: record.chargeCents,
      createdAt: record.createdAt,
      inputs: Object.values(record.params.inputs).flat().map((file) => ({ name: file.name, kind: file.kind, durationSec: file.durationSec })),
      values: record.params.values,
      outputs: record.outputs.map((item) => ({ kind: item.kind, label: item.label, url: this.storage.toPublicUrl(item.key) })),
      thumbUrl: record.thumbKey ? this.storage.toPublicUrl(record.thumbKey) : null,
      data: record.data,
      ...(generations ? { generations } : {}),
    };
  }

  /** 生产环境关闭了 synchronize，启动时把表补上。建表失败只影响本功能，不拖垮整个服务 */
  private async ensureSchema() {
    try {
      await this.createTables();
    } catch (error) {
      this.logger.error(`智能工具建表失败，请手工建表：${messageOf(error)}`);
    }
  }

  private async createTables() {
    await this.repo.query(`
      CREATE TABLE IF NOT EXISTS "media_tool_task" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        "user_id" character varying(100) NOT NULL,
        "tool" character varying(40) NOT NULL,
        "mode" character varying(40) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'running',
        "params" jsonb NOT NULL,
        "upstream_id" character varying(128),
        "outputs" jsonb NOT NULL DEFAULT '[]',
        "thumb_key" character varying(500),
        "data" jsonb,
        "charge_cents" integer NOT NULL DEFAULT 0,
        "prepaid_cny" double precision NOT NULL DEFAULT 0,
        "error" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await this.repo.query(`CREATE INDEX IF NOT EXISTS "IDX_media_tool_task_user_tool" ON "media_tool_task" ("user_id", "tool", "created_at")`);
    await this.repo.query(`CREATE INDEX IF NOT EXISTS "IDX_media_tool_task_upstream" ON "media_tool_task" ("upstream_id")`);
  }
}
