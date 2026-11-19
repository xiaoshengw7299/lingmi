import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as dayjs from 'dayjs';
import { randomUUID } from 'crypto';
import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { In, IsNull, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { generateText } from 'ai';

import { AssetKind, FileAssetKind, GenerationMode, VideoProjectEntity, MediaAsset } from './entities/video-project.entity';
import { ShotEntity } from './entities/shot.entity';
import { VideoTakeEntity } from './entities/video-take.entity';
import { VideoComposeHistoryEntity } from './entities/video-compose-history.entity';
import {
  VideoExampleEntity,
  ExampleAssetSnapshot,
  ExampleShotSnapshot,
  ExampleProjectSnapshot,
} from './entities/video-example.entity';
import { SessionEntity } from '../agent/entities/session.entity';
import { StorageService } from '../storage';
import { AtlasImagePendingError, ImageGenService } from './providers/image-gen.service';
import { VideoGenService, VideoTaskResult } from './providers/video-gen.service';
import { AtlasClientService, AtlasPredictionResult } from '../atlas/atlas-client.service';
import { AtlasModelRegistryService } from '../atlas/atlas-model-registry.service';
import { AtlasWebhookDispatcherService } from '../atlas/atlas-webhook-dispatcher.service';
import { isAtlasTimeoutError } from '../atlas/atlas-webhook.types';
import { MediaModelOption, MediaModelKind } from '../atlas/atlas.types';
import { FfmpegService } from '../media-pipeline/ffmpeg.service';
import { VideoGateway } from './video.gateway';
import { VIDEO_IMAGE_QUEUE, VIDEO_GEN_QUEUE, VIDEO_COMPOSE_QUEUE } from './video.queues';
import { billingJob, runWithBilling } from '../billing/billing-context';
import { BillingService } from '../billing/billing.service';
import {
  composeMentionPrompt,
  extractMentionNames,
  MentionRef,
  removeMentionName,
  replaceMentionName,
  resolveMentionRefs,
  mentionRewriteStyleFor,
} from './mention.util';
import { CreateStoryboardInput } from './video.types';
import {
  UpdateShotDto,
  AddShotDto,
  AddAssetDto,
  UpdateAssetDto,
} from './dto/video.dto';
import { AILoggerService, AiLogContext } from '../agent/logger/ai-logger.service';
import { AtlasLlmService } from '../atlas/atlas-llm.service';
import { EngagementService } from '../engagement/engagement.service';
import { ExampleShareRewardService } from './example-share-reward.service';
import { applyRank, hotScoreSql, parsePage, RankSort } from '../../common/hot-rank';

/** 上传文件的最小类型声明（避免引入 @types/multer 依赖） */
export interface UploadedFileDto {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

/** 从资产库引入时按扩展名还原 mimetype，供上传校验识别素材类型 */
const ASSET_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
};

/**
 * 上游全能参考入口对素材的硬性限制（Seedance 2.0 与 MiniMax H3 一致）。
 * 上传阶段就按此校验并拒绝，避免素材进了库、到生成时才被上游打回。
 */
const ASSET_UPLOAD_LIMITS: Record<FileAssetKind, { label: string; maxBytes: number }> = {
  image: { label: '图片', maxBytes: 30 * 1024 * 1024 },
  video: { label: '视频', maxBytes: 50 * 1024 * 1024 },
  audio: { label: '音频', maxBytes: 15 * 1024 * 1024 },
};
/** multer 层的统一兜底上限，取三类中的最大值；按类型的精确限制与提示由 storeAssetFile 给出 */
export const ASSET_UPLOAD_MAX_BYTES = Math.max(
  ...Object.values(ASSET_UPLOAD_LIMITS).map((item) => item.maxBytes),
);
/** 参考视频/音频的单段时长范围（秒）；上限取 Seedance 2.5 官方 [2,30]s */
const REFERENCE_CLIP_MIN_SEC = 2;
const REFERENCE_CLIP_MAX_SEC = 30;
/** 参考图的像素边长范围（Seedance 2.5 官方 300–6000px） */
const REFERENCE_IMAGE_MIN_PX = 300;
const REFERENCE_IMAGE_MAX_PX = 6000;
/** ISOBMFF(ftyp) 容器按 brand 区分 HEIF 图片与 MP4 视频 */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);
const SUPPORTED_UPLOAD_FORMATS = '图片支持 PNG/JPEG/WebP/HEIC，视频支持 MP4（H.264/H.265），音频支持 WAV/MP3';
/** 空白工作台 / 使用示例创建项目时同步写入的智能体 ID，须与前端 AGENT_ID 一致 */
const VIDEO_PRODUCER_AGENT_ID = 'video-producer';

/** 是不是同一个人。作者复制自己的示例时用来跳过计数，空账号不算本人 */
const sameAccount = (createdBy: string | number | null | undefined, userId: string | number | null | undefined) => {
  const author = String(createdBy ?? '').trim();
  const copier = String(userId ?? '').trim();
  return author.length > 0 && author === copier;
};

