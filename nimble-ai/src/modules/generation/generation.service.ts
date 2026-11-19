import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { IsNull, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { generateText } from 'ai';
import { StorageService } from '../storage';
import { AtlasImagePendingError, ImageGenService } from '../video/providers/image-gen.service';
import { AtlasClientService, AtlasPredictionResult } from '../atlas/atlas-client.service';
import { AtlasWebhookDispatcherService } from '../atlas/atlas-webhook-dispatcher.service';
import { isAtlasTimeoutError } from '../atlas/atlas-webhook.types';
import { VideoGenService } from '../video/providers/video-gen.service';
import { VideoService } from '../video/video.service';
import { TtsService } from '../media-pipeline/tts.service';
import { AtlasLlmService } from '../atlas/atlas-llm.service';
import { AtlasModelRegistryService } from '../atlas/atlas-model-registry.service';
import { toClientModel } from '../atlas/atlas.types';
import { billingJob } from '../billing/billing-context';
import { GenerateDto } from './generation.dto';
import { ImageToolsService } from './image-tools.service';
import { GenerationParams, GenerationTaskEntity } from './generation.entity';

export const GENERATION_QUEUE = 'generation';
export interface GenerationJobData {
  taskId: string;
  userId?: string;
}

const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_POLL_TIMEOUT_MS = 30 * 60_000;
const UPLOAD_KINDS = ['image', 'video', 'audio'] as const;
const DEFAULT_VOICE = 'zh_female_vv_uranus_bigtts';

/** 画布视频本地等待上限。到点后任务保持运行，不退款，等回调或对账写回。 */
class AtlasResultPendingError extends Error {
  readonly predictionId: string;

  constructor(predictionId: string) {
    super('任务仍在生成');
    this.name = 'AtlasResultPendingError';
    this.predictionId = predictionId;
  }
}

/** 通用生成服务：创建任务入队、Worker 执行、结果落对象存储。画布与提示词库共用 */
@Injectable()
export class GenerationService implements OnModuleInit {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    @InjectRepository(GenerationTaskEntity) private readonly repo: Repository<GenerationTaskEntity>,
    @InjectQueue(GENERATION_QUEUE) private readonly queue: Queue<GenerationJobData>,
    private readonly storage: StorageService,
    private readonly imageGen: ImageGenService,
    private readonly videoGen: VideoGenService,
    private readonly videoService: VideoService,
    private readonly tts: TtsService,
    private readonly llm: AtlasLlmService,
    private readonly modelConfig: AtlasModelRegistryService,
    private readonly imageTools: ImageToolsService,
    private readonly atlas: AtlasClientService,
    webhookDispatcher: AtlasWebhookDispatcherService,
  ) {
    webhookDispatcher.register({
      name: 'generation-image',
      tryHandle: (sessionId) => this.completeGenerationImage(sessionId),
      sweep: () => this.sweepGenerationImages(),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.repo.query(`ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "prediction_id" character varying(128)`);
    await this.repo.query(
      `CREATE INDEX IF NOT EXISTS "IDX_generation_tasks_prediction_id" ON "generation_tasks" ("prediction_id")`,
    );
  }

  /** 各类可选模型，供画布节点与提示词库的模型下拉框使用 */
  async listModels() {
    const [image, video, audio] = await Promise.all([
      this.videoService.listModels('image'),
      this.videoService.listModels('video'),
      this.modelConfig.listModels('audio'),
    ]);
    const text = this.modelConfig.listTextModels('llm').map(({ id, name }) => ({ id, name }));
    return { image: image.map(toClientModel), video: video.map(toClientModel), audio: audio.map(toClientModel), text };
  }

  async create(userId: string, dto: GenerateDto) {
    const { kind, ...params } = dto;
    const task = await this.repo.save(this.repo.create({ userId, kind, params: params as GenerationParams }));
    await this.queue.add('run', { taskId: task.id, ...billingJob() }, { removeOnComplete: true, removeOnFail: true });
    return this.present(task);
  }

  async get(userId: string, id: string) {
    const task = await this.repo.findOne({ where: { id, userId } });
    if (!task) throw new NotFoundException('任务不存在');
    return this.present(task);
  }

  /** 供提示词库发布示例等场景读取"已成功的任务" */
  async getSucceeded(userId: string, id: string): Promise<GenerationTaskEntity> {
    const task = await this.repo.findOne({ where: { id, userId } });
    if (!task || task.status !== 'succeeded' || !task.resultKey) throw new BadRequestException('请先成功生成一次示例');
    return task;
  }

  /** 删除任务和它的结果文件。生成中的任务不删，避免扣了费的结果写回来时找不到记录 */
  async remove(userId: string, id: string): Promise<void> {
    const task = await this.repo.findOne({ where: { id, userId } });
    if (!task) return;
    if (task.status === 'queued' || task.status === 'running') throw new BadRequestException('视频还在生成中，完成后再删除');
    await this.repo.delete(task.id);
    await Promise.all([task.resultKey, task.thumbKey].filter(Boolean).map((key) => this.storage.remove(key!)));
  }

  /** 画布本地上传：只收图片/视频/音频，存到用户目录，返回公网 URL */
  async upload(userId: string, file: Express.Multer.File) {
    const kind = UPLOAD_KINDS.find((k) => file.mimetype.startsWith(`${k}/`));
    if (!kind) throw new BadRequestException('仅支持图片、视频、音频文件');
    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const key = await this.storage.upload(
      `ai-user/${userId}/up/${randomUUID()}${ext ? `.${ext}` : ''}`,
      file.buffer,
      file.mimetype,
    );
    const thumb = kind === 'audio' ? null : await this.imageTools.thumbnailOf(userId, key, kind === 'video');
    return { kind, key, url: this.storage.toPublicUrl(key), thumbUrl: thumb ? this.storage.toPublicUrl(thumb) : null };
  }

  /** Worker 入口：把 queued 任务跑完，成功/失败都落库 */
  async run(taskId: string): Promise<void> {
    const task = await this.repo.findOne({ where: { id: taskId } });
    if (!task || task.status !== 'queued') return;
    await this.repo.update(task.id, { status: 'running' });
    try {
      const result = await this.execute(task);
      // 缩略图晚于结果可用没关系，但必须在标记成功前生成，前端拿到结果时才能直接用
      const isMedia = result.resultKey && task.kind !== 'audio';
      const thumbKey = isMedia ? await this.imageTools.thumbnailOf(task.userId, result.resultKey!, task.kind === 'video') : null;
      // 回调可能已经写过成功。只覆盖仍在 running 的行，避免把补写的结果盖回失败或重复成功。
      await this.repo.update({ id: task.id, status: 'running' }, { status: 'succeeded', ...result, thumbKey });
    } catch (error) {
      if (error instanceof AtlasImagePendingError || error instanceof AtlasResultPendingError) {
        await this.repo.update(
          { id: task.id, predictionId: IsNull() },
          { predictionId: error.predictionId, updatedAt: new Date() },
        );
        this.logger.warn(`生成仍在 Atlas 处理中，等待回调 task=${task.id} prediction=${error.predictionId}`);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`生成失败 task=${task.id} kind=${task.kind}: ${message}`);
      await this.repo.update({ id: task.id, status: 'running' }, { status: 'failed', error: message.slice(0, 500) });
    }
  }

  private async execute(task: GenerationTaskEntity): Promise<Partial<GenerationTaskEntity>> {
    const p = task.params;
    const urls = (list?: string[]) => (list ?? []).map((item) => this.storage.toPublicUrl(item));
    switch (task.kind) {
      case 'image': {
        const result = await this.imageGen.generate(
          {
            prompt: p.prompt,
            referenceImageUrls: urls(p.refImages),
            ratio: p.ratio,
            resolution: p.resolution,
            outputFormat: p.outputFormat,
            promptOptimizeMode: p.promptOptimizeMode,
            lora: p.lora,
            modelId: p.modelId,
          },
          {
            handoff: true,
            onSubmitted: async ({ predictionId, modelName }) => {
              await this.repo.update(task.id, { predictionId, modelName, updatedAt: new Date() });
            },
          },
        );
        return { resultKey: await this.saveRemote(task, result.url, 'png'), modelName: result.modelName, predictionId: result.predictionId };
      }
      case 'video': {
        const created = await this.videoGen.createTask({
          prompt: p.prompt,
          referenceImageUrls: urls(p.refImages),
          referenceVideoUrls: urls(p.refVideos),
          referenceAudioUrls: urls(p.refAudios),
          durationSec: p.durationSec ?? 5,
          generateAudio: p.generateAudio ?? false,
          ratio: p.ratio,
          resolution: p.resolution,
          lora: p.lora,
          modelId: p.modelId,
        });
        await this.repo.update(task.id, {
          predictionId: created.taskId,
          modelName: created.modelName,
          updatedAt: new Date(),
        });
        const videoUrl = await this.waitVideo(created.taskId, created.modelId);
        return {
          resultKey: await this.saveRemote(task, videoUrl, 'mp4'),
          modelName: created.modelName,
          predictionId: created.taskId,
        };
      }
      case 'audio': {
        const { audio, mimeType } = await this.tts.synthesize({
          text: p.prompt,
          voiceName: `doubao:${p.voice && p.voice !== 'eve' ? p.voice : DEFAULT_VOICE}`,
        });
        return { resultKey: await this.storage.upload(this.resultName(task, 'mp3'), audio, mimeType) };
      }
      case 'text': {
        const { text } = await generateText({ model: this.llm.text(p.modelId), prompt: p.prompt });
        return { resultText: text };
      }
    }
  }

  private async waitVideo(taskId: string, modelId: string): Promise<string> {
    const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
      const result = await this.videoGen.queryTask(taskId, modelId);
      if (result.state === 'succeeded' && result.videoUrl) return result.videoUrl;
      if (['failed', 'expired', 'cancelled'].includes(result.state)) throw new Error(result.error || '视频生成失败');
    }
    throw new AtlasResultPendingError(taskId);
  }

  private resultName(task: GenerationTaskEntity, ext: string) {
    return `ai-user/${task.userId}/gen/${task.id}.${ext}`;
  }

  private saveRemote(task: GenerationTaskEntity, url: string, fallbackExt: string) {
    const ext = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? fallbackExt;
    return this.storage.uploadFromUrl(this.resultName(task, ext), url);
  }

  private present(task: GenerationTaskEntity) {
    return {
      id: task.id,
      kind: task.kind,
      status: task.status,
      url: task.resultKey ? this.storage.toPublicUrl(task.resultKey) : null,
      key: task.resultKey,
      thumbUrl: task.thumbKey ? this.storage.toPublicUrl(task.thumbKey) : null,
      text: task.resultText,
      modelName: task.modelName,
      error: task.error,
    };
  }

  /** 画布 / 提示词库里还开着的图片或视频。只扫生成中的，避免把已退款的超时记录反复处理。 */
  private async sweepGenerationImages(): Promise<void> {
    const tasks = await this.repo
      .createQueryBuilder('task')
      .where('task.kind IN (:...kinds)', { kinds: ['image', 'video'] })
      .andWhere(`(task.status = 'running' OR (task.status = 'failed' AND task.error LIKE :timeout))`, {
        timeout: '%生成超时%',
      })
      .andWhere('task.prediction_id IS NOT NULL')
      .orderBy('task.updated_at', 'ASC')
      .limit(20)
      .getMany();
    for (const task of tasks) {
      if (task.predictionId && !task.predictionId.startsWith('ark-')) await this.completeGenerationImage(task.predictionId);
    }
  }

  /** 返回 false 表示这个 prediction 不是画布任务。 */
  private async completeGenerationImage(predictionId: string): Promise<boolean> {
    if (predictionId.startsWith('ark-')) return false;
    const task = await this.repo.findOne({ where: { predictionId } });
    if (!task || (task.kind !== 'image' && task.kind !== 'video')) return false;
    if (task.status === 'succeeded' && task.resultKey) return true;
    const recoverable = task.status === 'failed' && isAtlasTimeoutError(task.error);
    const open = task.status === 'running' || recoverable;
    if (!open) return true;
    if (task.status === 'running' && this.atlas.hasWaiter(predictionId)) return true;

    let result: AtlasPredictionResult;
    try {
      result = await this.atlas.getPrediction(predictionId);
    } catch (error) {
      this.logger.warn(`回查画布生成失败 prediction=${predictionId}: ${error instanceof Error ? error.message : error}`);
      return true;
    }
    if (result.state === 'succeeded' && result.outputs[0]) {
      if (recoverable) this.logger.warn(`画布任务在判定超时后成功，补写结果 prediction=${predictionId}`);
      await this.succeedGenerationMedia(task, predictionId, result.outputs[0]);
      return true;
    }
    if (result.state === 'failed') {
      await this.failGenerationImage(task, predictionId, result.error || '生成失败');
      return true;
    }
    if (recoverable) await this.reopenGeneration(task, predictionId);
    return true;
  }

  /** 本地超时误判之后，Atlas 仍在处理：把任务拉回生成中，好让前端继续等，且不退款。 */
  private async reopenGeneration(task: GenerationTaskEntity, predictionId: string): Promise<void> {
    await this.repo.update(
      { id: task.id, predictionId, status: 'failed' },
      { status: 'running', error: null },
    );
  }

  private async succeedGenerationMedia(task: GenerationTaskEntity, predictionId: string, remoteUrl: string): Promise<void> {
    const resultKey = await this.saveRemote(task, remoteUrl, task.kind === 'video' ? 'mp4' : 'png');
    let thumbKey: string | null = null;
    try {
      thumbKey = await this.imageTools.thumbnailOf(task.userId, resultKey, task.kind === 'video');
    } catch (error) {
      this.logger.warn(`画布缩略图失败 task=${task.id}: ${error instanceof Error ? error.message : error}`);
    }
    await this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(GenerationTaskEntity);
      const latest = await repo.findOne({ where: { id: task.id }, lock: { mode: 'pessimistic_write' } });
      if (!latest || latest.predictionId !== predictionId) return;
      if (latest.status === 'succeeded' && latest.resultKey) return;
      const stillRecoverable = latest.status === 'failed' && isAtlasTimeoutError(latest.error);
      if (latest.status !== 'running' && !stillRecoverable) return;
      latest.status = 'succeeded';
      latest.resultKey = resultKey;
      latest.thumbKey = thumbKey;
      latest.error = null;
      if (!latest.modelName && task.modelName) latest.modelName = task.modelName;
      await repo.save(latest);
    });
  }

  private async failGenerationImage(task: GenerationTaskEntity, predictionId: string, message: string): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(GenerationTaskEntity);
      const latest = await repo.findOne({ where: { id: task.id }, lock: { mode: 'pessimistic_write' } });
      if (!latest || latest.predictionId !== predictionId) return;
      if (latest.status === 'succeeded' && latest.resultKey) return;
      const stillRecoverable = latest.status === 'failed' && isAtlasTimeoutError(latest.error);
      if (latest.status !== 'running' && !stillRecoverable) return;
      latest.status = 'failed';
      latest.error = message.slice(0, 500);
      await repo.save(latest);
    });
  }
}