/** 方舟图片在本地造的票据，不是 Atlas prediction id */
const isAtlasPredictionId = (predictionId: string) => !predictionId.startsWith('ark-');

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);
  private readonly workspaceDir: string;

  constructor(
    @InjectRepository(VideoProjectEntity) private readonly projectRepo: Repository<VideoProjectEntity>,
    @InjectRepository(ShotEntity) private readonly shotRepo: Repository<ShotEntity>,
    @InjectRepository(VideoTakeEntity) private readonly takeRepo: Repository<VideoTakeEntity>,
    @InjectRepository(VideoComposeHistoryEntity) private readonly composeHistoryRepo: Repository<VideoComposeHistoryEntity>,
    @InjectRepository(VideoExampleEntity) private readonly exampleRepo: Repository<VideoExampleEntity>,
    @InjectRepository(SessionEntity) private readonly sessionRepo: Repository<SessionEntity>,
    @InjectQueue(VIDEO_IMAGE_QUEUE) private readonly imageQueue: Queue,
    @InjectQueue(VIDEO_GEN_QUEUE) private readonly videoQueue: Queue,
    @InjectQueue(VIDEO_COMPOSE_QUEUE) private readonly composeQueue: Queue,
    private readonly storage: StorageService,
    private readonly imageGen: ImageGenService,
    private readonly videoGen: VideoGenService,
    private readonly modelConfig: AtlasModelRegistryService,
    private readonly ffmpeg: FfmpegService,
    private readonly gateway: VideoGateway,
    private readonly aiLogger: AILoggerService,
    private readonly configService: ConfigService,
    private readonly atlasLlm: AtlasLlmService,
    private readonly engagement: EngagementService,
    private readonly shareReward: ExampleShareRewardService,
    private readonly atlas: AtlasClientService,
    private readonly billing: BillingService,
    webhookDispatcher: AtlasWebhookDispatcherService,
  ) {
    this.workspaceDir = this.configService.get<string>(
      'AGENT_WORKSPACE_DIR',
      path.join(process.cwd(), 'workspace'),
    );
    // Webhook 到达时只负责"认领 + 立即触发一次轮询"，落库逻辑仍是 pollShotVideoTask 那一套，
    // 两条路径共用同一个状态机，不会因为 webhook 与轮询并发写同一条 take 记录产生竞态。
    webhookDispatcher.register({
      name: 'video-producer',
      tryHandle: (sessionId) => this.triggerImmediateVideoPoll(sessionId),
      sweep: () => this.sweepOpenVideoTakes(),
    });
    // 图片没有独立的轮询队列。本地等待交棒、进程重启或回调晚到时，靠这里把 Atlas 终态写回素材。
    webhookDispatcher.register({
      name: 'video-producer-image',
      tryHandle: (sessionId) => this.completeBoardImage(sessionId),
      sweep: () => this.sweepBoardImages(),
    });
  }

  /**
   * Atlas webhook 收到终态回调时调用。生成中，或之前被本地超时误判失败的 take，都再查一次 Atlas。
   * 找不到 take 说明这个 sessionId 不归本模块。
   */
  private async triggerImmediateVideoPoll(taskId: string): Promise<boolean> {
    const take = await this.takeRepo.findOne({ where: { taskId } });
    if (!take) return false;
    if (take.status !== 'generating' && !this.isRecoverableVideoTimeout(take)) return true;
    const shot = await this.shotRepo.findOne({ where: { id: take.shotId } });
    if (!shot) return true;
    // 回调没有登录用户。接力生成下一镜会再次扣费，所以要还原这个项目的主人
    const project = await this.projectRepo.findOne({ where: { id: shot.projectId }, select: { id: true, userId: true } });
    await runWithBilling(project?.userId, () => this.pollShotVideoTask(shot.projectId, shot.id, take.id, taskId, false));
    return true;
  }

  /** 密集轮询停掉之后，以及进程重启后，继续把还开着的分镜视频问到 Atlas 终态。 */
  private async sweepOpenVideoTakes(): Promise<void> {
    const takes = await this.takeRepo
      .createQueryBuilder('take')
      .where('take.task_id IS NOT NULL')
      .andWhere(`(take.status = 'generating' OR (take.status = 'failed' AND take.error LIKE :timeout))`, {
        timeout: '%生成超时%',
      })
      .orderBy('take.updated_at', 'ASC')
      .limit(20)
      .getMany();
    for (const take of takes) {
      if (!take.taskId || this.atlas.hasWaiter(take.taskId)) continue;
      const shot = await this.shotRepo.findOne({ where: { id: take.shotId } });
      if (!shot) continue;
      const project = await this.projectRepo.findOne({
        where: { id: shot.projectId },
        select: { id: true, userId: true },
      });
      await runWithBilling(project?.userId, () =>
        this.pollShotVideoTask(shot.projectId, shot.id, take.id, take.taskId!, false),
      );
    }
  }

  private isRecoverableVideoTimeout(take: { status: string; error?: string | null }): boolean {
    return take.status === 'failed' && isAtlasTimeoutError(take.error);
  }

  /** 工作台异步任务无 HTTP requestId，每次生成单独追踪 */
  private mediaLogCtx(sessionId: string): AiLogContext {
    return { requestId: randomUUID(), sessionId };
  }

  /** 供 `GET /video/models` 使用：图片/视频当前各自可选的模型列表（含默认模型标记、LoRA 能力） */
  listModels(kind: MediaModelKind): Promise<MediaModelOption[]> {
    return this.modelConfig.listModels(kind);
  }

  /** 供生成失败等无法从 Provider 返回值取得展示名的场景兜底解析模型名，解析失败时退化为原始 modelId */
  private async resolveModelName(kind: MediaModelKind, modelId?: string | null): Promise<string> {
    try {
      return (await this.modelConfig.resolveModel(kind, modelId)).name;
    } catch {
      return modelId || '未知模型';
    }
  }

  /** 串行化同一项目的素材写入，避免多标签页、多实例并发覆盖 JSONB。 */
  private async withProjectMutationLock<T>(projectId: string, action: () => Promise<T>): Promise<T> {
    return this.projectRepo.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`video-project:${projectId}`]);
      return action();
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  项目 / 分镜 CRUD
  // ═══════════════════════════════════════════════════════════

  /** 由 generate_storyboard 工具调用：落库素材库 + 分镜。 */
  async createFromStoryboard(input: CreateStoryboardInput): Promise<VideoProjectEntity> {
    const shotNames = input.shots.map((shot, index) => shot.name?.trim() || `分镜${index + 1}`);
    const referenceNames = [
      ...input.assets.map((ref) => ref.name.trim()),
      ...shotNames,
    ];
    referenceNames.forEach((name) => this.assertSafeReferenceName(name));
    const duplicateName = referenceNames.find((name, index) => !name || referenceNames.indexOf(name) !== index);
    if (duplicateName !== undefined) {
      throw new BadRequestException(
        duplicateName ? `素材和分镜名称不能重复：${duplicateName}` : '素材和分镜名称不能为空',
      );
    }
    this.validateStoryboardMentions(input, shotNames);
    const assetIds = input.assets.map(() => randomUUID());
    const toAsset = (b: CreateStoryboardInput['assets'][number], id: string): MediaAsset => ({
      id,
      name: b.name.trim(),
      // 上传附件的真实类型在下面导入时按文件头识别，这里先按图片占位
      kind: 'image',
      source: b.uploadedFilePath ? 'uploaded' : 'generated',
      prompt: b.prompt || '',
      status: 'idle',
      ...(b.uploadedFilePath
        ? {}
        : {
            ratio: this.clampImageRatio(undefined),
            resolution: this.clampImageResolution(undefined),
            outputFormat: this.modelConfig.clampOutputFormat(undefined),
            promptOptimizeMode: this.modelConfig.clampPromptOptimizeMode(undefined),
          }),
    });

    const project = await this.projectRepo.save(
      this.projectRepo.create({
        sessionId: input.sessionId,
        userId: input.userId,
        title: input.title || input.requirement.slice(0, 30),
        requirement: input.requirement,
        assets: input.assets.map((b, i) => toAsset(b, assetIds[i])),
        status: 'draft',
        generationMode: 'continuous',
      }),
    );

    const shots = input.shots.map((s, index) =>
      this.shotRepo.create({
        projectId: project.id,
        index,
        name: shotNames[index],
        videoPrompt: s.videoPrompt,
        durationSec: this.clampDuration(s.durationSec),
        ratio: this.clampRatio(s.ratio ?? input.ratio),
        resolution: this.clampResolution(undefined),
      }),
    );
    await this.persistShots(shots);

    // 用户已上传的聊天附件直接转存为素材，无需模型重新生成（对应聊天输入框上传即入库需求）
    const pending = input.assets
      .map((b, i) => ({ b, id: assetIds[i] }))
      .filter((x) => x.b.uploadedFilePath);
    if (pending.length) {
      for (const { b, id } of pending) {
        const asset = project.assets.find((item) => item.id === id);
        if (!asset) continue;
        try {
          const stored = await this.importUploadedAssetFile(project.id, id, b.uploadedFilePath!);
          asset.kind = stored.kind;
          asset.url = stored.url;
          asset.durationSec = stored.durationSec;
          asset.status = 'success';
        } catch (error) {
          this.logger.warn(
            `导入聊天上传素材失败(${b.uploadedFilePath}): ${error instanceof Error ? error.message : String(error)}`,
          );
          asset.source = 'generated'; // 找不到原文件时退化为普通素材，用户仍可在工作台手动上传或生成
        }
      }
      await this.projectRepo.save(project);
    }

    return this.presentProject(await this.getProject(project.id));
  }

  /** 创建空白项目：前端每次传入全新 sessionId，本方法按该 ID 写入会话和项目 */
  async createBlankProject(input: { sessionId: string; userId: string; title?: string }): Promise<VideoProjectEntity> {
    const title = input.title?.trim() || '新建视频项目';
    await this.insertProducerSession(input.sessionId, input.userId, title);
    const project = await this.projectRepo.save(
      this.projectRepo.create({
        sessionId: input.sessionId,
        userId: input.userId,
        title,
        requirement: '',
        assets: [],
        status: 'draft',
        generationMode: 'continuous',
      }),
    );
    return this.presentProject(await this.getProject(project.id));
  }

  /** 将聊天中已上传的本地文件（workspace/uploads/xxx）转存为项目素材 */
  private async importUploadedAssetFile(
    projectId: string,
    assetId: string,
    relativePath: string,
  ): Promise<{ kind: AssetKind; url: string; durationSec?: number }> {
    const absolutePath = path.isAbsolute(relativePath) ? relativePath : path.join(this.workspaceDir, relativePath);
    if (!fs.existsSync(absolutePath)) throw new Error(`文件不存在: ${relativePath}`);
    return this.storeAssetFile(projectId, assetId, fs.readFileSync(absolutePath));
  }

  
  /** 校验当前用户是否有权访问项目（管理员跳过归属限制） */
  async assertCanAccessProject(projectId: string, userId: string, isAdmin: boolean): Promise<void> {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
      select: { id: true, userId: true },
    });
    if (!project) throw new NotFoundException('视频项目不存在');
    if (!isAdmin && project.userId !== userId) {
      throw new ForbiddenException('无权访问该项目');
    }
  }

  /** 加载项目并校验归属，供 HTTP / WebSocket 入口使用 */
  async getProjectForUser(id: string, userId: string, isAdmin: boolean): Promise<VideoProjectEntity> {
    await this.assertCanAccessProject(id, userId, isAdmin);
    return this.presentProject(await this.getProject(id));
  }

  async getProject(id: string): Promise<VideoProjectEntity> {
    const project = await this.projectRepo.findOne({ where: { id } });
    if (!project) throw new NotFoundException('视频项目不存在');
    project.assets ??= [];
    project.shots = await this.shotRepo.find({
      where: { projectId: id, archivedAt: IsNull() },
      order: { index: 'ASC' },
    });
    const unnamed = project.shots.filter((shot) => !shot.name?.trim());
    if (unnamed.length) {
      unnamed.forEach((shot) => {
        shot.name = `分镜${shot.index + 1}`;
      });
      await this.persistShots(unnamed);
    }
    if (project.shots.length) {
      const takes = await this.takeRepo
        .createQueryBuilder('take')
        .where('take.shot_id IN (:...shotIds)', { shotIds: project.shots.map((shot) => shot.id) })
        .orderBy('take.version', 'DESC')
        .getMany();
      const byShot = new Map<string, VideoTakeEntity[]>();
      for (const take of takes) {
        byShot.set(take.shotId, [...(byShot.get(take.shotId) ?? []), take]);
      }
      project.shots.forEach((shot) => {
        shot.takes = byShot.get(shot.id) ?? [];
      });
    }
    project.composeHistory = await this.composeHistoryRepo.find({
      where: { projectId: id, status: 'success' },
      order: { createdAt: 'DESC' },
    });
    const example = await this.exampleRepo.findOne({ where: { sourceProjectId: id }, select: { id: true } });
    project.exampleId = example?.id ?? null;
    return project;
  }

  async listProjects(query: { userId?: string; sessionId?: string }) {
    const where: Record<string, string> = {};
    if (query.userId) where.userId = query.userId;
    if (query.sessionId) where.sessionId = query.sessionId;
    const rows = await this.projectRepo.find({ where, order: { createdAt: 'DESC' } });
    return rows.map((row) => {
      if (row.finalVideoUrl) row.finalVideoUrl = this.storage.toPublicUrl(row.finalVideoUrl);
      if (row.finalVideoCoverUrl) row.finalVideoCoverUrl = this.storage.toPublicUrl(row.finalVideoCoverUrl);
      return row;
    });
  }

  /** 空白/案例创建时写入对应会话。ID 由前端每次新生成，重复则应报错，不改写、不换号 */
  private async insertProducerSession(id: string, userId: string, title: string): Promise<void> {
    await this.sessionRepo.insert({
      id,
      title,
      agentId: VIDEO_PRODUCER_AGENT_ID,
      userId,
      status: 'active',
      lastActiveAt: new Date(),
    });
  }

  /** 删除会话时，把这个会话下的视频项目一起删掉。会话归属已在入口校验过 */
  async deleteBySessionId(sessionId: string): Promise<void> {
    const projects = await this.projectRepo.find({ where: { sessionId }, select: { id: true } });
    for (const project of projects) await this.deleteProject(project.id);
  }

  /** 删除单个视频项目及其分镜/版本/合成记录/对象存储文件；已发布的案例仅断开来源，不从案例库下架 */
  async deleteProject(projectId: string): Promise<void> {
    const shots = await this.shotRepo.find({ where: { projectId }, select: { id: true } });
    const shotIds = shots.map((shot) => shot.id);
    await this.projectRepo.manager.transaction(async (em) => {
      if (shotIds.length) {
        await em.delete(VideoTakeEntity, { shotId: In(shotIds) });
      }
      await em.delete(ShotEntity, { projectId });
      await em.delete(VideoComposeHistoryEntity, { projectId });
      await em.update(VideoExampleEntity, { sourceProjectId: projectId }, { sourceProjectId: null });
      await em.delete(VideoProjectEntity, { id: projectId });
    });
    await this.storage.removePrefix(`ai-video/${projectId}/`);
  }

  async updateShot(
    projectId: string,
    shotId: string,
    dto: UpdateShotDto,
    locked = false,
  ): Promise<ShotEntity> {
    if (!locked) {
      return this.withProjectMutationLock(projectId, () =>
        this.updateShot(projectId, shotId, dto, true),
      );
    }
    const project = await this.getProject(projectId);
    this.assertProjectEditable(project);
    this.assertNoPendingShots(project, '视频生成期间暂不能编辑分镜');
    this.assertNoPendingBoardImages(project, '参考图生成期间暂不能编辑分镜');
    const shot = await this.getShot(projectId, shotId);
    if (dto.name !== undefined) this.assertReferenceNameAvailable(project, dto.name, shot.id);
    const changes: Partial<
      Pick<
        ShotEntity,
        | 'name'
        | 'videoPrompt'
        | 'durationSec'
        | 'ratio'
        | 'resolution'
        | 'modelId'
        | 'lora'
        | 'activeTakeId'
        | 'videoStatus'
        | 'videoTaskId'
        | 'videoUrl'
        | 'videoError'
        | 'videoProgress'
      >
    > = {};
    if (dto.name !== undefined) changes.name = dto.name.trim();
    if (dto.videoPrompt !== undefined) changes.videoPrompt = dto.videoPrompt;
    const nextModelId = dto.modelId !== undefined ? dto.modelId : shot.modelId;
    if (dto.durationSec !== undefined) changes.durationSec = this.clampDuration(dto.durationSec, nextModelId);
    if (dto.ratio !== undefined) changes.ratio = this.clampRatio(dto.ratio, nextModelId);
    if (dto.resolution !== undefined) changes.resolution = this.clampResolution(dto.resolution, nextModelId);
    if (dto.modelId !== undefined) {
      changes.modelId = dto.modelId;
      const clamped = this.clampDuration(dto.durationSec ?? shot.durationSec, dto.modelId);
      if (clamped !== shot.durationSec) changes.durationSec = clamped;
      changes.ratio = this.clampRatio(dto.ratio ?? shot.ratio, dto.modelId);
      changes.resolution = this.clampResolution(dto.resolution ?? shot.resolution, dto.modelId);
    }
    if (dto.lora !== undefined) changes.lora = dto.lora;
    // 模型/比例等只影响下一次生成：保留当前画面。若该模型曾出过成功版本，切回去时恢复那一版。
    if (dto.modelId !== undefined) {
      await this.assignShotTakeForModel(shot, dto.modelId, changes);
    }
    if (!Object.keys(changes).length) return this.getShotWithTakes(projectId, shot.id);
    const result = await this.shotRepo
      .createQueryBuilder()
      .update(ShotEntity)
      .set(changes)
      .where('id = :shotId AND project_id = :projectId', { shotId, projectId })
      .andWhere('video_status NOT IN (:...statuses)', { statuses: ['queued', 'generating'] })
      .execute();
    if (!result.affected) throw new BadRequestException('分镜已进入生成队列，本次编辑未保存');
    if (changes.name && changes.name !== shot.name) {
      this.rewriteProjectMentions(project, shot.name, changes.name);
      await this.projectRepo.save(project);
      await this.persistShots(project.shots.filter((item) => item.id !== shot.id));
    }
    await this.emitProject(projectId);
    return this.getShotWithTakes(projectId, shot.id);
  }

  /** 切换视频模型时，优先展示该模型最近一次成功结果；没有则继续显示当前画面，不把已生成视频清掉。 */
  private async assignShotTakeForModel(
    shot: ShotEntity,
    modelId: string | null | undefined,
    changes: Partial<ShotEntity>,
  ): Promise<void> {
    const nextModelId = this.modelConfig.resolveStatic('video', modelId).id;
    const currentModelId = this.modelConfig.resolveStatic('video', shot.modelId).id;
    if (nextModelId === currentModelId) return;
    const takes = await this.takeRepo.find({
      where: { shotId: shot.id, status: 'success' },
      order: { version: 'DESC' },
    });
    const match = takes.find((take) => {
      if (!take.videoUrl) return false;
      return this.modelConfig.resolveStatic('video', take.modelId).id === nextModelId;
    });
    if (!match) return;
    changes.activeTakeId = match.id;
    changes.videoStatus = match.status;
    changes.videoTaskId = match.taskId;
    changes.videoUrl = match.videoUrl;
    changes.videoError = match.error;
    changes.videoProgress = match.progress ?? null;
  }

  private clampDuration(value?: number, modelId?: string | null): number {
    const model = this.modelConfig.resolveStatic('video', modelId);
    const min = model.minDuration ?? 4;
    const max = model.maxDuration ?? 15;
    const fallback = Math.min(Math.max(15, min), max);
    return Math.min(max, Math.max(min, Math.round(value ?? fallback)));
  }

  private clampRatio(value?: string | null, modelId?: string | null): string {
    return this.modelConfig.clampRatio('video', value, modelId);
  }

  private clampResolution(value?: string | null, modelId?: string | null): string | null {
    return this.modelConfig.clampResolution('video', value, modelId) ?? null;
  }

  private clampImageRatio(value?: string | null, modelId?: string | null): string {
    return this.modelConfig.clampRatio('image', value, modelId);
  }

  private clampImageResolution(value?: string | null, modelId?: string | null): string | undefined {
    return this.modelConfig.clampResolution('image', value, modelId);
  }

  async addShot(projectId: string, dto: AddShotDto): Promise<VideoProjectEntity> {
    const project = await this.getProject(projectId);
    this.assertProjectEditable(project);
    this.assertNoPendingShots(project, '视频生成期间暂不能增加分镜');
    this.assertNoPendingBoardImages(project, '参考图生成期间暂不能增加分镜');
    const insertAt = Math.min(Math.max(dto.index ?? project.shots.length, 0), project.shots.length);
    const name = dto.name?.trim() || this.nextShotName(project.shots);
    this.assertReferenceNameAvailable(project, name);
    for (const shot of project.shots.filter((shot) => shot.index >= insertAt)) {
      shot.index += 1;
    }
    await this.persistShots(project.shots);
    await this.persistShots(
      this.shotRepo.create({
        projectId,
        index: insertAt,
        name,
        videoPrompt: dto.videoPrompt ?? '',
        durationSec: this.clampDuration(dto.durationSec, dto.modelId),
        ratio: this.clampRatio(dto.ratio, dto.modelId),
        resolution: this.clampResolution(dto.resolution, dto.modelId),
        modelId: dto.modelId ?? null,
        lora: dto.lora ?? null,
      }),
    );
    await this.resetFinalVideo(project);
    return this.emitProject(projectId);
  }

  async archiveShot(projectId: string, shotId: string): Promise<VideoProjectEntity> {
    const project = await this.getProject(projectId);
    this.assertProjectEditable(project);
    this.assertNoPendingShots(project, '视频生成期间暂不能移除分镜');
    this.assertNoPendingBoardImages(project, '参考图生成期间暂不能移除分镜');
    const shot = await this.getShot(projectId, shotId);
    const runningTakeCount = await this.takeRepo
      .createQueryBuilder('take')
      .where('take.shot_id = :shotId', { shotId })
      .andWhere('take.status IN (:...statuses)', { statuses: ['queued', 'generating'] })
      .getCount();
    if (runningTakeCount > 0) {
      throw new BadRequestException('分镜正在生成中，暂不能删除');
    }
    const referenceNames = this.projectReferenceNames(project);
    const referencedBy = [
      ...project.shots
        .filter((item) => item.id !== shot.id && extractMentionNames(item.videoPrompt, referenceNames).includes(shot.name))
        .map((item) => item.name),
      ...project.assets
        .filter((item) => extractMentionNames(item.prompt, referenceNames).includes(shot.name))
        .map((item) => item.name),
    ];
    if (referencedBy.length) {
      throw new BadRequestException(`该分镜仍被 ${referencedBy.map((name) => `“${name}”`).join('、')} 引用，请先移除引用`);
    }
    shot.archivedAt = new Date();
    await this.persistShots(shot);
    await this.removeShotMedia(projectId, shot);
    const remaining = project.shots.filter((item) => item.id !== shotId);
    remaining.forEach((item, index) => {
      item.index = index;
    });
    await this.persistShots(remaining);
    await this.resetFinalVideo(project);
    return this.emitProject(projectId);
  }

  /** 分镜从页面移除后，删掉这一镜自己的成片。参考素材文件留给仍在使用的素材和版本。 */
  private async removeShotMedia(projectId: string, shot: ShotEntity): Promise<void> {
    const takes = await this.takeRepo.find({ where: { shotId: shot.id }, select: { id: true, videoUrl: true } });
    const keys = [shot.videoUrl, ...takes.map((take) => take.videoUrl)];
    for (const value of keys) {
      if (!value) continue;
      const key = this.storage.toObjectName(value);
      if (!key.startsWith(`ai-video/${projectId}/shots/`)) continue;
      await this.storage.remove(key);
    }
  }

  /**
   * 素材被删掉或替换后，项目里已经没有引用的对象才从 TOS 删除。
   * 分镜历史版本、成片记录和已发布案例仍引用的文件会留下。
   */
  private async removeUnreferencedProjectFiles(
    projectId: string,
    values: Array<string | null | undefined>,
  ): Promise<void> {
    const keys = [...new Set(values.map((value) => (value ? this.storage.toObjectName(value) : '')).filter((key) => key.startsWith(`ai-video/${projectId}/`)))];
    if (!keys.length) return;
    const shots = await this.shotRepo.find({ where: { projectId }, select: { id: true, videoUrl: true } });
    const shotIds = shots.map((shot) => shot.id);
    const takes = shotIds.length
      ? await this.takeRepo.find({
          where: { shotId: In(shotIds) },
          select: { videoUrl: true, referenceImages: true, referenceVideos: true, referenceAudios: true },
        })
      : [];
    const history = await this.composeHistoryRepo.find({
      where: { projectId },
      select: { videoUrl: true, coverUrl: true },
    });
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
      select: { id: true, assets: true, finalVideoUrl: true, finalVideoCoverUrl: true },
    });
    const held = new Set<string>();
    const hold = (value?: string | null) => {
      if (!value) return;
      const key = this.storage.toObjectName(value);
      if (key) held.add(key);
    };
    for (const asset of project?.assets ?? []) hold(asset.url);
    hold(project?.finalVideoUrl);
    hold(project?.finalVideoCoverUrl);
    for (const shot of shots) hold(shot.videoUrl);
    for (const take of takes) {
      hold(take.videoUrl);
      for (const url of take.referenceImages ?? []) hold(url);
      for (const url of take.referenceVideos ?? []) hold(url);
      for (const url of take.referenceAudios ?? []) hold(url);
    }
    for (const item of history) {
      hold(item.videoUrl);
      hold(item.coverUrl);
    }
    for (const key of keys) {
      if (held.has(key)) continue;
      const usedByExample = await this.exampleRepo.manager.query(
        `SELECT 1 FROM video_examples WHERE position($1 in snapshot::text) > 0 OR position($1 in coalesce(cover_url, '')) > 0 LIMIT 1`,
        [key],
      );
      if (usedByExample.length) continue;
      await this.storage.remove(key);
    }
  }

  async reorderShots(projectId: string, shotIds: string[]): Promise<VideoProjectEntity> {
    const project = await this.getProject(projectId);
    this.assertProjectEditable(project);
    this.assertNoPendingShots(project, '视频生成期间暂不能重排分镜');
    this.assertNoPendingBoardImages(project, '参考图生成期间暂不能重排分镜');
    const runningTakeCount = project.shots.length
      ? await this.takeRepo
          .createQueryBuilder('take')
          .where('take.shot_id IN (:...shotIds)', { shotIds: project.shots.map((shot) => shot.id) })
          .andWhere('take.status IN (:...statuses)', { statuses: ['queued', 'generating'] })
          .getCount()
      : 0;
    if (runningTakeCount > 0) {
      throw new BadRequestException('存在正在生成的分镜，暂不能重排');
    }
    const currentIds = project.shots.map((shot) => shot.id);
    if (
      shotIds.length !== currentIds.length ||
      new Set(shotIds).size !== shotIds.length ||
      currentIds.some((id) => !shotIds.includes(id))
    ) {
      throw new BadRequestException('shotIds 必须完整包含当前项目全部未归档分镜，且不能重复');
    }
    const byId = new Map(project.shots.map((shot) => [shot.id, shot]));
    const reordered = shotIds.map((id, index) => Object.assign(byId.get(id)!, { index }));
    await this.persistShots(reordered);
    await this.resetFinalVideo(project);
    return this.emitProject(projectId);
  }

  async updateProjectSettings(projectId: string, generationMode: GenerationMode): Promise<VideoProjectEntity> {
    const project = await this.getProject(projectId);
    this.assertProjectEditable(project);
    this.assertNoPendingShots(project, '存在排队或生成中的分镜，暂不能切换生成策略');
    this.assertNoPendingBoardImages(project, '参考图生成期间暂不能切换生成策略');
    project.generationMode = generationMode;
    await this.projectRepo.save(project);
    return this.emitProject(projectId);
  }

  async updateProjectTitle(projectId: string, title: string): Promise<VideoProjectEntity> {
    const next = title.trim();
    if (!next) throw new BadRequestException('标题不能为空');
    const project = await this.getProject(projectId);
    project.title = next.slice(0, 255);
    await this.projectRepo.save(project);
    if (project.sessionId) {
      await this.sessionRepo.update({ id: project.sessionId }, { title: project.title });
    }
    return this.emitProject(projectId);
  }

  async selectTake(projectId: string, shotId: string, takeId: string): Promise<ShotEntity> {
    const project = await this.getProject(projectId);
    this.assertProjectEditable(project);
    this.assertNoPendingShots(project, '视频生成期间暂不能切换视频版本');
    this.assertNoPendingBoardImages(project, '参考图生成期间暂不能切换视频版本');
    const shot = await this.getShot(projectId, shotId);
    const runningTakeCount = await this.takeRepo
      .createQueryBuilder('take')
      .where('take.shot_id = :shotId', { shotId })
      .andWhere('take.status IN (:...statuses)', { statuses: ['queued', 'generating'] })
      .getCount();
    if (runningTakeCount > 0) throw new BadRequestException('分镜正在生成中，暂不能切换视频版本');
    const take = await this.takeRepo.findOne({ where: { id: takeId, shotId } });
    if (!take) throw new NotFoundException('视频版本不存在');
    if (take.status !== 'success' || !take.videoUrl) throw new BadRequestException('只能选择已成功的视频版本');
    const result = await this.shotRepo
      .createQueryBuilder()
      .update(ShotEntity)
      .set({
        activeTakeId: take.id,
        videoStatus: take.status,
        videoTaskId: take.taskId,
        videoUrl: take.videoUrl,
        videoError: take.error,
      })
      .where('id = :shotId AND project_id = :projectId', { shotId, projectId })
      .andWhere('video_status NOT IN (:...statuses)', { statuses: ['queued', 'generating'] })
      .execute();
    if (!result.affected) throw new BadRequestException('分镜已进入生成队列，暂不能切换视频版本');
    await this.invalidateShotsDependingOnShot(project, shot.name);
    await this.resetFinalVideo(project);
    await this.emitProject(projectId);
    return this.getShotWithTakes(projectId, shotId);
  }

  private nextShotName(shots: ShotEntity[]): string {
    const names = new Set(shots.map((shot) => shot.name));
    let index = 1;
    while (names.has(`分镜${index}`)) index += 1;
    return `分镜${index}`;
  }

  private nextAssetName(project: VideoProjectEntity): string {
    const names = new Set([
      ...project.assets.map((asset) => asset.name),
      ...project.shots.map((shot) => shot.name),
    ]);
    let index = 1;
    while (names.has(`素材${index}`)) index += 1;
    return `素材${index}`;
  }

  private assertReferenceNameAvailable(project: VideoProjectEntity, value: string, excludeId?: string): void {
    const name = value.trim();
    this.assertSafeReferenceName(name);
    const existing = [
      ...project.assets.map((ref) => ({ id: ref.id, name: ref.name })),
      ...project.shots.map((shot) => ({ id: shot.id, name: shot.name })),
    ].find((item) => item.id !== excludeId && item.name === name);
    if (existing) throw new BadRequestException(`名称“${name}”已被使用，请换一个名称`);
  }

  private assertSafeReferenceName(name: string): void {
    if (!name) throw new BadRequestException('引用名称不能为空');
    if (/[\s,，。!！?？、@：:；;（）()【】[\]“”"'‘’]/.test(name)) {
      throw new BadRequestException(`名称“${name}”包含空格或不支持的标点`);
    }
  }

  /** 素材名 + 分镜名，供 @ 最长匹配。短名称不能抢掉更长的 @图片10。 */
  private projectReferenceNames(project: Pick<VideoProjectEntity, 'assets' | 'shots'>): string[] {
    return [...project.assets.map((item) => item.name), ...project.shots.map((item) => item.name)];
  }

  private validateStoryboardMentions(input: CreateStoryboardInput, shotNames: string[]): void {
    const assetNames = new Set(input.assets.map((ref) => ref.name.trim()));
    const knownNames = [...assetNames, ...shotNames];
    const assetByName = new Map(input.assets.map((ref) => [ref.name.trim(), ref]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visitAsset = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) throw new BadRequestException(`素材引用存在循环：@${name}`);
      visiting.add(name);
      const asset = assetByName.get(name)!;
      // 上传素材直接转存，prompt 只是备注，不构成生成依赖
      for (const dependency of asset.uploadedFilePath ? [] : extractMentionNames(asset.prompt, knownNames)) {
        if (!assetNames.has(dependency)) {
          throw new BadRequestException(`素材“${name}”包含未知引用：@${dependency}`);
        }
        if (dependency === name) throw new BadRequestException(`素材“${name}”不能引用自身`);
        visitAsset(dependency);
      }
      visiting.delete(name);
      visited.add(name);
    };
    input.assets.forEach((asset) => visitAsset(asset.name.trim()));

    const shotIndexByName = new Map(shotNames.map((name, index) => [name, index]));
    input.shots.forEach((shot, index) => {
      for (const name of extractMentionNames(shot.videoPrompt, knownNames)) {
        if (assetNames.has(name)) continue;
        const referencedIndex = shotIndexByName.get(name);
        if (referencedIndex === undefined) {
          throw new BadRequestException(`“${shotNames[index]}”包含未知引用：@${name}`);
        }
        if (referencedIndex >= index) {
          throw new BadRequestException(`“${shotNames[index]}”只能引用更早的分镜，不能引用 @${name}`);
        }
      }
    });
  }

  private async resetFinalVideo(project: VideoProjectEntity): Promise<void> {
    const reset = {
      finalVideoStatus: 'idle' as const,
      finalVideoUrl: null,
      finalVideoError: null,
      composeToken: null,
      status: 'draft' as const,
    };
    const result = await this.projectRepo
      .createQueryBuilder()
      .update(VideoProjectEntity)
      .set(reset)
      .where('id = :projectId', { projectId: project.id })
      .andWhere('status != :composing', { composing: 'composing' })
      .execute();
    if (!result.affected) throw new BadRequestException('成片正在合成，本次修改未生效');
    Object.assign(project, reset);
  }

  private async invalidateShotsUsingAsset(
    project: VideoProjectEntity,
    assetName: string,
    preserveAssetIds?: Set<string>,
  ): Promise<void> {
    const affectedAssetNames = new Set([assetName]);
    let changed = true;
    while (changed) {
      changed = false;
      // 只有 AI 生成的图片素材会 @ 其它素材；上传素材的 prompt 只是备注，不构成依赖
      for (const asset of project.assets) {
        if (affectedAssetNames.has(asset.name)) continue;
        if (!this.isAssetDependent(asset)) continue;
        if (extractMentionNames(asset.prompt, this.projectReferenceNames(project)).some((name) => affectedAssetNames.has(name))) {
          affectedAssetNames.add(asset.name);
          // 即将入队的素材保留旧图，排队被中断时还能回退到上一张
          if (!preserveAssetIds?.has(asset.id)) {
            asset.status = 'idle';
            asset.url = undefined;
            asset.error = undefined;
          }
          changed = true;
        }
      }
    }

    const affectedShotNames = new Set<string>();
    changed = true;
    while (changed) {
      changed = false;
      for (const shot of project.shots) {
        if (affectedShotNames.has(shot.name)) continue;
        const mentions = extractMentionNames(shot.videoPrompt, this.projectReferenceNames(project));
        const assetChanged = mentions.some((name) => {
          if (!affectedAssetNames.has(name)) return false;
          const asset = project.assets.find((item) => item.name === name);
          return !asset || !preserveAssetIds?.has(asset.id);
        });
        if (assetChanged || mentions.some((name) => affectedShotNames.has(name))) {
          affectedShotNames.add(shot.name);
          changed = true;
        }
      }
    }

    const affected = project.shots.filter((shot) => affectedShotNames.has(shot.name));
    for (const shot of affected) {
      shot.activeTakeId = null;
      shot.videoStatus = 'idle';
      shot.videoTaskId = null;
      shot.videoUrl = null;
      shot.videoError = null;
    }
    await this.persistShots(affected);
    await this.resetFinalVideo(project);
  }

  private async invalidateShotsDependingOnShot(project: VideoProjectEntity, shotName: string): Promise<void> {
    const affectedNames = new Set([shotName]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const shot of project.shots) {
        if (affectedNames.has(shot.name)) continue;
        if (extractMentionNames(shot.videoPrompt, this.projectReferenceNames(project)).some((name) => affectedNames.has(name))) {
          affectedNames.add(shot.name);
          changed = true;
        }
      }
    }
    const downstream = project.shots.filter(
      (shot) =>
        shot.name !== shotName
        && affectedNames.has(shot.name)
        && shot.videoStatus !== 'queued'
        && shot.videoStatus !== 'generating',
    );
    downstream.forEach((shot) => {
      shot.activeTakeId = null;
      shot.videoStatus = 'idle';
      shot.videoTaskId = null;
      shot.videoUrl = null;
      shot.videoError = null;
    });
    await this.persistShots(downstream);
  }

  private assertProjectEditable(project: VideoProjectEntity): void {
    if (project.status === 'composing' || project.finalVideoStatus === 'generating') {
      throw new BadRequestException('成片正在合成中，暂不能修改分镜或生成设置');
    }
  }

  private assertNoPendingShots(project: VideoProjectEntity, message: string): void {
    if (project.shots.some((shot) => shot.videoStatus === 'queued' || shot.videoStatus === 'generating')) {
      throw new BadRequestException(message);
    }
  }

  private assertNoPendingBoardImages(project: VideoProjectEntity, message: string): void {
    if (project.assets.some((ref) => ref.status === 'queued' || ref.status === 'generating')) {
      throw new BadRequestException(message);
    }
  }

  private beginAssetImageJob(ref: MediaAsset): void {
    ref.status = 'queued';
    ref.error = undefined;
    ref.epoch = (ref.epoch ?? 0) + 1;
  }

  private restoreQueuedAsset(ref: MediaAsset): void {
    if (ref.status !== 'queued') return;
    ref.status = ref.url ? 'success' : 'idle';
    ref.error = undefined;
  }

  private assetKindLabel(kind: AssetKind): string {
    return kind === 'text' ? '文本' : ASSET_UPLOAD_LIMITS[kind].label;
  }

  /** 只有 AI 生成的图片素材能出图：上传素材用替换文件，视频/音频/文本走各自的入口 */
  private assertAssetImageGeneratable(ref: MediaAsset): void {
    if (ref.kind !== 'image') {
      throw new BadRequestException(
        `“${ref.name}”是${this.assetKindLabel(ref.kind)}素材，不能按图片生成`,
      );
    }
    if (ref.source !== 'generated') {
      throw new BadRequestException(`“${ref.name}”是本地上传素材，请使用"替换文件"更新内容`);
    }
    if (!ref.prompt?.trim()) {
      throw new BadRequestException('请先填写特征提示词');
    }
  }

  private async getShot(projectId: string, shotId: string): Promise<ShotEntity> {
    const shot = await this.shotRepo.findOne({ where: { id: shotId, projectId, archivedAt: IsNull() } });
    if (!shot) throw new NotFoundException('分镜不存在');
    return shot;
  }

  private async getShotWithTakes(projectId: string, shotId: string): Promise<ShotEntity> {
    const shot = await this.getShot(projectId, shotId);
    shot.takes = await this.takeRepo.find({ where: { shotId }, order: { version: 'DESC' } });
    return this.presentShot(shot);
  }

  /**
   * Shot 同时声明了 projectId 列与 @ManyToOne/@JoinColumn(project_id)。
   * 从 DB 查出且未加载 project 关联时直接 save，TypeORM 会把 project_id 写成 null。
   */
  private async persistShots(shots: ShotEntity | ShotEntity[]): Promise<void> {
    const list = (Array.isArray(shots) ? shots : [shots]).filter(Boolean);
    if (!list.length) return;
    for (const shot of list) {
      if (shot.projectId) shot.project = { id: shot.projectId } as VideoProjectEntity;
    }
    await this.shotRepo.save(list);
  }

  /** 推送最新项目数据给该项目房间内的全部客户端（多端同步 + 后台任务完成通知），并返回最新数据 */
  private async emitProject(projectId: string): Promise<VideoProjectEntity> {
    const project = this.presentProject(await this.getProject(projectId));
    this.gateway.emitProjectUpdated(project);
    return project;
  }

  /** 出站给前端：对象键拼成公网 URL。内部读写仍用 getProject 的原始对象键。 */
  private presentProject(project: VideoProjectEntity): VideoProjectEntity {
    const copy = JSON.parse(JSON.stringify(project)) as VideoProjectEntity;
    for (const asset of copy.assets ?? []) {
      if (asset.url) asset.url = this.storage.toPublicUrl(asset.url);
    }
    if (copy.finalVideoUrl) copy.finalVideoUrl = this.storage.toPublicUrl(copy.finalVideoUrl);
    if (copy.finalVideoCoverUrl) copy.finalVideoCoverUrl = this.storage.toPublicUrl(copy.finalVideoCoverUrl);
    for (const shot of copy.shots ?? []) this.presentShotUrls(shot);
    for (const item of copy.composeHistory ?? []) {
      if (item.videoUrl) item.videoUrl = this.storage.toPublicUrl(item.videoUrl);
      if (item.coverUrl) item.coverUrl = this.storage.toPublicUrl(item.coverUrl);
    }
    return copy;
  }

  /** 单条分镜出站：与项目出站同一套 URL 规则，避免保存分镜后把公网地址盖成对象键。 */
  private presentShot(shot: ShotEntity): ShotEntity {
    const copy = JSON.parse(JSON.stringify(shot)) as ShotEntity;
    this.presentShotUrls(copy);
    return copy;
  }

  private presentShotUrls(shot: ShotEntity): void {
    if (shot.videoUrl) shot.videoUrl = this.storage.toPublicUrl(shot.videoUrl);
    for (const take of shot.takes ?? []) {
      if (take.videoUrl) take.videoUrl = this.storage.toPublicUrl(take.videoUrl);
      take.referenceImages = (take.referenceImages ?? []).map((url) => this.storage.toPublicUrl(url));
      take.referenceVideos = (take.referenceVideos ?? []).map((url) => this.storage.toPublicUrl(url));
      take.referenceAudios = (take.referenceAudios ?? []).map((url) => this.storage.toPublicUrl(url));
    }
  }

  private presentExample(example: VideoExampleEntity, slim = false): VideoExampleEntity {
    const copy = JSON.parse(JSON.stringify(example)) as VideoExampleEntity;
    if (copy.coverUrl) copy.coverUrl = this.storage.toPublicUrl(copy.coverUrl);
    if (slim) {
      copy.snapshot = null;
      return copy;
    }
    if (copy.snapshot) copy.snapshot = this.presentExampleSnapshot(copy.snapshot);
    return copy;
  }

  /** 案例快照出站：对象键拼成公网 URL，复用项目出站同一套规则 */
  private presentExampleSnapshot(snapshot: ExampleProjectSnapshot): ExampleProjectSnapshot {
    const presented = this.presentProject({
      assets: snapshot.assets,
      shots: snapshot.shots,
      composeHistory: [],
      finalVideoUrl: snapshot.finalVideoUrl,
      finalVideoCoverUrl: snapshot.finalVideoCoverUrl,
    } as unknown as VideoProjectEntity);
    return {
      ...snapshot,
      assets: presented.assets,
      shots: presented.shots as unknown as ExampleProjectSnapshot['shots'],
      finalVideoUrl: presented.finalVideoUrl,
      finalVideoCoverUrl: presented.finalVideoCoverUrl,
    };
  }

  private exampleStoragePrefix(exampleId: string): string {
    return `ai-video/examples/${exampleId}/`;
  }

  private rewriteStorageKey(
    value: string | null | undefined,
    fromPrefix: string,
    toPrefix: string,
  ): string | null | undefined {
    if (!value) return value;
    const key = this.storage.toObjectName(value);
    return key.startsWith(fromPrefix) ? toPrefix + key.slice(fromPrefix.length) : key;
  }

  /** 只收集当前成片 / 封面 / 素材 / 分镜视频，不含历史版本 */
  private latestMediaKeys(input: {
    finalVideoUrl?: string | null;
    finalVideoCoverUrl?: string | null;
    assets?: { url?: string }[];
    shots?: { videoUrl?: string | null }[];
  }): string[] {
    const keys: string[] = [];
    const add = (value?: string | null) => {
      if (!value) return;
      const key = this.storage.toObjectName(value);
      if (key && !keys.includes(key)) keys.push(key);
    };
    add(input.finalVideoUrl);
    add(input.finalVideoCoverUrl);
    for (const asset of input.assets ?? []) add(asset.url);
    for (const shot of input.shots ?? []) add(shot.videoUrl);
    return keys;
  }

  private async copyRewrittenKeys(keys: string[], fromPrefix: string, toPrefix: string): Promise<void> {
    for (const key of keys) {
      const dest = this.rewriteStorageKey(key, fromPrefix, toPrefix);
      if (!dest || dest === key) continue;
      await this.storage.copyObject(key, dest);
    }
  }

  /** 把当前工作台最新内容打成案例快照，对象键改写到案例目录 */
  private buildExampleSnapshot(
    project: VideoProjectEntity,
    fromPrefix: string,
    toPrefix: string,
  ): ExampleProjectSnapshot {
    return {
      generationMode: project.generationMode,
      status: project.status,
      finalVideoUrl: this.rewriteStorageKey(project.finalVideoUrl, fromPrefix, toPrefix) ?? null,
      finalVideoCoverUrl: this.rewriteStorageKey(project.finalVideoCoverUrl, fromPrefix, toPrefix) ?? null,
      finalVideoStatus: project.finalVideoStatus,
      assets: (project.assets ?? []).map((asset) => ({
        ...asset,
        url: this.rewriteStorageKey(asset.url, fromPrefix, toPrefix) ?? undefined,
        predictionId: undefined,
        predictionStartedAt: undefined,
      })),
      shots: (project.shots ?? []).map((shot) => ({
        id: shot.id,
        index: shot.index,
        name: shot.name,
        videoPrompt: shot.videoPrompt,
        durationSec: shot.durationSec,
        ratio: shot.ratio,
        resolution: shot.resolution,
        modelId: shot.modelId,
        lora: shot.lora,
        videoUrl: this.rewriteStorageKey(shot.videoUrl, fromPrefix, toPrefix) ?? null,
        videoStatus: shot.videoStatus,
        videoError: shot.videoError,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  素材库（图片 / 视频 / 音频）
  // ═══════════════════════════════════════════════════════════

  private rewriteProjectMentions(project: VideoProjectEntity, oldName: string, newName: string): void {
    const names = [...this.projectReferenceNames(project), oldName];
    for (const ref of project.assets) {
      ref.prompt = replaceMentionName(ref.prompt, oldName, newName, names);
    }
    for (const shot of project.shots) {
      shot.videoPrompt = replaceMentionName(shot.videoPrompt, oldName, newName, names);
    }
  }

  private stripProjectMentions(project: VideoProjectEntity, name: string): void {
    const names = [...this.projectReferenceNames(project), name];
    for (const ref of project.assets) {
      ref.prompt = removeMentionName(ref.prompt, name, names);
    }
    for (const shot of project.shots) {
      shot.videoPrompt = removeMentionName(shot.videoPrompt, name, names);
    }
  }

  private findAsset(project: VideoProjectEntity, refId: string): MediaAsset {
    const ref = project.assets.find((item) => item.id === refId);
    if (!ref) throw new NotFoundException('素材不存在');
    return ref;
  }

  async addAsset(projectId: string, dto: AddAssetDto, locked = false): Promise<VideoProjectEntity> {
    if (!locked) {
      return this.withProjectMutationLock(projectId, () => this.addAsset(projectId, dto, true));
    }
    const project = await this.getProject(projectId);
    this.assertProjectEditable(project);
    this.assertNoPendingShots(project, '视频生成期间暂不能修改引用素材');
    this.assertNoPendingBoardImages(project, '参考图生成期间暂不能修改素材板');
    const name = dto.name?.trim() || this.nextAssetName(project);
    this.assertReferenceNameAvailable(project, name);
    const body = dto.text?.trim() ?? '';
    project.assets.push(
      dto.kind === 'text'
        ? {
            id: randomUUID(),
            name,
            kind: 'text',
            source: 'generated',
            prompt: dto.prompt ?? '',
            text: body,
            status: body ? 'success' : 'idle',
          }
        : {
            id: randomUUID(),
            name,
            kind: 'image',
            source: 'generated',
            prompt: dto.prompt ?? '',
            status: 'idle',
            modelId: dto.modelId,
            lora: dto.lora ?? null,
            ratio: this.clampImageRatio(dto.ratio, dto.modelId),
            resolution: this.clampImageResolution(dto.resolution, dto.modelId),
            outputFormat: this.modelConfig.clampOutputFormat(dto.outputFormat, dto.modelId),
            promptOptimizeMode: this.modelConfig.clampPromptOptimizeMode(dto.promptOptimizeMode, dto.modelId),
          },
    );
    this.validateAssetGraph(project.assets, this.projectReferenceNames(project));
    await this.projectRepo.save(project);
    return this.emitProject(projectId);
  }

  async reorderAssets(projectId: string, assetIds: string[], locked = false): Promise<VideoProjectEntity> {
    if (!locked) {
      return this.withProjectMutationLock(projectId, () => this.reorderAssets(projectId, assetIds, true));
    }
    const project = await this.getProject(projectId);
    this.assertProjectEditable(project);
    this.assertNoPendingShots(project, '视频生成期间暂不能重排素材');
    this.assertNoPendingBoardImages(project, '参考图生成期间暂不能重排素材');
    const currentIds = project.assets.map((asset) => asset.id);
    if (
      assetIds.length !== currentIds.length ||
      new Set(assetIds).size !== assetIds.length ||
      currentIds.some((id) => !assetIds.includes(id))
    ) {
      throw new BadRequestException('assetIds 必须完整包含当前项目全部素材，且不能重复');
    }
    const byId = new Map(project.assets.map((asset) => [asset.id, asset]));
    project.assets = assetIds.map((id) => byId.get(id)!);
    await this.projectRepo.save(project);
    return this.emitProject(projectId);
  }

  async updateAsset(
    projectId: string,
    refId: string,
    dto: UpdateAssetDto,
    locked = false,
  ): Promise<VideoProjectEntity> {
    if (!locked) {
      return this.withProjectMutationLock(projectId, () =>
        this.updateAsset(projectId, refId, dto, true),
      );
    }
    const project = await this.getProject(projectId);
    this.assertProjectEditable(project);
    this.assertNoPendingShots(project, '视频生成期间暂不能修改引用素材');
    this.assertNoPendingBoardImages(project, '参考图生成期间暂不能修改素材板');
    if (dto.name !== undefined) this.assertReferenceNameAvailable(project, dto.name, refId);
    const ref = this.findAsset(project, refId);
    const oldName = ref.name;
    if (ref.kind === 'text') {
      if (dto.name !== undefined) ref.name = dto.name.trim();
      if (dto.prompt !== undefined) ref.prompt = dto.prompt;
      if (dto.text !== undefined && ref.status !== 'generating' && ref.status !== 'queued') {
        ref.text = dto.text;
        ref.status = dto.text.trim() ? 'success' : 'idle';
        ref.error = undefined;
      }
      if (ref.name !== oldName) this.rewriteProjectMentions(project, oldName, ref.name);
      this.validateAssetGraph(project.assets, this.projectReferenceNames(project));
      await this.projectRepo.save(project);
      if (ref.name !== oldName) await this.persistShots(project.shots);
      return this.emitProject(projectId);
    }
    const nextModelId = dto.modelId !== undefined ? dto.modelId : ref.modelId;
    Object.assign(ref, {
      ...dto,
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.ratio !== undefined || dto.modelId !== undefined
        ? { ratio: this.clampImageRatio(dto.ratio ?? ref.ratio, nextModelId) }
        : {}),
      ...(dto.resolution !== undefined || dto.modelId !== undefined
        ? { resolution: this.clampImageResolution(dto.resolution ?? ref.resolution, nextModelId) }
        : {}),
      ...(dto.outputFormat !== undefined || dto.modelId !== undefined
        ? { outputFormat: this.modelConfig.clampOutputFormat(dto.outputFormat ?? ref.outputFormat, nextModelId) }
        : {}),
      ...(dto.promptOptimizeMode !== undefined || dto.modelId !== undefined
        ? {
            promptOptimizeMode: this.modelConfig.clampPromptOptimizeMode(
              dto.promptOptimizeMode ?? ref.promptOptimizeMode,
              nextModelId,
            ),
          }
        : {}),
    });
    if (ref.name !== oldName) this.rewriteProjectMentions(project, oldName, ref.name);
    this.validateAssetGraph(project.assets, this.projectReferenceNames(project));
    // 改模型/比例/提示词只影响下一次生成，不清掉已出的参考图；真正重新出图时再失效依赖分镜
    await this.projectRepo.save(project);
    if (ref.name !== oldName) await this.persistShots(project.shots);
    return this.emitProject(projectId);
  }

  async deleteAsset(
    projectId: string,
    refId: string,
    locked = false,
  ): Promise<VideoProjectEntity> {
    if (!locked) {
      return this.withProjectMutationLock(projectId, () =>
        this.deleteAsset(projectId, refId, true),
      );
    }
    const project = await this.getProject(projectId);
    this.assertProjectEditable(project);
    this.assertNoPendingShots(project, '视频生成期间暂不能删除引用素材');
    this.assertNoPendingBoardImages(project, '参考图生成期间暂不能删除素材');
    const index = project.assets.findIndex((item) => item.id === refId);
    if (index < 0) throw new NotFoundException('素材不存在');
    const ref = project.assets[index];
    if (ref.status === 'queued' || ref.status === 'generating') {
      throw new BadRequestException('该参考图正在生成，暂不能删除');
    }
    const removedFiles = [ref.url];
    const urlsBefore = new Map(project.assets.map((item) => [item.id, item.url]));
    await this.invalidateShotsUsingAsset(project, ref.name);
    for (const asset of project.assets) {
      const previous = urlsBefore.get(asset.id);
      if (previous && previous !== asset.url) removedFiles.push(previous);
    }
    project.assets.splice(index, 1);
    this.stripProjectMentions(project, ref.name);
    await this.projectRepo.save(project);
    await this.persistShots(project.shots);
    await this.removeUnreferencedProjectFiles(projectId, removedFiles);
    return this.emitProject(projectId);
  }

  /** 生成/重新生成角色定妆图或场景参考图（异步执行，立即返回 generating 状态） */
  async generateAssetImage(
    projectId: string,
    refId: string,
    locked = false,
  ): Promise<VideoProjectEntity> {
    if (!locked) {
      return this.withProjectMutationLock(projectId, () =>
        this.generateAssetImage(projectId, refId, true),
      );
    }
    const project = await this.getProject(projectId);
    this.assertProjectEditable(project);
    this.assertNoPendingShots(project, '视频生成期间暂不能重新生成引用素材');
    this.assertNoPendingBoardImages(project, '已有参考图正在生成，请等待完成后再提交');
    const ref = this.findAsset(project, refId);
    this.assertAssetImageGeneratable(ref);
    this.validateAssetGraph(project.assets, this.projectReferenceNames(project));
    if (ref.status === 'queued' || ref.status === 'generating') {
      throw new BadRequestException('该参考图已在队列中，请勿重复提交');
    }
    this.beginAssetImageJob(ref);
    await this.projectRepo.save(project);

    try {
      await this.imageQueue.add(
        'generate',
        { projectId, refId, ...billingJob() },
        { jobId: `image-${projectId}-${refId}-${randomUUID()}`, removeOnComplete: true, removeOnFail: true },
      );
    } catch (error) {
      ref.status = 'failed';
      ref.error = `任务入队失败：${error instanceof Error ? error.message : String(error)}`;
      await this.projectRepo.save(project);
      await this.emitProject(projectId);
      throw new BadRequestException('参考图任务入队失败，请稍后重试');
    }

    return this.emitProject(projectId);
  }

  /**
   * 生成文本素材正文。模型调用放在锁外面，避免一次写作占着项目锁几十秒；
   * 开始前标成 generating，写回时只覆盖仍处于 generating 的那一条。
   */
  async generateAssetText(projectId: string, refId: string): Promise<VideoProjectEntity> {
    const prompt = await this.withProjectMutationLock(projectId, async () => {
      const project = await this.getProject(projectId);
      this.assertProjectEditable(project);
      this.assertNoPendingShots(project, '视频生成期间暂不能生成文本');
      this.assertNoPendingBoardImages(project, '已有素材正在生成，请等待完成后再提交');
      const ref = this.findAsset(project, refId);
      if (ref.kind !== 'text') throw new BadRequestException('只有文本素材可以生成正文');
      if (!ref.prompt?.trim()) throw new BadRequestException('请先填写要写的内容');
      const pool = this.mentionPoolFor(project, refId);
      this.assertNoUnknownMentions(ref.prompt, pool, project);
      const compiled = composeMentionPrompt(ref.prompt, resolveMentionRefs(ref.prompt, pool));
      ref.status = 'generating';
      ref.error = undefined;
      await this.projectRepo.save(project);
      return compiled;
    });
    await this.emitProject(projectId);

    try {
      const { text } = await generateText({
        model: this.atlasLlm.text(),
        prompt,
        maxOutputTokens: 2000,
      });
      return this.withProjectMutationLock(projectId, async () => {
        const latest = await this.getProject(projectId);
        const latestRef = latest.assets.find((item) => item.id === refId);
        if (!latestRef || latestRef.status !== 'generating') return this.emitProject(projectId);
        latestRef.text = text.trim();
        if (!latestRef.text) {
          latestRef.status = 'failed';
          latestRef.error = '没有生成出内容';
          await this.projectRepo.save(latest);
          await this.emitProject(projectId);
          throw new BadRequestException('没有生成出内容');
        }
        latestRef.status = 'success';
        latestRef.error = undefined;
        await this.projectRepo.save(latest);
        return this.emitProject(projectId);
      });
    } catch (error) {
      const message = error instanceof BadRequestException
        ? error.message
        : (error instanceof Error ? error.message : '文本生成失败');
      await this.withProjectMutationLock(projectId, async () => {
        const latest = await this.getProject(projectId);
        const latestRef = latest.assets.find((item) => item.id === refId);
        if (!latestRef || latestRef.status !== 'generating') return;
        latestRef.status = 'failed';
        latestRef.error = message.slice(0, 500);
        await this.projectRepo.save(latest);
        await this.emitProject(projectId);
      });
      throw new BadRequestException(message);
    }
  }

  /** 按依赖顺序生成选中的 AI 图片素材。 */
  async generateAllAssetImages(
    projectId: string,
    assetIds: string[],
    locked = false,
  ): Promise<VideoProjectEntity> {
    if (!locked) {
      return this.withProjectMutationLock(projectId, () =>
        this.generateAllAssetImages(projectId, assetIds, true),
      );
    }
    const project = await this.getProject(projectId);
    this.assertProjectEditable(project);
    this.assertNoPendingShots(project, '视频生成期间暂不能重新生成引用素材');
    this.assertNoPendingBoardImages(project, '已有参考图正在生成，请等待完成后再批量生成');
    if (new Set(assetIds).size !== assetIds.length) {
      throw new BadRequestException('assetIds 不能重复');
    }
    const selected = assetIds.map((id) => this.findAsset(project, id));
    selected.forEach((ref) => this.assertAssetImageGeneratable(ref));
    this.validateAssetGraph(project.assets, this.projectReferenceNames(project));
    this.assertSelectedAssetDependencies(project, selected);

    const jobs = this.sortAssetsByDependencies(selected, project.assets, this.projectReferenceNames(project)).map((ref) => ref.id);
    for (const refId of jobs) {
      const ref = this.findAsset(project, refId);
      this.beginAssetImageJob(ref);
    }
    await this.projectRepo.save(project);
    const [first, ...remaining] = jobs;
    try {
      await this.imageQueue.add(
        'generate',
        {
          projectId,
          refId: first,
          remainingRefIds: remaining,
          ...billingJob(),
        },
        {
          jobId: `image-${projectId}-${first}-${randomUUID()}`,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      const message = `任务入队失败：${error instanceof Error ? error.message : String(error)}`;
      jobs.forEach((refId) => {
        const ref = this.findAsset(project, refId);
        ref.status = 'failed';
        ref.error = message;
      });
      await this.projectRepo.save(project);
      await this.emitProject(projectId);
      throw new BadRequestException('参考图批量任务入队失败，请稍后重试');
    }
    return this.emitProject(projectId);
  }

  /** 停止排队和正在生成的素材任务，并退回已扣费用。已有成图的素材回到上一张。 */
  async cancelQueuedAssetImages(projectId: string, locked = false): Promise<VideoProjectEntity> {
    if (!locked) {
      return this.withProjectMutationLock(projectId, () =>
        this.cancelQueuedAssetImages(projectId, true),
      );
    }
    const project = await this.getProject(projectId);
    const refundIds: string[] = [];
    let changed = false;
    for (const ref of project.assets) {
      if (ref.status === 'queued') {
        this.restoreQueuedAsset(ref);
        changed = true;
        continue;
      }
      if (ref.status !== 'generating') continue;
      if (ref.predictionId) refundIds.push(ref.predictionId);
      if (ref.url || (ref.kind === 'text' && ref.text?.trim())) {
        ref.status = 'success';
        ref.error = undefined;
      } else {
        ref.status = 'failed';
        ref.error = '已中断，费用已退回';
      }
      ref.predictionId = undefined;
      ref.predictionStartedAt = undefined;
      changed = true;
    }
    if (changed) await this.projectRepo.save(project);
    await Promise.all(refundIds.map((id) => this.billing.refundTask(id)));
    return this.emitProject(projectId);
  }

  async enqueueNextBoardImage(
    projectId: string,
    remainingRefIds: string[],
  ): Promise<void> {
    if (!remainingRefIds.length) return;
    const project = await this.getProject(projectId);
    const stillQueued = remainingRefIds.filter((id) =>
      project.assets.some((item) => item.id === id && item.status === 'queued'),
    );
    const [refId, ...rest] = stillQueued;
    if (!refId) return;
    const epoch = project.assets.find((item) => item.id === refId)?.epoch ?? 0;
    try {
      await this.imageQueue.add(
        'generate',
        { projectId, refId, remainingRefIds: rest, ...billingJob() },
        {
          jobId: `image-${projectId}-${refId}-e${epoch}`,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      if (this.isDuplicateImageJob(error)) return;
      const message = `依赖链入队失败：${error instanceof Error ? error.message : String(error)}`;
      await this.withProjectMutationLock(projectId, async () => {
        const latest = await this.getProject(projectId);
        for (const pendingId of stillQueued) {
          const ref = latest.assets.find((item) => item.id === pendingId);
          if (!ref || ref.status !== 'queued') continue;
          ref.status = 'failed';
          ref.error = message;
        }
        await this.projectRepo.save(latest);
        await this.emitProject(projectId);
      });
    }
  }

  /** 供 ImageGenProcessor 调用：生成图片素材的参考图。pending 表示 Atlas 仍在处理，依赖链先不要往下投。 */
  async runBoardImageGeneration(projectId: string, refId: string): Promise<'done' | 'pending'> {
    const started = await this.projectRepo.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`video-project:${projectId}`]);
      const repository = manager.getRepository(VideoProjectEntity);
      const latest = await repository.findOne({ where: { id: projectId }, lock: { mode: 'pessimistic_write' } });
      if (!latest) return false;
      const latestRef = latest.assets.find((item) => item.id === refId);
      if (!latestRef || latestRef.status !== 'queued') return false;
      latestRef.status = 'generating';
      await repository.save(latest);
      return true;
    });
    if (!started) return 'done';

    await this.emitProject(projectId);
    await this.withProjectMutationLock(projectId, async () => {
      const latest = await this.getProject(projectId);
      const latestRef = latest.assets.find((item) => item.id === refId);
      if (!latestRef || latestRef.status !== 'generating') return;
      const preserveIds = new Set(
        latest.assets.filter((item) => item.status === 'queued').map((item) => item.id),
      );
      await this.invalidateShotsUsingAsset(latest, latestRef.name, preserveIds);
      await this.projectRepo.save(latest);
    });
    await this.emitProject(projectId);

    const project = await this.getProject(projectId);
    const ref = project.assets.find((item) => item.id === refId);
    if (!ref) return 'done';

    const modelName = await this.resolveModelName('image', ref.modelId);
    try {
      const pool = [
        ...this.buildImageMentionPool(project, refId),
        ...this.buildTextMentionPool(project, refId),
      ];
      const refs = resolveMentionRefs(ref.prompt, pool);
      const prompt = composeMentionPrompt(ref.prompt, refs);

      const shotMentions = extractMentionNames(ref.prompt, this.projectReferenceNames(project)).filter((name) =>
        project.shots.some((shot) => shot.name === name),
      );
      if (shotMentions.length) {
        throw new BadRequestException(
          `图片生成不支持视频分镜引用：${shotMentions.map((name) => `@${name}`).join('、')}`,
        );
      }
      this.assertNoUnknownMentions(ref.prompt, pool, project);
      const generated = await this.imageGen.generate(
        {
          prompt,
          referenceImageUrls: refs
            .filter((item) => item.type === 'image' && item.url)
            .map((item) => this.storage.toPublicUrl(item.url!)),
          modelId: ref.modelId,
          lora: ref.lora,
          ratio: ref.ratio,
          resolution: ref.resolution,
          outputFormat: ref.outputFormat,
          promptOptimizeMode: ref.promptOptimizeMode,
        },
        {
          handoff: true,
          onSubmitted: ({ predictionId }) => this.bindAssetPrediction(projectId, refId, predictionId),
        },
      );
      // 方舟图片是同步返回地址，本地票据不能拿去查 Atlas，否则成功结果会被丢掉，界面一直停在生成中。
      const imageSaved = () => this.persistBoardImageSuccess({
        projectId,
        refId,
        predictionId: generated.predictionId,
        remoteUrl: generated.url,
        modelName: generated.modelName,
        prompt,
        referenceImageCount: refs.length,
      });
      if (!isAtlasPredictionId(generated.predictionId)) {
        if (!(await imageSaved())) await this.billing.refundTask(generated.predictionId);
        return 'done';
      }
      const applied = await this.completeBoardImage(generated.predictionId);
      if (!applied && !(await imageSaved())) await this.billing.refundTask(generated.predictionId);
      return 'done';
    } catch (error) {
      if (error instanceof AtlasImagePendingError) {
        await this.bindAssetPrediction(projectId, refId, error.predictionId);
        this.logger.warn(`参考图仍在 Atlas 处理中，等待回调: ${ref.name} prediction=${error.predictionId}`);
        return 'pending';
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`素材参考图生成失败: ${ref.name}`, message);
      await this.persistBoardImageFailure(projectId, refId, message, { modelName, prompt: ref.prompt });
      return 'done';
    }
  }

  private isDuplicateImageJob(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('already exists');
  }

  /** 提交成功后立刻记下 prediction，回调晚到或进程重启仍能对上这张图。 */
  private async bindAssetPrediction(projectId: string, refId: string, predictionId: string): Promise<boolean> {
    return this.projectRepo.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`video-project:${projectId}`]);
      const repository = manager.getRepository(VideoProjectEntity);
      const latest = await repository.findOne({ where: { id: projectId }, lock: { mode: 'pessimistic_write' } });
      if (!latest) return false;
      const asset = latest.assets.find((item) => item.id === refId);
      if (!asset || asset.status !== 'generating') return false;
      asset.predictionId = predictionId;
      if (!asset.predictionStartedAt) asset.predictionStartedAt = Date.now();
      await repository.save(latest);
      return true;
    });
  }

  /** 还在生成、且已经有 prediction 的素材。失败后的补写只走回调，避免对账反复退款。 */
  private async sweepBoardImages(): Promise<void> {
    const rows: Array<{ prediction_id: string }> = await this.projectRepo.query(
      `SELECT elem->>'predictionId' AS prediction_id
       FROM video_projects
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(assets, '[]'::jsonb)) elem
       WHERE elem->>'status' = 'generating'
         AND COALESCE(elem->>'predictionId', '') <> ''
       LIMIT 30`,
    );
    for (const row of rows) {
      if (row.prediction_id && isAtlasPredictionId(row.prediction_id)) await this.completeBoardImage(row.prediction_id);
    }
  }

  /**
   * 按 prediction 把 Atlas 终态写回素材。
   * 返回 false 表示这不是素材库的图片任务。
   */
  private async completeBoardImage(predictionId: string): Promise<boolean> {
    if (!isAtlasPredictionId(predictionId)) return false;
    const found = await this.findBoardImage(predictionId);
    if (!found) return false;
    const { projectId, asset } = found;
    if (asset.status === 'success' && asset.url) return true;
    const recoverable = asset.status === 'failed' && isAtlasTimeoutError(asset.error);
    const open = asset.status === 'generating' || recoverable;
    if (!open) return true;
    if (asset.status === 'generating' && this.atlas.hasWaiter(predictionId)) return true;

    let result: AtlasPredictionResult;
    try {
      result = await this.atlas.getPrediction(predictionId);
    } catch (error) {
      this.logger.warn(
        `回查图片任务失败 prediction=${predictionId}: ${error instanceof Error ? error.message : error}`,
      );
      return true;
    }

    if (result.state === 'succeeded' && result.outputs[0]) {
      if (recoverable) this.logger.warn(`图片在判定超时后成功，补写结果 prediction=${predictionId}`);
      await this.persistBoardImageSuccess({
        projectId,
        refId: asset.id,
        predictionId,
        remoteUrl: result.outputs[0],
        prompt: asset.prompt,
      });
      await this.continueBoardImageChain(projectId);
      return true;
    }
    if (result.state === 'failed') {
      await this.persistBoardImageFailure(projectId, asset.id, result.error || '图片生成失败', { predictionId });
      await this.continueBoardImageChain(projectId);
      return true;
    }
    if (recoverable) await this.reopenBoardImage(projectId, asset.id, predictionId);
    return true;
  }

  /** 素材曾被本地超时判失败，但 Atlas 仍在跑。拉回生成中，不退款。 */
  private async reopenBoardImage(projectId: string, refId: string, predictionId: string): Promise<void> {
    const changed = await this.projectRepo.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`video-project:${projectId}`]);
      const repository = manager.getRepository(VideoProjectEntity);
      const latest = await repository.findOne({ where: { id: projectId }, lock: { mode: 'pessimistic_write' } });
      if (!latest) return false;
      const asset = latest.assets.find((item) => item.id === refId);
      if (!asset || asset.predictionId !== predictionId || !isAtlasTimeoutError(asset.error)) return false;
      asset.status = 'generating';
      asset.error = undefined;
      await repository.save(latest);
      return true;
    });
    if (changed) await this.emitProject(projectId);
  }

  private async findBoardImage(
    predictionId: string,
  ): Promise<{ projectId: string; asset: MediaAsset } | null> {
    const rows: Array<{ id: string }> = await this.projectRepo.query(
      `SELECT id FROM video_projects
       WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(assets, '[]'::jsonb)) elem
         WHERE elem->>'predictionId' = $1
       )
       LIMIT 1`,
      [predictionId],
    );
    const projectId = rows[0]?.id;
    if (!projectId) return null;
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    const asset = project?.assets?.find((item) => item.predictionId === predictionId);
    if (!project || !asset) return null;
    return { projectId, asset };
  }

  /** 当前没有进行中的参考图时，把还排着队的下一张投出去。重复投递会被 jobId 挡住。 */
  private async continueBoardImageChain(projectId: string): Promise<void> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) return;
    if (project.assets.some((item) => item.status === 'generating')) return;
    const queued = project.assets.filter(
      (item) => item.kind === 'image' && item.source === 'generated' && item.status === 'queued',
    );
    if (!queued.length) return;
    let ordered = queued;
    try {
      ordered = this.sortAssetsByDependencies(queued, project.assets, this.projectReferenceNames(project));
    } catch (error) {
      this.logger.warn(`参考图依赖排序失败，按原顺序继续: ${error instanceof Error ? error.message : error}`);
    }
    await this.enqueueNextBoardImage(
      projectId,
      ordered.map((item) => item.id),
    );
  }

  private async persistBoardImageSuccess(input: {
    projectId: string;
    refId: string;
    predictionId: string;
    remoteUrl: string;
    modelName?: string;
    prompt?: string;
    referenceImageCount?: number;
  }): Promise<boolean> {
    const current = await this.projectRepo.findOne({ where: { id: input.projectId } });
    const currentAsset = current?.assets?.find((item) => item.id === input.refId);
    if (!currentAsset) return false;
    if (currentAsset.predictionId && currentAsset.predictionId !== input.predictionId) return false;
    if (currentAsset.status === 'success' && currentAsset.url) {
      if (currentAsset.predictionId === input.predictionId) await this.billing.settle(input.predictionId);
      return currentAsset.predictionId === input.predictionId;
    }
    const recoverable = currentAsset.status === 'failed' && isAtlasTimeoutError(currentAsset.error);
    if (currentAsset.status !== 'generating' && !recoverable) return false;

    const safeId = input.predictionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'image';
    const objectName = this.storage.buildObjectName(input.projectId, 'assets', `${input.refId}_${safeId}.png`);
    const url = await this.storage.uploadFromUrl(objectName, input.remoteUrl);
    const modelName = input.modelName || (await this.resolveModelName('image', currentAsset.modelId));

    const saved = await this.projectRepo.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`video-project:${input.projectId}`]);
      const repository = manager.getRepository(VideoProjectEntity);
      const latest = await repository.findOne({
        where: { id: input.projectId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!latest) return null;
      const asset = latest.assets.find((item) => item.id === input.refId);
      if (!asset) return null;
      if (asset.predictionId && asset.predictionId !== input.predictionId) return null;
      if (asset.status === 'success' && asset.url) return null;
      const stillRecoverable = asset.status === 'failed' && isAtlasTimeoutError(asset.error);
      if (asset.status !== 'generating' && !stillRecoverable) return null;
      asset.url = url;
      asset.status = 'success';
      asset.error = undefined;
      asset.predictionId = input.predictionId;
      await repository.save(latest);
      return asset;
    });
    if (!saved || !current) return false;
    await this.billing.settle(input.predictionId);
    this.aiLogger.logMedia(this.mediaLogCtx(current.sessionId), {
      mediaType: 'image',
      model: modelName,
      name: saved.name,
      status: 'success',
      prompt: input.prompt || saved.prompt,
      referenceImageCount: input.referenceImageCount,
      url,
      projectId: input.projectId,
      refId: input.refId,
    });
    await this.emitProject(input.projectId);
    return true;
  }

  private async persistBoardImageFailure(
    projectId: string,
    refId: string,
    message: string,
    extra?: { modelName?: string; prompt?: string; predictionId?: string },
  ): Promise<void> {
    const saved = await this.projectRepo.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`video-project:${projectId}`]);
      const repository = manager.getRepository(VideoProjectEntity);
      const latest = await repository.findOne({ where: { id: projectId }, lock: { mode: 'pessimistic_write' } });
      if (!latest) return null;
      const asset = latest.assets.find((item) => item.id === refId);
      if (!asset) return null;
      if (extra?.predictionId && asset.predictionId && asset.predictionId !== extra.predictionId) return null;
      if (asset.status === 'success' && asset.url) return null;
      const recoverable = asset.status === 'failed' && isAtlasTimeoutError(asset.error);
      if (asset.status !== 'generating' && !recoverable) return null;
      asset.status = 'failed';
      asset.error = message;
      await repository.save(latest);
      return { asset, sessionId: latest.sessionId };
    });
    if (!saved) return;
    const modelName = extra?.modelName || (await this.resolveModelName('image', saved.asset.modelId));
    this.aiLogger.logMedia(this.mediaLogCtx(saved.sessionId), {
      mediaType: 'image',
      model: modelName,
      name: saved.asset.name,
      status: 'failed',
      prompt: extra?.prompt || saved.asset.prompt,
      error: message,
      projectId,
      refId,
    });
    await this.emitProject(projectId);
  }

  // ═══════════════════════════════════════════════════════════
  //  @ 引用解析（素材库 + 分镜视频）
  // ═══════════════════════════════════════════════════════════

  /** 图片生成只能吃参考图；生成素材自身参考图时排除自己，避免自我引用。 */
  private buildImageMentionPool(project: VideoProjectEntity, excludeRefId?: string): MentionRef[] {
    return project.assets
      .filter((r) => r.kind === 'image' && r.status === 'success' && r.url && r.id !== excludeRefId)
      .map((r): MentionRef => ({ name: r.name, type: 'image', url: r.url! }));
  }

  /** 只有 AI 生成的图片素材会通过 prompt 里的 @ 依赖其它素材 */
  private isAssetDependent(asset: MediaAsset): boolean {
    return asset.kind === 'image' && asset.source === 'generated';
  }

  private sortAssetsByDependencies(
    selected: MediaAsset[],
    all: MediaAsset[],
    knownNames?: readonly string[],
  ): MediaAsset[] {
    const names = knownNames ?? all.map((ref) => ref.name);
    const selectedNames = new Set(selected.map((ref) => ref.name));
    const byName = new Map(all.map((ref) => [ref.name, ref]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const result: MediaAsset[] = [];

    const visit = (ref: MediaAsset) => {
      if (visited.has(ref.id)) return;
      if (visiting.has(ref.id)) throw new BadRequestException(`素材引用存在循环：@${ref.name}`);
      visiting.add(ref.id);
      if (this.isAssetDependent(ref)) {
        for (const name of extractMentionNames(ref.prompt, names)) {
          const dependency = byName.get(name);
          if (dependency && selectedNames.has(name)) visit(dependency);
        }
      }
      visiting.delete(ref.id);
      visited.add(ref.id);
      result.push(ref);
    };

    selected.forEach(visit);
    return result;
  }

  private validateAssetGraph(assets: MediaAsset[], knownNames?: readonly string[]): void {
    const names = knownNames ?? assets.map((asset) => asset.name);
    const byName = new Map(assets.map((asset) => [asset.name, asset]));
    for (const asset of assets) {
      if (!this.isAssetDependent(asset)) continue;
      for (const name of extractMentionNames(asset.prompt, names)) {
        const dependency = byName.get(name);
        if (!dependency) throw new BadRequestException(`素材“${asset.name}”包含未知引用：@${name}`);
        if (dependency.id === asset.id) throw new BadRequestException(`素材“${asset.name}”不能引用自身`);
        if (dependency.kind === 'text') {
          if (!dependency.text?.trim()) {
            throw new BadRequestException(`素材“${asset.name}”引用的文本“${dependency.name}”还没有内容`);
          }
          continue;
        }
        if (dependency.kind !== 'image') {
          throw new BadRequestException(
            `素材“${asset.name}”只能引用图片或文本，@${name} 是${this.assetKindLabel(dependency.kind)}素材`,
          );
        }
      }
    }
    this.sortAssetsByDependencies(assets, assets, names);
  }

  /** 勾选生成时不自动扩选依赖：未勾选且未就绪的引用直接拒绝。 */
  private assertSelectedAssetDependencies(project: VideoProjectEntity, selected: MediaAsset[]): void {
    const selectedIds = new Set(selected.map((ref) => ref.id));
    const byName = new Map(project.assets.map((asset) => [asset.name, asset]));
    for (const ref of selected) {
      for (const name of extractMentionNames(ref.prompt, this.projectReferenceNames(project))) {
        const dependency = byName.get(name);
        if (!dependency) continue;
        if (selectedIds.has(dependency.id)) continue;
        if (dependency.kind === 'text') {
          if (!dependency.text?.trim()) {
            throw new BadRequestException(`「${ref.name}」引用的文本「${dependency.name}」还没有内容`);
          }
          continue;
        }
        if (dependency.status === 'success' && dependency.url) continue;
        throw new BadRequestException(
          `「${ref.name}」引用了未勾选且未就绪的「${dependency.name}」，请一并勾选`,
        );
      }
    }
  }

  /** 已写好正文的文本素材。excludeRefId 用于生成某条文本时排除自己 */
  private buildTextMentionPool(project: VideoProjectEntity, excludeRefId?: string): MentionRef[] {
    return project.assets
      .filter((asset) => asset.kind === 'text' && asset.id !== excludeRefId && !!asset.text?.trim())
      .map((asset) => ({ name: asset.name, type: 'text' as const, text: asset.text }));
  }

  /**
   * 某条素材自己可用的 @ 池：图片 / 视频 / 音频 / 文本 / 已完成的分镜视频，排除自己。
   * 文本生成和需要校验「这句话里的 @ 是否都认识」时用它。
   */
  private mentionPoolFor(project: VideoProjectEntity, excludeRefId?: string): MentionRef[] {
    const self = project.assets.find((asset) => asset.id === excludeRefId);
    return this.buildShotMentionPool(project).filter((ref) => ref.name !== self?.name);
  }

  /**
   * 分镜视频生成可用的全部 @ 引用：素材库的图片/视频/音频/文本 + 已生成成功的分镜视频。
   * 图片、视频、音频分别对应上游的参考通道；文本只拼进提示词，不占参考文件名额。
   */
  private buildShotMentionPool(project: VideoProjectEntity): MentionRef[] {
    const assets = project.assets
      .filter((asset) => asset.kind !== 'text' && asset.status === 'success' && asset.url)
      .map(
        (asset): MentionRef => ({
          name: asset.name,
          type: asset.kind,
          url: asset.url!,
          durationSec: asset.durationSec,
        }),
      );
    const shotVideos = project.shots
      .map((shot): MentionRef | undefined => {
        if (shot.videoStatus !== 'success' || !shot.videoUrl) return undefined;
        const takeForUrl = shot.takes?.find((take) => take.videoUrl === shot.videoUrl);
        return {
          name: shot.name,
          type: 'video',
          url: shot.videoUrl,
          durationSec: takeForUrl?.qcReport?.durationSec ?? takeForUrl?.durationSec ?? shot.durationSec,
        };
      })
      .filter((ref): ref is MentionRef => !!ref);
    return [...assets, ...shotVideos, ...this.buildTextMentionPool(project)];
  }

  /** 按上游 content 的排列顺序分组，编号与提示词中的 图片N/视频N/音频N 一一对应 */
  private groupRefsByType(refs: MentionRef[]): { images: MentionRef[]; videos: MentionRef[]; audios: MentionRef[] } {
    return {
      images: refs.filter((ref) => ref.type === 'image'),
      videos: refs.filter((ref) => ref.type === 'video'),
      audios: refs.filter((ref) => ref.type === 'audio'),
    };
  }

  private assertNoUnknownMentions(text: string, pool: MentionRef[], project: VideoProjectEntity): void {
    const allNames = [
      ...project.assets.map((ref) => ref.name),
      ...project.shots.map((shot) => shot.name),
    ];
    const knownNames = new Set(allNames);
    const mentionedNames = extractMentionNames(text, allNames);
    const unknown = mentionedNames.filter((name) => !knownNames.has(name));
    if (unknown.length) throw new BadRequestException(`无法识别引用：${unknown.map((name) => `@${name}`).join('、')}`);
    const counts = new Map<string, number>();
    allNames.forEach((name) => counts.set(name, (counts.get(name) ?? 0) + 1));
    const ambiguous = mentionedNames.filter((name) => (counts.get(name) ?? 0) > 1);
    if (ambiguous.length) {
      throw new BadRequestException(`引用名称不唯一，请先重命名：${ambiguous.map((name) => `@${name}`).join('、')}`);
    }
    const emptyTexts = mentionedNames.filter((name) => {
      const asset = project.assets.find((item) => item.name === name && item.kind === 'text');
      return !!asset && !asset.text?.trim();
    });
    if (emptyTexts.length) {
      throw new BadRequestException(`引用的文本还没有内容：${emptyTexts.map((name) => `@${name}`).join('、')}`);
    }
    const unavailableImages = mentionedNames.filter(
      (name) =>
        knownNames.has(name) &&
        !project.shots.some((shot) => shot.name === name) &&
        !project.assets.some((asset) => asset.name === name && asset.kind === 'text') &&
        !pool.some((ref) => ref.name === name),
    );
    if (unavailableImages.length) {
      throw new BadRequestException(
        `引用素材尚未生成成功：${unavailableImages.map((name) => `@${name}`).join('、')}`,
      );
    }
  }

  /** 识别上传文件的真实类型（不信任扩展名/mimetype），供上传素材与替换素材文件复用 */
  private detectAssetFile(buffer: Buffer): { kind: FileAssetKind; mime: string; ext: string } | undefined {
    const ascii = (start: number, end: number) => buffer.subarray(start, end).toString('latin1');
    if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return { kind: 'image', mime: 'image/png', ext: '.png' };
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { kind: 'image', mime: 'image/jpeg', ext: '.jpg' };
    }
    if (ascii(0, 4) === 'RIFF') {
      if (ascii(8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp', ext: '.webp' };
      if (ascii(8, 12) === 'WAVE') return { kind: 'audio', mime: 'audio/wav', ext: '.wav' };
      return undefined;
    }
    if (ascii(4, 8) === 'ftyp') {
      return HEIF_BRANDS.has(ascii(8, 12))
        ? { kind: 'image', mime: 'image/heic', ext: '.heic' }
        : { kind: 'video', mime: 'video/mp4', ext: '.mp4' };
    }
    if (ascii(0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) {
      return { kind: 'audio', mime: 'audio/mpeg', ext: '.mp3' };
    }
    return undefined;
  }

  /**
   * 上传素材统一入口：识别真实类型 → 按上游全能参考限制校验 → 落对象存储。
   * 返回素材类型与时长，供调用方写入素材库。
   */
  private async storeAssetFile(
    projectId: string,
    baseName: string,
    buffer: Buffer,
  ): Promise<{ kind: FileAssetKind; url: string; durationSec?: number }> {
    const detected = this.detectAssetFile(buffer);
    if (!detected) throw new BadRequestException(`不支持的文件格式，${SUPPORTED_UPLOAD_FORMATS}`);
    const limit = ASSET_UPLOAD_LIMITS[detected.kind];
    if (buffer.length > limit.maxBytes) {
      throw new BadRequestException(
        `${limit.label}单个文件不能超过 ${limit.maxBytes / 1024 / 1024} MB，当前 ${(buffer.length / 1024 / 1024).toFixed(1)} MB`,
      );
    }
    const probed = await this.probeAssetFile(detected.ext, buffer);
    const durationSec = this.assertUploadedAssetUsable(detected.kind, limit.label, probed);
    const url = await this.storage.upload(
      this.storage.buildObjectName(projectId, 'uploads', `${baseName}${detected.ext}`),
      buffer,
      detected.mime,
    );
    return { kind: detected.kind, url, durationSec };
  }

  private async probeAssetFile(
    ext: string,
    buffer: Buffer,
  ): Promise<{ durationSec?: number; width?: number; height?: number }> {
    const tempPath = path.join(os.tmpdir(), `ai-video-upload-${randomUUID()}${ext}`);
    fs.writeFileSync(tempPath, buffer);
    try {
      return await this.ffmpeg.probeMedia(tempPath);
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
  }

  /** 校验上传素材是否满足上游参考入口要求；返回音视频时长供落库 */
  private assertUploadedAssetUsable(
    kind: AssetKind,
    label: string,
    probed: { durationSec?: number; width?: number; height?: number },
  ): number | undefined {
    if (kind === 'image') {
      // HEIC 等格式本机 ffmpeg 未必能解出尺寸，读不到时不阻断上传
      const sides = [probed.width, probed.height].filter((value): value is number => !!value);
      const outOfRange = sides.some(
        (side) => side < REFERENCE_IMAGE_MIN_PX || side > REFERENCE_IMAGE_MAX_PX,
      );
      if (outOfRange) {
        throw new BadRequestException(
          `参考图的宽高需在 ${REFERENCE_IMAGE_MIN_PX}–${REFERENCE_IMAGE_MAX_PX} 像素之间，当前为 ${probed.width}×${probed.height}`,
        );
      }
      return undefined;
    }
    const durationSec = probed.durationSec;
    if (!durationSec || !Number.isFinite(durationSec)) {
      throw new BadRequestException(`无法解析该${label}的时长，请确认文件完整且格式受支持（${SUPPORTED_UPLOAD_FORMATS}）`);
    }
    if (durationSec < REFERENCE_CLIP_MIN_SEC || durationSec > REFERENCE_CLIP_MAX_SEC) {
      throw new BadRequestException(
        `参考${label}单段时长需在 ${REFERENCE_CLIP_MIN_SEC}–${REFERENCE_CLIP_MAX_SEC} 秒之间，当前约 ${durationSec.toFixed(1)} 秒，请裁剪后再上传`,
      );
    }
    return Math.round(durationSec * 10) / 10;
  }

  /**
   * 把「我的资产」里的媒体引入项目素材库。只允许引用本人目录（ai-user/<userId>/）下的文件，
   * 之后与本地上传走同一套校验（格式、时长、尺寸），所以不会绕过上游限制。
   */
  async importAssetFromUrl(projectId: string, userId: string, input: { url: string; name?: string }) {
    const key = this.storage.toObjectName(input.url);
    // 自己的资产，或画布从工作台转来的项目素材（ai-video/，匿名可读）
    if (!key.startsWith(`ai-user/${userId}/`) && !key.startsWith('ai-video/')) throw new BadRequestException('只能引用自己的资产');
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    const mimetype = ASSET_MIME_BY_EXT[ext];
    if (!mimetype) throw new BadRequestException('不支持的素材格式');
    const buffer = await this.storage.download(key);
    const originalname = input.name ? `${input.name}.${ext}` : key.split('/').pop()!;
    return this.uploadLocalRef(projectId, { buffer, originalname, mimetype });
  }

  /** 上传项目级参考素材（图片/视频/音频）并直接加入素材库。 */
  async uploadLocalRef(projectId: string, file: UploadedFileDto): Promise<VideoProjectEntity> {
    const project = await this.getProject(projectId);
    this.assertProjectEditable(project);
    this.assertNoPendingShots(project, '视频生成期间暂不能新增引用素材');
    this.assertNoPendingBoardImages(project, '参考图生成期间暂不能上传新素材');
    const id = randomUUID();
    const stored = await this.storeAssetFile(projectId, id, file.buffer);
    await this.projectRepo.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`video-project:${projectId}`]);
      const repository = manager.getRepository(VideoProjectEntity);
      const latest = await repository.findOne({
        where: { id: projectId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!latest) throw new NotFoundException('视频项目不存在');
      const shots = await manager.getRepository(ShotEntity).find({
        where: { projectId, archivedAt: IsNull() },
        select: { id: true, name: true },
      });
      const kindLabel = ASSET_UPLOAD_LIMITS[stored.kind].label;
      let uploadIndex =
        (latest.assets ?? []).filter((ref) => ref.source === 'uploaded' && ref.kind === stored.kind).length + 1;
      let name = `上传${kindLabel}${uploadIndex}`;
      const usedNames = new Set([
        ...(latest.assets ?? []).map((ref) => ref.name),
        ...shots.map((shot) => shot.name),
      ]);
      while (usedNames.has(name)) name = `上传${kindLabel}${++uploadIndex}`;
      latest.assets = [
        ...latest.assets,
        {
          id,
          name,
          kind: stored.kind,
          source: 'uploaded',
          prompt: '',
          url: stored.url,
          status: 'success',
          durationSec: stored.durationSec,
        },
      ];
      await repository.save(latest);
    });
    return this.emitProject(projectId);
  }

  /**
   * 替换"本地上传"素材的文件（保持 id/name/prompt 不变，@ 引用不受影响）。
   * 仅本地上传素材支持：AI 生成的素材应使用"重新生成"以保持与提示词一致。
   * 替换后的文件必须与原素材同类型，否则已引用它的分镜会静默换掉参考通道。
   */
  async replaceAssetFile(
    projectId: string,
    refId: string,
    file: UploadedFileDto,
    locked = false,
  ): Promise<VideoProjectEntity> {
    if (!locked) {
      return this.withProjectMutationLock(projectId, () => this.replaceAssetFile(projectId, refId, file, true));
    }
    const project = await this.getProject(projectId);
    this.assertProjectEditable(project);
    this.assertNoPendingShots(project, '视频生成期间暂不能替换素材文件');
    this.assertNoPendingBoardImages(project, '参考图生成期间暂不能替换素材文件');
    const asset = this.findAsset(project, refId);
    if (asset.source !== 'uploaded') {
      throw new BadRequestException('仅本地上传的素材支持直接替换文件，AI 生成的素材请使用"重新生成"');
    }
    // 先按文件头判类型，避免类型不符时已经把文件传进了对象存储
    const detected = this.detectAssetFile(file.buffer);
    if (!detected) throw new BadRequestException(`不支持的文件格式，${SUPPORTED_UPLOAD_FORMATS}`);
    if (asset.kind === 'text' || detected.kind !== asset.kind) {
      throw new BadRequestException(
        `“${asset.name}”是${this.assetKindLabel(asset.kind)}素材，只能替换为同类型文件`,
      );
    }
    const previousUrl = asset.url;
    const stored = await this.storeAssetFile(projectId, `${refId}_${Date.now()}`, file.buffer);
    asset.url = stored.url;
    asset.status = 'success';
    asset.error = undefined;
    asset.durationSec = stored.durationSec;
    const removedFiles = previousUrl && previousUrl !== asset.url ? [previousUrl] : [];
    const urlsBefore = new Map(project.assets.map((item) => [item.id, item.url]));
    await this.invalidateShotsUsingAsset(project, asset.name);
    for (const item of project.assets) {
      const previous = urlsBefore.get(item.id);
      if (previous && previous !== item.url) removedFiles.push(previous);
    }
    await this.projectRepo.save(project);
    await this.removeUnreferencedProjectFiles(projectId, removedFiles);
    return this.emitProject(projectId);
  }

  // ═══════════════════════════════════════════════════════════
  //  分镜视频生成（异步任务）
  //
  //  产品路径：@图片素材 → reference_image；@视频素材 / @分镜 → reference_video；
  //  @音频素材 → reference_audio。各类的数量与时长上限见 assertReferenceLimits。
  // ═══════════════════════════════════════════════════════════

  /** 提交分镜视频生成任务（异步执行，立即返回 generating 状态） */
  async generateShotVideo(projectId: string, shotId: string): Promise<ShotEntity> {
    const project = await this.getProject(projectId);
    this.assertProjectEditable(project);
    this.assertNoPendingShots(project, '已有分镜正在生成，请等待整批任务完成');
    this.assertNoPendingBoardImages(project, '参考图正在生成，请等待完成后再生成视频');
    const shot = await this.getShot(projectId, shotId);
    const continuous = project.generationMode === 'continuous';
    this.preflightShotGeneration(project, shot, continuous, false);
    const [{ take }] = await this.createAndActivateTakes([shot]);
    await this.resetFinalVideo(project);
    try {
      await this.enqueueTake(projectId, shot, take, continuous);
    } catch (error) {
      await this.failTake(project, shot, take, `任务入队失败：${error instanceof Error ? error.message : String(error)}`, false);
      await this.emitProject(projectId);
      throw new BadRequestException('视频生成任务入队失败，请稍后重试');
    }
    await this.emitProject(projectId);
    return this.getShotWithTakes(projectId, shotId);
  }

  /** parallel 全部投递；continuous 预创建选中 Take 后只投递首镜。 */
  async generateAllShotVideos(
    projectId: string,
    shotIds: string[],
    mode?: GenerationMode,
  ): Promise<ShotEntity[]> {
    const project = await this.getProject(projectId);
    this.assertProjectEditable(project);
    this.assertNoPendingBoardImages(project, '参考图正在生成，请等待完成后再生成视频');
    if (!project.shots.length) throw new BadRequestException('该项目暂无分镜');
    if (project.shots.some((shot) => shot.videoStatus === 'queued' || shot.videoStatus === 'generating')) {
      throw new BadRequestException('已有分镜正在生成，请等待完成后再批量生成');
    }
    if (new Set(shotIds).size !== shotIds.length) {
      throw new BadRequestException('shotIds 不能重复');
    }
    const selected = shotIds.map((id) => {
      const shot = project.shots.find((item) => item.id === id);
      if (!shot) throw new NotFoundException('部分分镜不存在');
      return shot;
    }).sort((a, b) => a.index - b.index);
    const selectedIds = new Set(selected.map((shot) => shot.id));
    const generationMode = mode ?? project.generationMode ?? 'continuous';
    selected.forEach((shot) =>
      this.preflightShotGeneration(project, shot, generationMode === 'continuous', true, selectedIds),
    );
    const takePairs = await this.createAndActivateTakes(selected, generationMode);
    await this.resetFinalVideo(project);
    if (generationMode === 'parallel') {
      const results = await Promise.allSettled(
        takePairs.map(({ shot, take }) => this.enqueueTake(projectId, shot, take, false)),
      );
      const rejected = results
        .map((result, index) => ({ result, pair: takePairs[index] }))
        .filter(
          (item): item is { result: PromiseRejectedResult; pair: { shot: ShotEntity; take: VideoTakeEntity } } =>
            item.result.status === 'rejected',
        );
      for (const { result, pair } of rejected) {
        await this.failTake(
          project,
          pair.shot,
          pair.take,
          `任务入队失败：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          false,
        );
      }
      if (rejected.length) {
        await this.emitProject(projectId);
        throw new BadRequestException(`${rejected.length} 个视频任务入队失败，请稍后重试`);
      }
    } else {
      const first = takePairs[0];
      try {
        await this.enqueueTake(projectId, first.shot, first.take, true);
      } catch (error) {
        await this.failTake(
          project,
          first.shot,
          first.take,
          `任务入队失败：${error instanceof Error ? error.message : String(error)}`,
          true,
        );
        await this.emitProject(projectId);
        throw new BadRequestException('连续视频任务入队失败，请稍后重试');
      }
    }

    await this.emitProject(projectId);
    return this.presentProject(await this.getProject(projectId)).shots;
  }

  /** 停止排队和正在生成的分镜视频，并退回已扣费用。已有成片的分镜回到上一版。 */
  async cancelQueuedShotVideos(projectId: string): Promise<VideoProjectEntity> {
    const project = await this.getProject(projectId);
    const queuedTakeIds: string[] = [];
    const refundIds: string[] = [];
    await this.shotRepo.manager.transaction(async (manager) => {
      const shotRepository = manager.getRepository(ShotEntity);
      const takeRepository = manager.getRepository(VideoTakeEntity);
      const lockedShots = await shotRepository
        .createQueryBuilder('shot')
        .setLock('pessimistic_write')
        .where('shot.project_id = :projectId', { projectId })
        .andWhere('shot.video_status IN (:...statuses)', { statuses: ['queued', 'generating'] })
        .andWhere('shot.archived_at IS NULL')
        .orderBy('shot.index', 'ASC')
        .getMany();
      for (const shot of lockedShots) {
        if (shot.projectId) shot.project = { id: shot.projectId } as VideoProjectEntity;
        if (!shot.activeTakeId) {
          this.clearInterruptedShot(shot);
          await shotRepository.save(shot);
          continue;
        }
        const take = await takeRepository.findOne({
          where: { id: shot.activeTakeId, shotId: shot.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!take || (take.status !== 'queued' && take.status !== 'generating')) continue;
        if (take.status === 'queued') queuedTakeIds.push(take.id);
        if (take.taskId) refundIds.push(take.taskId);
        const previous = await takeRepository.findOne({
          where: { shotId: shot.id, status: 'success' },
          order: { version: 'DESC' },
        });
        if (previous && previous.id !== take.id && previous.videoUrl) {
          this.mirrorTake(shot, previous);
        } else {
          this.clearInterruptedShot(shot);
        }
        await shotRepository.save(shot);
        await takeRepository.delete({ id: take.id });
      }
    });
    await Promise.all(queuedTakeIds.map((takeId) => this.dropQueuedVideoJob(takeId)));
    await Promise.all(refundIds.map((taskId) => this.billing.refundTask(taskId)));
    return this.emitProject(project.id);
  }

  /** 没有可回退成片时，用失败态解开页面锁。空闲态会被本地合并逻辑当成更旧的状态丢掉。 */
  private clearInterruptedShot(shot: ShotEntity): void {
    shot.activeTakeId = null;
    shot.videoTaskId = null;
    shot.videoUrl = null;
    shot.videoProgress = null;
    if (shot.videoStatus === 'generating') {
      shot.videoStatus = 'failed';
      shot.videoError = '已中断，费用已退回';
      return;
    }
    shot.videoStatus = 'idle';
    shot.videoError = null;
  }

  private async dropQueuedVideoJob(takeId: string): Promise<void> {
    try {
      await this.videoQueue.remove(`submit-${takeId}`);
    } catch {
      // 任务可能已在执行，submitShotVideoTask 会因 take 不再 queued 而直接退出
    }
  }

  private preflightShotGeneration(
    project: VideoProjectEntity,
    shot: ShotEntity,
    continuous: boolean,
    batch: boolean,
    selectedIds?: Set<string>,
  ): void {
    const pool = this.buildShotMentionPool(project);
    this.assertNoUnknownMentions(shot.videoPrompt, pool, project);
    const mentionedShots = extractMentionNames(shot.videoPrompt, this.projectReferenceNames(project))
      .map((name) => project.shots.find((item) => item.name === name))
      .filter((item): item is ShotEntity => !!item);
    if (batch && !continuous && mentionedShots.length) {
      throw new BadRequestException(
        '提示词中含有 @分镜，请使用顺序生成；若要并行生成，请先删除各镜中的分镜视频引用',
      );
    }
    if (batch && continuous) {
      const futureShots = mentionedShots.filter((referenced) => referenced.index >= shot.index);
      if (futureShots.length) {
        throw new BadRequestException(
          `顺序生成只能引用排在当前分镜之前的视频：${futureShots.map((item) => `@${item.name}`).join('、')}`,
        );
      }
    }

    const unresolvedVideos = mentionedShots
      .filter((referenced) => !pool.some((ref) => ref.type === 'video' && ref.name === referenced.name))
      .filter((referenced) => !(
        continuous
        && batch
        && referenced.index < shot.index
        && (!selectedIds || selectedIds.has(referenced.id))
      ));
    if (unresolvedVideos.length) {
      throw new BadRequestException(
        `“${shot.name}”引用的视频尚未就绪：${unresolvedVideos.map((item) => `@${item.name}`).join('、')}`,
      );
    }

    this.assertReferenceLimits(
      this.modelConfig.resolveStatic('video', shot.modelId),
      this.groupRefsByType(resolveMentionRefs(shot.videoPrompt, pool)),
    );
  }

  /** 供 VideoGenProcessor 调用：提交任务给 模型平台API，成功返回 taskId 供后续轮询，失败返回 null */
  async submitShotVideoTask(
    projectId: string,
    shotId: string,
    takeId: string,
    continuous: boolean,
  ): Promise<string | null> {
    const project = await this.getProject(projectId);
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) return null;
    const take = await this.takeRepo.findOne({ where: { id: takeId, shotId } });
    if (!take || shot.activeTakeId !== takeId) return null;
    continuous = take.generationMode === 'continuous';
    if (take.status === 'generating' && take.taskId) return take.taskId;
    if (take.status !== 'queued') return null;

    await this.invalidateShotsDependingOnShot(project, shot.name);

    try {
      const pool = this.buildShotMentionPool(project);
      const refs = resolveMentionRefs(take.promptSnapshot, pool);
      this.assertNoUnknownMentions(take.promptSnapshot, pool, project);

      const unavailableVideos = extractMentionNames(take.promptSnapshot, this.projectReferenceNames(project)).filter(
        (name) =>
          project.shots.some((item) => item.name === name) &&
          !refs.some((ref) => ref.name === name),
      );
      if (unavailableVideos.length) {
        throw new Error(`引用的视频尚未生成成功：${unavailableVideos.map((name) => `@${name}`).join('、')}`);
      }

      const model = this.modelConfig.resolveStatic('video', take.modelId);
      const grouped = this.groupRefsByType(refs);
      this.assertReferenceLimits(model, grouped);
      // 改写顺序必须与下面提交的素材顺序一致，否则提示词里的编号会指错素材
      const orderedRefs = [...grouped.images, ...grouped.videos, ...grouped.audios];
      const textRefs = refs.filter((item) => item.type === 'text');
      const prompt = composeMentionPrompt(
        take.promptSnapshot,
        [...orderedRefs, ...textRefs],
        mentionRewriteStyleFor(model.vendor || model.provider),
      );

      const generated = await this.videoGen.createTask({
        prompt,
        referenceImageUrls: grouped.images.map((ref) => ref.url!),
        referenceVideoUrls: grouped.videos.map((ref) => ref.url!),
        referenceAudioUrls: grouped.audios.map((ref) => ref.url!),
        durationSec: take.durationSec,
        inputVideoSec: grouped.videos.reduce((sum, ref) => sum + (ref.durationSec ?? 0), 0),
        generateAudio: true,
        ratio: take.ratio ?? undefined,
        resolution: take.resolution ?? undefined,
        modelId: take.modelId,
        lora: take.lora,
      });
      take.taskId = generated.taskId;
      // 回写为实际解析后的模型 id（take.modelId 原本可能为空表示"使用默认"），确保后续轮询始终查询正确的 Provider
      take.modelId = generated.modelId;
      take.status = 'generating';
      take.effectivePrompt = prompt;
      take.referenceImages = grouped.images.map((ref) => ref.url!);
      take.referenceVideos = grouped.videos.map((ref) => ref.url!);
      take.referenceAudios = grouped.audios.map((ref) => ref.url!);
      await this.takeRepo.save(take);
      if (shot.activeTakeId === take.id) {
        this.mirrorTake(shot, take);
        await this.persistShots(shot);
      }
      this.aiLogger.logMedia(this.mediaLogCtx(project.sessionId), {
        mediaType: 'video',
        model: generated.modelName,
        name: shot.name,
        status: 'submitted',
        prompt,
        referenceImageCount: grouped.images.length,
        referenceVideoCount: grouped.videos.length,
        referenceAudioCount: grouped.audios.length,
        durationSec: take.durationSec,
        taskId: generated.taskId,
        projectId,
        shotId,
        takeId,
      });
      await this.emitProject(projectId);
      return generated.taskId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.failTake(project, shot, take, message, continuous);
      this.logger.error(`分镜视频任务创建失败: shot=${shotId}`, take.error ?? undefined);
      this.aiLogger.logMedia(this.mediaLogCtx(project.sessionId), {
        mediaType: 'video',
        model: await this.resolveModelName('video', take.modelId),
        name: shot.name,
        status: 'failed',
        prompt: take.promptSnapshot,
        durationSec: take.durationSec,
        error: message,
        projectId,
        shotId,
        takeId,
      });
      await this.emitProject(projectId);
      return null;
    }
  }

  /**
   * 按所选模型的全能参考能力校验 @ 引用：分类数量、混合文件总数、每类总时长。
   * 单段时长在上传素材时已校验，分镜视频则由生成时长本身保证。
   */
  private assertReferenceLimits(
    model: {
      name: string;
      maxReferenceImages?: number;
      maxReferenceVideos?: number;
      maxReferenceAudios?: number;
      maxReferenceFiles?: number;
      maxReferenceDurationSec?: number;
    },
    refs: { images: MentionRef[]; videos: MentionRef[]; audios: MentionRef[] },
  ): void {
    const maxDurationSec = model.maxReferenceDurationSec ?? 15;
    const rules = [
      { label: '参考图', unit: '张', list: refs.images, max: model.maxReferenceImages ?? 9, timed: false },
      { label: '参考视频', unit: '段', list: refs.videos, max: model.maxReferenceVideos ?? 3, timed: true },
      { label: '参考音频', unit: '段', list: refs.audios, max: model.maxReferenceAudios ?? 0, timed: true },
    ];
    for (const rule of rules) {
      if (!rule.list.length) continue;
      if (rule.max <= 0) {
        throw new BadRequestException(
          `模型"${model.name}"暂不支持${rule.label}，请移除对应的 @ 引用后重试，或切换支持${rule.label}的模型`,
        );
      }
      if (rule.list.length > rule.max) {
        throw new BadRequestException(
          `模型"${model.name}"最多支持 ${rule.max} ${rule.unit}${rule.label}，当前引用了 ${rule.list.length} ${rule.unit}`,
        );
      }
      if (!rule.timed) continue;
      const total = rule.list.reduce((sum, ref) => sum + (ref.durationSec ?? maxDurationSec), 0);
      if (total > maxDurationSec) {
        throw new BadRequestException(
          `模型"${model.name}"的${rule.label}总时长不能超过 ${maxDurationSec} 秒，当前约 ${total.toFixed(1)} 秒`,
        );
      }
    }
    const totalFiles = refs.images.length + refs.videos.length + refs.audios.length;
    if (model.maxReferenceFiles && totalFiles > model.maxReferenceFiles) {
      throw new BadRequestException(
        `模型"${model.name}"的参考图、参考视频与参考音频合计不能超过 ${model.maxReferenceFiles} 个，当前引用了 ${totalFiles} 个`,
      );
    }
  }

  /** 供 VideoGenProcessor 调用：查询任务状态；返回 done=false 表示仍在生成中，需继续轮询 */
  async pollShotVideoTask(
    projectId: string,
    shotId: string,
    takeId: string,
    taskId: string,
    continuous: boolean,
  ): Promise<{ done: boolean }> {
    const shot = await this.getShot(projectId, shotId);
    const take = await this.takeRepo.findOne({ where: { id: takeId, shotId } });
    if (!take || take.taskId !== taskId) return { done: true };
    continuous = take.generationMode === 'continuous';
    const recoverable = this.isRecoverableVideoTimeout(take);
    if (take.status !== 'generating' && !recoverable) {
      if (continuous && shot.activeTakeId === take.id) {
        const project = await this.getProject(projectId);
        if (take.status === 'success') await this.enqueueNextContinuous(project, shot);
        else await this.blockDownstream(project, shot, `“${shot.name}”未通过（${take.error ?? '生成失败'}）`);
      }
      return { done: true };
    }

    let result: VideoTaskResult;
    try {
      result = await this.videoGen.queryTask(taskId, take.modelId);
    } catch (error) {
      this.logger.warn(`查询视频任务状态失败: shot=${shotId} task=${taskId}`, error instanceof Error ? error.message : String(error));
      return { done: false }; // 网络抖动，交由下一轮轮询重试
    }

    if (result.state === 'running' || result.state === 'queued' || result.state === 'pending') {
      if (recoverable) {
        take.status = 'generating';
        take.error = null;
        await this.takeRepo.save(take);
        if (shot.activeTakeId === take.id) {
          this.mirrorTake(shot, take);
          await this.persistShots(shot);
        }
        await this.emitProject(projectId);
      }
      const nextProgress = typeof result.progress === 'number' ? Math.round(result.progress * 100) / 100 : null;
      const prevProgress = typeof take.progress === 'number' ? Math.round(take.progress * 100) / 100 : null;
      if (nextProgress !== null && nextProgress > 0 && nextProgress !== prevProgress) {
        take.progress = nextProgress;
        await this.takeRepo.save(take);
        if (shot.activeTakeId === take.id) {
          this.mirrorTake(shot, take);
          await this.persistShots(shot);
        }
        await this.emitProject(projectId);
      }
      return { done: false };
    }

    if (result.state === 'succeeded') {
      const workDir = path.join(os.tmpdir(), `ai-video-qc-${take.id}-${Date.now()}`);
      fs.mkdirSync(workDir, { recursive: true });
      try {
        const localPath = path.join(workDir, 'result.mp4');
        await this.videoGen.downloadTaskVideo(taskId, result.videoUrl, take.modelId, localPath);
        take.qcReport = await this.ffmpeg.inspectVideo(localPath, take.durationSec);
        if (take.qcReport.result === 'failed') {
          take.status = 'failed';
          take.error = take.qcReport.summary ?? '视频基础质量检查未通过';
          take.progress = null;
        } else {
          take.videoUrl = await this.storage.uploadFile(
            this.storage.buildObjectName(projectId, 'shots', `${shot.id}_v${take.version}_${Date.now()}.mp4`),
            localPath,
            'video/mp4',
          );
          take.status = 'success';
          take.error = null;
          take.progress = 1;
        }
      } catch (error) {
        // Atlas 已经成功。下载、质检或入库的网络失败不能把成片标失败，否则用户看到失败且无法再取回这条结果。
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`视频已生成，下载或入库暂时失败，保持生成中并稍后重试: shot=${shotId} task=${taskId} ${message}`);
        return { done: false };
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    } else {
      take.status = 'failed';
      take.error = result.error || `任务${result.state}`;
      take.progress = null;
    }
    const completion = await this.takeRepo.manager.transaction(async (manager) => {
      const takeRepository = manager.getRepository(VideoTakeEntity);
      const shotRepository = manager.getRepository(ShotEntity);
      const lockedTake = await takeRepository.findOne({
        where: { id: takeId, shotId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedTake || lockedTake.taskId !== taskId) return null;
      const stillOpen = lockedTake.status === 'generating' || this.isRecoverableVideoTimeout(lockedTake);
      if (!stillOpen) return null;
      Object.assign(lockedTake, {
        status: take.status,
        videoUrl: take.videoUrl,
        error: take.error,
        qcReport: take.qcReport,
        progress: take.progress,
      });
      await takeRepository.save(lockedTake);
      const lockedShot = await shotRepository.findOne({
        where: { id: shotId, projectId, archivedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedShot) return null;
      const isActive = lockedShot.activeTakeId === lockedTake.id;
      if (isActive) {
        this.mirrorTake(lockedShot, lockedTake);
        await shotRepository.save(lockedShot);
      }
      return { take: lockedTake, shot: lockedShot, isActive };
    });
    if (!completion) return { done: true };
    Object.assign(take, completion.take);
    const latestShot = completion.shot;
    const isActive = completion.isActive;
    const project = await this.getProject(projectId);
    this.aiLogger.logMedia(this.mediaLogCtx(project.sessionId), {
      mediaType: 'video',
      model: await this.resolveModelName('video', take.modelId),
      name: latestShot.name,
      status: take.status === 'success' ? 'success' : 'failed',
      prompt: take.effectivePrompt ?? take.promptSnapshot,
      referenceImageCount: take.referenceImages?.length,
      referenceVideoCount: take.referenceVideos?.length,
      referenceAudioCount: take.referenceAudios?.length,
      durationSec: take.durationSec,
      taskId,
      url: take.videoUrl ?? undefined,
      error: take.error ?? undefined,
      projectId,
      shotId,
      takeId,
    });
    if (continuous && isActive) {
      if (take.status === 'success') {
        try {
          await this.enqueueNextContinuous(project, latestShot);
        } catch (error) {
          await this.blockDownstream(
            project,
            latestShot,
            `后续任务入队失败（${error instanceof Error ? error.message : String(error)}）`,
          );
        }
      } else {
        await this.blockDownstream(project, latestShot, `“${latestShot.name}”未通过（${take.error ?? '生成失败'}）`);
      }
    }
    await this.emitProject(projectId);
    return { done: true };
  }

  /**
   * 密集轮询窗口用完了，但 Atlas 还没终态。
   * 保持生成中，不退款。回调和定时对账会继续查，成功就落成片，Atlas 自己失败才退款。
   */
  async markShotVideoTimedOut(
    projectId: string,
    shotId: string,
    takeId: string,
    taskId: string,
    _continuous: boolean,
  ): Promise<void> {
    const take = await this.takeRepo.findOne({ where: { id: takeId, shotId, taskId } });
    if (!take || take.status !== 'generating') return;
    this.logger.warn(
      `分镜视频超过密集轮询窗口，保持生成中且不退款 project=${projectId} shot=${shotId} task=${taskId}`,
    );
  }

  async markShotVideoQueueFailed(
    projectId: string,
    shotId: string,
    takeId: string,
    taskId: string,
    continuous: boolean,
    message: string,
  ): Promise<void> {
    const shot = await this.getShot(projectId, shotId);
    const take = await this.takeRepo.findOne({ where: { id: takeId, shotId, taskId } });
    if (!take || take.status !== 'generating') return;
    continuous = take.generationMode === 'continuous';
    await this.failTake(await this.getProject(projectId), shot, take, message, continuous);
    await this.emitProject(projectId);
  }

  private async createAndActivateTakes(
    shots: ShotEntity[],
    generationMode?: GenerationMode,
  ): Promise<Array<{ shot: ShotEntity; take: VideoTakeEntity }>> {
    const shotById = new Map(shots.map((shot) => [shot.id, shot]));
    return this.takeRepo.manager.transaction(async (manager) => {
      const shotRepository = manager.getRepository(ShotEntity);
      const takeRepository = manager.getRepository(VideoTakeEntity);
      const projectRepository = manager.getRepository(VideoProjectEntity);
      const projectIds = [...new Set(shots.map((shot) => shot.projectId))];
      const lockedProjects = await projectRepository
        .createQueryBuilder('project')
        .setLock('pessimistic_write')
        .where('project.id IN (:...projectIds)', { projectIds })
        .orderBy('project.id', 'ASC')
        .getMany();
      if (lockedProjects.length !== projectIds.length) throw new NotFoundException('视频项目不存在');
      if (lockedProjects.some((project) => project.status === 'composing')) {
        throw new BadRequestException('视频正在合成，暂时不能生成分镜');
      }
      if (generationMode) {
        for (const project of lockedProjects) project.generationMode = generationMode;
        await projectRepository.save(lockedProjects);
      }
      const projectById = new Map(lockedProjects.map((project) => [project.id, project]));
      const lockedShots = await shotRepository
        .createQueryBuilder('shot')
        .setLock('pessimistic_write')
        .where('shot.id IN (:...shotIds)', { shotIds: [...shotById.keys()] })
        .orderBy('shot.id', 'ASC')
        .getMany();
      if (lockedShots.length !== shots.length) throw new NotFoundException('部分分镜不存在');
      if (lockedShots.some((shot) => shot.videoStatus === 'queued' || shot.videoStatus === 'generating')) {
        throw new BadRequestException('已有分镜正在生成，请等待完成后再重试');
      }

      const pairsByShot = new Map<string, { shot: ShotEntity; take: VideoTakeEntity }>();
      for (const lockedShot of lockedShots) {
        const { version } = await takeRepository
          .createQueryBuilder('take')
          .select('COALESCE(MAX(take.version), 0)', 'version')
          .where('take.shot_id = :shotId', { shotId: lockedShot.id })
          .getRawOne<{ version: string }>();
        const take = await takeRepository.save(
          takeRepository.create({
            id: randomUUID(),
            shotId: lockedShot.id,
            version: Number(version) + 1,
            status: 'queued',
            taskId: null,
            videoUrl: null,
            error: null,
            promptSnapshot: lockedShot.videoPrompt,
            effectivePrompt: null,
            generationMode: generationMode ?? projectById.get(lockedShot.projectId)!.generationMode,
            durationSec: this.clampDuration(lockedShot.durationSec, lockedShot.modelId),
            ratio: this.clampRatio(lockedShot.ratio, lockedShot.modelId),
            resolution: this.clampResolution(lockedShot.resolution, lockedShot.modelId),
            modelId: lockedShot.modelId,
            lora: lockedShot.lora,
            referenceImages: [],
            referenceVideos: [],
            referenceAudios: [],
            qcReport: null,
            progress: null,
          }),
        );
        this.mirrorTake(lockedShot, take);
        await shotRepository.save(lockedShot);
        const original = shotById.get(lockedShot.id)!;
        Object.assign(original, lockedShot);
        pairsByShot.set(lockedShot.id, { shot: original, take });
      }
      return shots.map((shot) => pairsByShot.get(shot.id)!);
    });
  }

  private mirrorTake(shot: ShotEntity, take: VideoTakeEntity): void {
    shot.activeTakeId = take.id;
    shot.videoStatus = take.status;
    shot.videoTaskId = take.taskId;
    shot.videoUrl = take.videoUrl;
    shot.videoError = take.error;
    shot.videoProgress = take.progress ?? null;
  }

  private async enqueueTake(
    projectId: string,
    shot: ShotEntity,
    take: VideoTakeEntity,
    continuous: boolean,
  ): Promise<void> {
    await this.videoQueue.add(
      'submit',
      { kind: 'submit', projectId, shotId: shot.id, takeId: take.id, continuous, ...billingJob() },
      {
        jobId: `submit-${take.id}`,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  private async enqueueNextContinuous(project: VideoProjectEntity, currentShot: ShotEntity): Promise<void> {
    const next = project.shots
      .filter((shot) => shot.index > currentShot.index && shot.videoStatus === 'queued' && shot.activeTakeId)
      .sort((a, b) => a.index - b.index)[0];
    if (!next?.activeTakeId) return;
    const take = await this.takeRepo.findOne({ where: { id: next.activeTakeId, shotId: next.id } });
    if (!take || take.status !== 'queued') return;
    await this.enqueueTake(project.id, next, take, true);
  }

  private async failTake(
    project: VideoProjectEntity,
    shot: ShotEntity,
    take: VideoTakeEntity,
    message: string,
    continuous: boolean,
  ): Promise<void> {
    if (take.taskId) {
      // 已经提交到 Atlas。本地失败不能退款，也不能把任务判死，否则上游成功后结果和扣款对不上。
      this.logger.warn(`分镜已提交 Atlas，保持生成中且不退款 task=${take.taskId}: ${message}`);
      take.status = 'generating';
      take.error = null;
      await this.takeRepo.save(take);
      if (shot.activeTakeId === take.id) {
        this.mirrorTake(shot, take);
        await this.persistShots(shot);
      }
      return;
    }
    take.status = 'failed';
    take.error = message;
    take.progress = null;
    await this.takeRepo.save(take);
    if (shot.activeTakeId === take.id) {
      this.mirrorTake(shot, take);
      await this.persistShots(shot);
    }
    if (continuous) await this.blockDownstream(project, shot, `“${shot.name}”未通过（${message}）`);
  }

  private async blockDownstream(
    project: VideoProjectEntity,
    failedShot: ShotEntity,
    reason: string,
  ): Promise<void> {
    await this.shotRepo.manager.transaction(async (manager) => {
      const shotRepository = manager.getRepository(ShotEntity);
      const takeRepository = manager.getRepository(VideoTakeEntity);
      const shots = await shotRepository
        .createQueryBuilder('shot')
        .setLock('pessimistic_write')
        .where('shot.project_id = :projectId', { projectId: project.id })
        .andWhere('shot.index > :index', { index: failedShot.index })
        .andWhere('shot.video_status = :status', { status: 'queued' })
        .andWhere('shot.archived_at IS NULL')
        .orderBy('shot.index', 'ASC')
        .getMany();
      for (const shot of shots) {
        if (!shot.activeTakeId) continue;
        const take = await takeRepository.findOne({
          where: { id: shot.activeTakeId, shotId: shot.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!take || take.status !== 'queued') continue;
        take.status = 'failed';
        take.error = `连续生成已阻断：${reason}`;
        await takeRepository.save(take);
        this.mirrorTake(shot, take);
        await shotRepository.save(shot);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  FFmpeg 合成
  // ═══════════════════════════════════════════════════════════

  /** 按分镜顺序合成完整视频（要求全部分镜视频已生成成功；异步执行，立即返回 generating 状态） */
  async composeProject(projectId: string): Promise<VideoProjectEntity> {
    const project = await this.projectRepo.manager.transaction(async (manager) => {
      const projectRepository = manager.getRepository(VideoProjectEntity);
      const shotRepository = manager.getRepository(ShotEntity);
      const lockedProject = await projectRepository.findOne({
        where: { id: projectId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedProject) throw new NotFoundException('视频项目不存在');
      const shots = await shotRepository
        .createQueryBuilder('shot')
        .setLock('pessimistic_write')
        .where('shot.project_id = :projectId', { projectId })
        .andWhere('shot.archived_at IS NULL')
        .orderBy('shot.index', 'ASC')
        .getMany();
      lockedProject.shots = shots;
      this.assertNoPendingBoardImages(lockedProject, '参考图正在生成，请等待完成后再合成视频');
      if (!shots.length) throw new BadRequestException('该项目暂无分镜');
      if (lockedProject.finalVideoStatus === 'generating') {
        throw new BadRequestException('正在合成中，请稍候');
      }
      const notReady = shots.filter((shot) => shot.videoStatus !== 'success' || !shot.videoUrl);
      if (notReady.length) {
        throw new BadRequestException(`还有 ${notReady.length} 个分镜视频未生成成功，无法合成`);
      }
      lockedProject.finalVideoStatus = 'generating';
      lockedProject.finalVideoError = null;
      lockedProject.status = 'composing';
      lockedProject.composeToken = randomUUID();
      return projectRepository.save(lockedProject);
    });

    try {
      await this.composeQueue.add(
        'compose',
        { projectId, composeToken: project.composeToken },
        {
          jobId: `compose-${projectId}-${project.composeToken}`,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      project.finalVideoStatus = 'failed';
      project.finalVideoError = `合成任务入队失败：${error instanceof Error ? error.message : String(error)}`;
      project.status = 'failed';
      project.composeToken = null;
      await this.projectRepo.save(project);
      await this.emitProject(projectId);
      throw new BadRequestException('合成任务入队失败，请稍后重试');
    }

    return this.emitProject(projectId);
  }

  /** 成片画布取出现最多的分镜比例，避免竖屏镜头被强制压进 16:9 */
  private pickComposeRatio(shots: ShotEntity[]): string {
    const counts = new Map<string, number>();
    for (const shot of shots) {
      const ratio = shot.ratio || '9:16';
      counts.set(ratio, (counts.get(ratio) ?? 0) + 1);
    }
    let best = '9:16';
    let bestCount = 0;
    for (const [ratio, count] of counts) {
      if (count > bestCount) {
        best = ratio;
        bestCount = count;
      }
    }
    return best;
  }

  /** 供 ComposeProcessor 调用：下载全部分镜视频并用 FFmpeg 拼接，上传最终结果 */
  async runComposeProject(projectId: string, composeToken: string): Promise<void> {
    const project = await this.getProject(projectId);
    // 过期/重复的 stalled 任务：状态已不是 generating 则直接丢弃，避免反复合成打爆 Socket
    if (project.finalVideoStatus !== 'generating' || project.composeToken !== composeToken) {
      this.logger.warn(`跳过过期合成任务: project=${projectId} status=${project.finalVideoStatus}`);
      return;
    }

    const workDir = path.join(os.tmpdir(), `ai-video-compose-${projectId}-${Date.now()}`);
    fs.mkdirSync(workDir, { recursive: true });

    let finalVideoUrl: string | null = null;
    let coverUrl: string | null = null;
    let failure: string | null = null;
    try {
      const localPaths: string[] = [];
      for (const shot of project.shots) {
        const localPath = path.join(workDir, `${shot.id}.mp4`);
        await this.storage.downloadToTemp(shot.videoUrl!, localPath);
        localPaths.push(localPath);
      }

      const outputPath = path.join(workDir, 'final.mp4');
      await this.ffmpeg.concatShots(localPaths, outputPath, this.pickComposeRatio(project.shots));

      finalVideoUrl = await this.storage.uploadFile(
        this.storage.buildObjectName(projectId, 'final', `final_${Date.now()}.mp4`),
        outputPath,
        'video/mp4',
      );

      try {
        const coverPath = path.join(workDir, 'cover.jpg');
        await this.ffmpeg.extractFrame(outputPath, coverPath);
        coverUrl = await this.storage.uploadFile(
          this.storage.buildObjectName(projectId, 'final', `cover_${Date.now()}.jpg`),
          coverPath,
          'image/jpeg',
        );
      } catch (coverError) {
        // 封面截图失败不影响主流程，仅"生成结果"卡片退化为无封面展示
        this.logger.warn(
          `合成封面截图失败: project=${projectId}`,
          coverError instanceof Error ? coverError.message : String(coverError),
        );
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      this.logger.error(`视频合成失败: project=${projectId}`, failure);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }

    const latest = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!latest || latest.composeToken !== composeToken || latest.finalVideoStatus !== 'generating') {
      this.logger.warn(`丢弃已过期的合成结果: project=${projectId}`);
      return;
    }
    latest.finalVideoUrl = finalVideoUrl;
    latest.finalVideoCoverUrl = coverUrl;
    latest.finalVideoStatus = failure ? 'failed' : 'success';
    latest.finalVideoError = failure;
    latest.status = failure ? 'failed' : 'done';
    latest.composeToken = null;
    await this.projectRepo.save(latest);

    if (!failure) {
      await this.composeHistoryRepo.save(
        this.composeHistoryRepo.create({
          projectId,
          videoUrl: finalVideoUrl,
          coverUrl,
          status: 'success',
          durationSec: project.shots.reduce((sum, shot) => sum + (shot.durationSec || 0), 0),
          shotCount: project.shots.length,
        }),
      );
    }
    await this.emitProject(projectId);
  }

  // ═══════════════════════════════════════════════════════════
  //  生成示例（案例库）
  // ═══════════════════════════════════════════════════════════

  /**
   * 基于当前已合成项目沉淀为示例：只复制最新素材、分镜视频和成片。
   * 同一项目只对应一个示例（按 sourceProjectId 幂等）：再次生成则覆盖为当前最新内容。
   */
  async createExample(
    projectId: string,
    input: { title?: string; userId: string; userName?: string },
  ): Promise<VideoExampleEntity> {
    const project = await this.getProject(projectId);
    if (project.finalVideoStatus !== 'success' || !project.finalVideoUrl) {
      throw new BadRequestException('请先完成合成，才能基于当前成片生成示例');
    }
    const assets: ExampleAssetSnapshot[] = project.assets.map((asset) => ({
      name: asset.name,
      kind: asset.kind,
      prompt: asset.prompt,
      source: asset.source,
    }));
    const shots: ExampleShotSnapshot[] = project.shots.map((shot) => ({
      name: shot.name,
      videoPrompt: shot.videoPrompt,
      durationSec: shot.durationSec,
      ratio: shot.ratio ?? undefined,
      index: shot.index,
    }));
    const existing = await this.exampleRepo.findOne({ where: { sourceProjectId: project.id } });
    const exampleId = existing?.id ?? randomUUID();
    const fromPrefix = `ai-video/${project.id}/`;
    const toPrefix = this.exampleStoragePrefix(exampleId);
    if (existing) await this.storage.removePrefix(toPrefix);
    await this.copyRewrittenKeys(this.latestMediaKeys(project), fromPrefix, toPrefix);
    const snapshot = this.buildExampleSnapshot(project, fromPrefix, toPrefix);
    const saved = await this.exampleRepo.save(
      this.exampleRepo.create({
        ...existing,
        id: exampleId,
        title: input.title?.trim() || project.title,
        coverUrl: snapshot.finalVideoCoverUrl,
        requirement: project.requirement,
        assets,
        shots,
        snapshot,
        sourceProjectId: project.id,
        createdBy: input.userId,
        createdByName: input.userName ?? null,
      }),
    );
    return this.presentExample(saved);
  }

  /** 案例库列表，默认综合排序（热度高的在前）；列表不带完整快照，预览时再拉详情 */
  async listExamples(query: { page?: string; pageSize?: string; sort?: RankSort }) {
    const { page, pageSize } = parsePage(query.page, query.pageSize);
    const qb = this.exampleRepo.createQueryBuilder('e');
    const total = await qb.getCount();
    // hot 一并返回：创作首页把工作台案例和画布作品按同一把尺子混排
    const { entities, raw } = await applyRank(qb.addSelect(hotScoreSql('e'), 'hot'), 'e', query.sort, page, pageSize).getRawAndEntities();
    const items = entities.map((item, i) => ({ ...this.presentExample(item, true), hot: Number(raw[i].hot) }));
    return { items, total, page, pageSize };
  }

  /** 这个作品的分享奖励进度，只给作者自己看 */
  async shareRewardStatus(exampleId: string, userId: number) {
    const example = await this.exampleRepo.findOne({ where: { id: exampleId }, select: { id: true, createdBy: true } });
    if (!example) throw new NotFoundException('示例不存在');
    if (!sameAccount(example.createdBy, userId)) throw new ForbiddenException('无权查看');
    return this.shareReward.status(exampleId);
  }

  /** 打开案例预览：同一访客一天只算一次查看 */
  async viewExample(id: string, viewer: string): Promise<boolean> {
    return this.engagement.record(this.exampleRepo, 'example', id, viewer, 'view');
  }

  async getExample(id: string): Promise<VideoExampleEntity> {
    const example = await this.exampleRepo.findOne({ where: { id } });
    if (!example) throw new NotFoundException('示例不存在');
    return this.presentExample(example);
  }

  async deleteExample(id: string, userId: string, isAdmin: boolean): Promise<void> {
    const example = await this.exampleRepo.findOne({ where: { id } });
    if (!example) throw new NotFoundException('示例不存在');
    if (example.createdBy !== userId && !isAdmin) {
      throw new ForbiddenException('无权删除他人创建的示例');
    }
    await this.exampleRepo.delete(id);
    await this.storage.removePrefix(this.exampleStoragePrefix(id));
  }

  /** 复制案例为全新工作台：只拷当前最新素材、分镜视频和成片 */
  async useExample(exampleId: string, input: { sessionId: string; userId: string }): Promise<VideoProjectEntity> {
    const example = await this.exampleRepo.findOne({ where: { id: exampleId } });
    if (!example?.snapshot) throw new NotFoundException('示例不存在');
    await this.insertProducerSession(input.sessionId, input.userId, example.title);
    const project = await this.cloneExampleWorkbench(example, input);
    // 作者复制自己的作品：复制次数不加，奖励也不加。换一天、重复复制都不计
    if (!sameAccount(example.createdBy, input.userId)) {
      const counted = await this.engagement.record(this.exampleRepo, 'example', exampleId, input.userId, 'copy');
      if (counted) {
        try {
          await this.shareReward.onQualifiedCopy(example.id, example.createdBy);
        } catch (error) {
          this.logger.warn(`分享奖励累计失败 example=${exampleId}：${error instanceof Error ? error.message : error}`);
        }
      }
    }
    return this.presentProject(await this.getProject(project.id));
  }

  private async cloneExampleWorkbench(
    example: VideoExampleEntity,
    input: { sessionId: string; userId: string },
  ): Promise<VideoProjectEntity> {
    const snapshot = example.snapshot!;
    const project = await this.projectRepo.save(
      this.projectRepo.create({
        sessionId: input.sessionId,
        userId: input.userId,
        title: example.title,
        requirement: example.requirement,
        assets: [],
        status: snapshot.status ?? 'done',
        generationMode: snapshot.generationMode ?? 'continuous',
      }),
    );
    const fromPrefix = this.exampleStoragePrefix(example.id);
    const toPrefix = `ai-video/${project.id}/`;
    await this.copyRewrittenKeys(this.latestMediaKeys(snapshot), fromPrefix, toPrefix);
    const remapped = this.remapSnapshotIds(this.relocateSnapshot(snapshot, fromPrefix, toPrefix));

    project.assets = remapped.assets;
    project.finalVideoUrl = remapped.finalVideoUrl;
    project.finalVideoCoverUrl = remapped.finalVideoCoverUrl;
    project.finalVideoStatus = remapped.finalVideoStatus;
    project.status = remapped.status;
    await this.projectRepo.save(project);

    await this.persistShots(
      remapped.shots.map((shot) =>
        this.shotRepo.create({
          id: shot.id,
          projectId: project.id,
          index: shot.index,
          name: shot.name,
          videoPrompt: shot.videoPrompt,
          durationSec: shot.durationSec,
          ratio: shot.ratio ?? null,
          resolution: shot.resolution ?? null,
          modelId: shot.modelId ?? null,
          lora: shot.lora ?? null,
          videoUrl: shot.videoUrl ?? null,
          videoStatus: shot.videoStatus,
          videoError: shot.videoError ?? null,
        }),
      ),
    );
    return project;
  }

  private relocateSnapshot(
    snapshot: ExampleProjectSnapshot,
    fromPrefix: string,
    toPrefix: string,
  ): ExampleProjectSnapshot {
    return this.buildExampleSnapshot(
      {
        generationMode: snapshot.generationMode,
        status: snapshot.status,
        finalVideoUrl: snapshot.finalVideoUrl,
        finalVideoCoverUrl: snapshot.finalVideoCoverUrl,
        finalVideoStatus: snapshot.finalVideoStatus,
        assets: snapshot.assets,
        shots: snapshot.shots,
      } as unknown as VideoProjectEntity,
      fromPrefix,
      toPrefix,
    );
  }

  private remapSnapshotIds(snapshot: ExampleProjectSnapshot): ExampleProjectSnapshot {
    return {
      ...snapshot,
      assets: snapshot.assets.map((asset) => ({
        ...asset,
        id: randomUUID(),
        predictionId: undefined,
        predictionStartedAt: undefined,
      })),
      shots: snapshot.shots.map((shot) => ({ ...shot, id: randomUUID() })),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  生成经验（AI 总结制作过程为可复用 Markdown）
  // ═══════════════════════════════════════════════════════════

  /** 汇总项目全流程数据，调用文本大模型生成一份可复用的制作经验 Markdown（不落库，前端直接下载） */
  async generateExperience(projectId: string): Promise<string> {
    const project = await this.getProject(projectId);
    const { text } = await generateText({
      model: this.atlasLlm.text(),
      instructions:
        '你是一名资深的 AI 视频制作教练。请根据提供的完整制作过程数据，总结出一份可复用的"视频制作经验"文档，' +
        '使用 Markdown 格式输出，需包含：需求要点、素材准备思路、分镜与提示词写作技巧、可复用的经验建议。' +
        '面向下一次同类视频制作给出实操性指导，语言简洁，不要输出多余的开场白或客套话。',
      prompt: this.buildExperiencePrompt(project),
      maxOutputTokens: 3000,
    });
    return text.trim();
  }

  private buildExperiencePrompt(project: VideoProjectEntity): string {
    const assetsText = project.assets
      .map(
        (asset, i) =>
          `${i + 1}. [${this.assetKindLabel(asset.kind)}·${asset.source === 'uploaded' ? '本地上传' : 'AI生成'}] ${asset.name}：${asset.kind === 'text' ? (asset.text || '(空)') : (asset.prompt || '(用户上传素材，无提示词)')}`,
      )
      .join('\n') || '（无）';
    const shotsText = project.shots
      .map((shot, i) => `${i + 1}. ${shot.name}（${shot.durationSec}s）：${shot.videoPrompt}`)
      .join('\n') || '（无）';
    const history = project.composeHistory ?? [];
    const historyText = history.length
      ? history.map((h, i) => `第 ${i + 1} 次合成（${dayjs(h.createdAt).format('YYYY-MM-DD HH:mm')}）：共 ${h.shotCount} 个分镜，时长约 ${h.durationSec ?? '未知'} 秒`).join('\n')
      : '暂无合成记录';
    return [
      `项目标题：${project.title}`,
      `原始需求：${project.requirement}`,
      `\n【素材库】\n${assetsText}`,
      `\n【分镜脚本】\n${shotsText}`,
      `\n【成片合成记录】\n${historyText}`,
    ].join('\n');
  }
}
