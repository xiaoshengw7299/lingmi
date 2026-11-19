import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import axios, { AxiosResponse } from 'axios';
import { Readable } from 'stream';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { In, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { StorageService } from '../storage/storage.service';
import { FfmpegService, composeCanvas } from '../media-pipeline/ffmpeg.service';
import { TtsService, clipPreviewText, previewSampleText } from '../media-pipeline/tts.service';
import { BgmService } from '../media-pipeline/bgm.service';
import { resolveFontPath } from '../media-pipeline/fonts';
import { FitMode, TimedCue } from '../media-pipeline/media-pipeline.types';
import { buildCuesFromWordBoundaries, buildCuesProportional, buildSubtitleStyle, splitScriptIntoLines } from '../media-pipeline/subtitle.util';
import { ShortVideoTaskEntity, ShortVideoMaterial, ShortVideoTaskStatus } from './entities/short-video-task.entity';
import { CreateShortVideoTaskDto, GenerateShortVideoScriptDto, PreviewShortVideoStockDto, QueryShortVideoTaskDto, VoicePreviewDto } from './dto/short-video.dto';
import { SHORT_VIDEO_QUEUE, ShortVideoJobData } from './short-video.queues';
import { runWithBilling } from '../billing/billing-context';
import { BillingService } from '../billing/billing.service';
import { PIPELINE_MIN_BALANCE_CENTS } from '../billing/require-balance';
import { ScriptService } from './providers/script.service';
import { MaterialService } from './providers/material.service';
import {
  BGM_UPLOAD_MAX_BYTES,
  getCreateOptions,
  isAllowedBgm,
  isAllowedMaterial,
  materialMaxBytes,
  mergeSettings,
  normalizeStockPicks,
  NO_VOICE_NAME,
  normalizeVideoSource,
  readStockMediaUrl,
  SHORT_VIDEO_DEFAULTS,
  stageFromProgress,
  stockMediaViewPath,
  stockVideoShareRef,
} from './short-video.options';
import { STOCK_REQUEST_HEADERS } from '../media-pipeline/stock-download';
import { AtlasModelRegistryService } from '../atlas/atlas-model-registry.service';
import { toClientModel } from '../atlas/atlas.types';
import { StockMatchService } from '../media-pipeline/stock-match.service';
import { ShortVideoPricingService } from './short-video-pricing.service';

export interface UploadedFileDto {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const ACTIVE_STATUSES: ShortVideoTaskStatus[] = ['queued', 'generating'];

class CancelledError extends Error {
  constructor() {
    super('已手动停止');
    this.name = 'CancelledError';
  }
}

@Injectable()
export class ShortVideoService implements OnModuleInit {
  private readonly logger = new Logger(ShortVideoService.name);

  async onModuleInit() {
    await this.taskRepo.manager.transaction(async (manager) => {
      await manager.query(
        `ALTER TABLE short_video_tasks ADD COLUMN IF NOT EXISTS billing jsonb,
           ADD COLUMN IF NOT EXISTS request_id uuid`,
      );
      await manager.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_short_video_user_request ON short_video_tasks (user_id, request_id)`,
      );
    });
    const active = await this.taskRepo.find({ where: { status: In(ACTIVE_STATUSES) } });
    for (const task of active) {
      if (await this.queue.getJob(this.jobId(task.id))) continue;
      if (task.status === 'queued') await this.enqueue(task);
      else await this.interrupt(task.id);
    }
  }

  constructor(
    @InjectRepository(ShortVideoTaskEntity)
    private readonly taskRepo: Repository<ShortVideoTaskEntity>,
    @InjectQueue(SHORT_VIDEO_QUEUE)
    private readonly queue: Queue<ShortVideoJobData>,
    private readonly storage: StorageService,
    private readonly tts: TtsService,
    private readonly ffmpeg: FfmpegService,
    private readonly scriptService: ScriptService,
    private readonly materialService: MaterialService,
    private readonly bgm: BgmService,
    private readonly models: AtlasModelRegistryService,
    private readonly stock: StockMatchService,
    private readonly billing: BillingService,
    private readonly pricing: ShortVideoPricingService,
  ) {}

  async listOptions() {
    const imageModels = await this.models.listModels('image');
    return {
      ...getCreateOptions(),
      stockProviders: this.stock.listProviders(),
      imageModels: imageModels.map(toClientModel),
    };
  }

  async previewVoice(dto: VoicePreviewDto) {
    const text = clipPreviewText(dto.text?.trim() || previewSampleText(dto.voiceName));
    if (!text) throw new BadRequestException('请填写要试听的文案');
    try {
      const result = await this.tts.synthesize({
        text,
        voiceName: dto.voiceName,
        rate: dto.voiceRate ?? SHORT_VIDEO_DEFAULTS.voiceRate,
        volume: dto.voiceVolume ?? SHORT_VIDEO_DEFAULTS.voiceVolume,
      });
      return { mimeType: result.mimeType, audio: result.audio.toString('base64'), text };
    } catch (error) {
      this.logger.warn(`voice preview failed: ${error instanceof Error ? error.message : error}`);
      throw new BadRequestException('配音试听失败，请稍后重试');
    }
  }

  async generateScriptPreview(dto: GenerateShortVideoScriptDto) {
    const subject = dto.subject.trim();
    if (!subject) throw new BadRequestException('请填写提示词');
    try {
      const script = await this.scriptService.generateScript(subject, {
        language: this.languageOfVoice(dto.voiceName || SHORT_VIDEO_DEFAULTS.voiceName),
        paragraphNumber: dto.paragraphNumber ?? SHORT_VIDEO_DEFAULTS.paragraphNumber,
        scriptPrompt: dto.scriptPrompt?.trim(),
      });
      return { script };
    } catch (error) {
      this.logger.warn(`script preview failed: ${error instanceof Error ? error.message : error}`);
      throw new BadRequestException('文案生成失败，请稍后重试');
    }
  }

  async previewStock(dto: PreviewShortVideoStockDto) {
    const subject = dto.subject.trim();
    if (!subject) throw new BadRequestException('请填写提示词');
    const voiceName = dto.voiceName || SHORT_VIDEO_DEFAULTS.voiceName;
    let script = dto.script?.trim() ?? '';
    if (!script) {
      try {
        script = await this.scriptService.generateScript(subject, {
          language: this.languageOfVoice(voiceName),
          paragraphNumber: dto.paragraphNumber ?? SHORT_VIDEO_DEFAULTS.paragraphNumber,
          scriptPrompt: dto.scriptPrompt?.trim(),
        });
      } catch (error) {
        this.logger.warn(`stock preview script failed: ${error instanceof Error ? error.message : error}`);
        throw new BadRequestException('文案生成失败，请稍后重试');
      }
    }
    if (!this.stock.anyConfigured(dto.stockSources)) {
      throw new BadRequestException('未配置可用的免费素材源，请勾选 Wikimedia / Openverse，或配置 Pexels / Pixabay / Coverr 的 API Key');
    }
    const terms = await this.resolveTerms(dto.terms?.trim() ?? '', subject, script);
    const lines = splitScriptIntoLines(script);
    const canvas = composeCanvas(dto.aspect || SHORT_VIDEO_DEFAULTS.aspect);
    const orientation = canvas.width > canvas.height ? 'landscape' : canvas.width === canvas.height ? 'square' : 'portrait';
    const hits = await this.stock.matchQueries({
      queries: terms.map((term, index) => ({
        id: String(index),
        term,
        voiceover: lines[index] ?? lines[0],
      })),
      sources: dto.stockSources,
      orientation,
      minDurationSec: 2,
      rules: { semantic: dto.semanticMatch !== false, dedupe: dto.stockDedupe !== false },
      excludeIds: dto.excludeIds,
    });
    const items = hits.map((hit) => hit.clip).filter((clip) => /^https?:\/\//i.test(clip.url));
    if (!items.length) {
      throw new BadRequestException(
        dto.excludeIds?.length
          ? '没有找到新的免费素材，可以换个提示词或素材库后再获取'
          : '未检索到匹配的免费素材，请更换提示词、多选几个素材源，或改用本地素材 / AI 生成',
      );
    }
    return {
      script,
      items: items.map((clip) => ({
        id: clip.id,
        source: clip.source,
        url: clip.url,
        previewUrl: stockMediaViewPath(clip.url),
        shareRef: clip.mediaType === 'image' ? undefined : stockVideoShareRef(clip.url),
        poster: clip.poster,
        posterUrl: stockMediaViewPath(clip.poster),
        title: clip.title,
        durationSec: clip.durationSec,
        width: clip.width,
        height: clip.height,
        mediaType: clip.mediaType ?? 'video',
      })),
    };
  }

  async createTask(userId: string, dto: CreateShortVideoTaskDto) {
    const requestId = dto.requestId?.toLowerCase();
    const record = requestId
      ? await this.taskRepo.manager.transaction(async (manager) => {
          await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`short-video:${userId}:${requestId}`]);
          const repo = manager.getRepository(ShortVideoTaskEntity);
          const existing = await repo.findOneBy({ userId, requestId });
          return existing ?? this.acceptTask(repo, userId, dto, requestId);
        })
      : await this.acceptTask(this.taskRepo, userId, dto);
    if (record.status === 'queued') await this.enqueue(record);
    return this.toClient(record);
  }

  private async acceptTask(repo: Repository<ShortVideoTaskEntity>, userId: string, dto: CreateShortVideoTaskDto, requestId?: string) {
    const subject = dto.subject.trim();
    if (!subject) throw new BadRequestException('请填写视频主题');
    const script = dto.script?.trim() ?? '';
    const count = Math.min(10, Math.max(1, Math.round(dto.count ?? 1)));
    const aspect = dto.aspect || SHORT_VIDEO_DEFAULTS.aspect;
    const voiceName = dto.voiceName || SHORT_VIDEO_DEFAULTS.voiceName;
    const bgmType = dto.bgmType || SHORT_VIDEO_DEFAULTS.bgmType;
    const videoSource = normalizeVideoSource(dto.videoSource);
    const matchMaterials = videoSource === 'stock' && (dto.matchMaterials ?? SHORT_VIDEO_DEFAULTS.matchMaterials);
    const materials = this.normalizeMaterials(dto.materials);
    const settings = mergeSettings({
      terms: dto.terms?.trim() ?? '',
      scriptPrompt: dto.scriptPrompt?.trim() ?? '',
      paragraphNumber: dto.paragraphNumber,
      fitMode: dto.fitMode,
      concatMode: matchMaterials ? 'sequential' : dto.concatMode,
      transitionMode: dto.transitionMode,
      clipDuration: dto.clipDuration,
      clipSpeed: dto.clipSpeed,
      videoCount: count > 1 ? 1 : dto.videoCount,
      matchMaterials,
      semanticMatch: dto.semanticMatch,
      stockDedupe: dto.stockDedupe,
      stockSources: dto.stockSources,
      imageModelId: dto.imageModelId,
      imageLora: dto.imageLora,
      voiceVolume: dto.voiceVolume,
      voiceRate: dto.voiceRate,
      bgmVolume: dto.bgmVolume,
      bgmFile: dto.bgmFile?.trim() ?? '',
      subtitleEnabled: dto.subtitleEnabled,
      subtitlePosition: dto.subtitlePosition,
      customPosition: dto.customPosition,
      fontName: dto.fontName,
      fontSize: dto.fontSize,
      textForeColor: dto.textForeColor,
      textBackgroundEnabled: dto.textBackgroundEnabled,
      textBackgroundColor: dto.textBackgroundColor,
      strokeColor: dto.strokeColor,
      strokeWidth: dto.strokeWidth,
      stockPicks: videoSource === 'stock' ? normalizeStockPicks(dto.stockPicks) : [],
      seriesRemaining: count - 1,
      seriesSpawned: false,
    });

    if (videoSource === 'local' && materials.length === 0) {
      throw new BadRequestException('请先上传本地素材');
    }
    if (videoSource === 'stock' && settings.stockPicks.length === 0) {
      throw new BadRequestException('请先获取并确认免费素材');
    }
    if (bgmType === 'custom' && !settings.bgmFile) {
      throw new BadRequestException('请先上传自定义配乐');
    }

    const billing = await this.pricing.accept(userId, dto.confirmedPricing, PIPELINE_MIN_BALANCE_CENTS);
    return repo.save(
      repo.create({
        userId,
        requestId: requestId ?? null,
        billing,
        subject,
        script,
        aspect,
        voiceName,
        bgmType,
        videoSource,
        materials: materials.length ? materials : null,
        settings,
        status: 'queued',
        progress: 0,
        stage: '排队中',
      }),
    );
  }

  private jobId(taskId: string) {
    return `short-video-generate-${taskId}`;
  }

  private async enqueue(record: ShortVideoTaskEntity) {
    try {
      await this.queue.add(
        'generate',
        { taskId: record.id },
        { jobId: this.jobId(record.id), removeOnComplete: true, removeOnFail: true },
      );
    } catch (error) {
      this.logger.error(`一键成片入队失败: ${record.id}`, error instanceof Error ? error.stack : String(error));
      throw new ServiceUnavailableException('任务暂未入队，请重试提交');
    }
  }

  async listTasks(userId: string, query: QueryShortVideoTaskDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 12;
    const where = { userId };
    const [items, total] = await this.taskRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const active = await this.taskRepo.findOne({
      where: { userId, status: In(ACTIVE_STATUSES) },
      order: { createdAt: 'DESC' },
    });
    if (active?.status === 'queued') await this.enqueue(active);
    return {
      list: items.map((item) => this.toClient(item)),
      total,
      page,
      pageSize,
      active: active ? this.toClient(active) : null,
    };
  }

  async getTask(userId: string, id: string) {
    const task = await this.findOwned(userId, id);
    if (task.status === 'queued') await this.enqueue(task);
    return this.toClient(task);
  }

  async getDownloadUrl(userId: string, id: string, index = 0) {
    const task = await this.findOwned(userId, id);
    const keys = task.videoObjectKeys?.length
      ? task.videoObjectKeys
      : task.videoObjectKey
        ? [task.videoObjectKey]
        : [];
    const key = keys[index] || keys[0];
    if (task.status !== 'success' || !key) {
      throw new BadRequestException('视频尚未生成完成');
    }
    const suffix = keys.length > 1 ? `-${index + 1}` : '';
    const fileName = `${this.safeFileName(task.subject)}${suffix}.mp4`;
    return { url: this.storage.presignDownload(key, fileName), fileName };
  }

  async deleteTask(userId: string, id: string) {
    const task = await this.findOwned(userId, id);
    if (ACTIVE_STATUSES.includes(task.status)) {
      throw new BadRequestException('生成中的任务不能删除');
    }
    await this.storage.removePrefix(`ai-short-video/${task.userId}/${task.id}`);
    await this.removeTaskUploads(task);
    await this.taskRepo.remove(task);
    return null;
  }

  /** 生成中可以停。服务已经重启、流水线不在了的任务，同样立刻结束，不用干等。 */
  async cancelTask(userId: string, id: string) {
    const task = await this.findOwned(userId, id);
    const stopped = await this.taskRepo.update(
      { id, status: In(ACTIVE_STATUSES) },
      { status: 'failed', stage: '已取消', error: '已手动停止' },
    );
    if (!stopped.affected) {
      throw new BadRequestException('这条已经结束');
    }
    const job = await this.queue.getJob(this.jobId(id));
    if (job) await job.remove().catch(() => undefined);
    return this.toClient({ ...task, status: 'failed', stage: '已取消', error: '已手动停止' });
  }

  async openStockMedia(u?: string, exp?: string, sig?: string, range?: string): Promise<AxiosResponse<Readable>> {
    const url = readStockMediaUrl(u, exp, sig);
    if (!url) throw new BadRequestException('素材预览已失效，请重新获取');
    try {
      return await axios.get<Readable>(url, {
        responseType: 'stream',
        timeout: 60_000,
        maxRedirects: 3,
        headers: { ...STOCK_REQUEST_HEADERS, ...(range ? { Range: range } : {}) },
        validateStatus: (status) => status >= 200 && status < 400,
      });
    } catch (error) {
      this.logger.warn(`素材预览拉取失败: ${error instanceof Error ? error.message : error}`);
      throw new BadRequestException('素材暂时打不开，请换一条或重新获取');
    }
  }

  async uploadMaterial(userId: string, file: UploadedFileDto) {
    if (!file) throw new BadRequestException('请选择要上传的文件');
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (!isAllowedMaterial(name)) {
      throw new BadRequestException('仅支持 mp4 / mov / avi / flv / mkv / jpg / png');
    }
    const limit = materialMaxBytes(name);
    if (file.size > limit) {
      const mb = Math.round(limit / (1024 * 1024));
      throw new BadRequestException(`文件过大，最大 ${mb}MB`);
    }
    const objectKey = `ai-short-video/uploads/${userId}/${Date.now()}-${this.safeFileName(name)}`;
    await this.storage.upload(objectKey, file.buffer, file.mimetype);
    return { file: objectKey, name, size: file.size };
  }

  async uploadBgm(userId: string, file: UploadedFileDto) {
    if (!file) throw new BadRequestException('请选择要上传的配乐');
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (!isAllowedBgm(name)) {
      throw new BadRequestException('仅支持 mp3 / m4a / aac / wav / flac / ogg');
    }
    if (file.size > BGM_UPLOAD_MAX_BYTES) {
      throw new BadRequestException('配乐文件过大，最大 30MB');
    }
    const objectKey = `ai-short-video/uploads/${userId}/${Date.now()}-${this.safeFileName(name)}`;
    await this.storage.upload(objectKey, file.buffer, file.mimetype);
    return { file: objectKey, name, size: file.size };
  }

  // ═══════════════════════════════════════════════════════════
  //  自研生成流水线（Worker 调用）：文案 → 关键词 → 配音 → 字幕 → 素材 → 合成
  // ═══════════════════════════════════════════════════════════

  async runPipeline(taskId: string, stalled = false): Promise<void> {
    // BullMQ 可能在原 Worker 的 Redis 锁失效后重派任务。用独立的会话锁等待原流水线退出。
    const lock = this.taskRepo.manager.connection.createQueryRunner();
    const key = `short-video-pipeline:${taskId}`;
    try {
      await lock.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
      try {
        await this.runAcceptedTask(taskId, stalled);
      } finally {
        await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
      }
    } finally {
      await lock.release();
    }
  }

  private async runAcceptedTask(taskId: string, stalled: boolean) {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) return;
    const waived = task.billing?.chargeCents === 0;
    if (task.status === 'generating' && stalled && !waived) {
      await this.interrupt(taskId);
      return;
    }
    if (task.status !== 'queued' && !(task.status === 'generating' && stalled && waived)) return;
    const claimed = await this.taskRepo.update({ id: taskId, status: task.status }, { status: 'generating' });
    if (!claimed.affected) return;
    return runWithBilling(task.userId, () => this.generate(task), { waived });
  }

  async interrupt(taskId: string) {
    await this.taskRepo.update(
      { id: taskId, status: 'generating' },
      { status: 'failed', stage: '已中断', error: '生成任务已中断，请重新生成' },
    );
  }

  private async generate(task: ShortVideoTaskEntity) {
    const taskId = task.id;
    const settings = mergeSettings(task.settings);
    let workDir: string | undefined;

    try {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), `short-video-${taskId}-`));
      await this.markProgress(taskId, 5, task.videoSource);

      // 1. 文案：用户已填则直接用，否则按主题 AI 生成
      const script =
        task.script ||
        (await this.scriptService.generateScript(task.subject, {
          language: this.languageOfVoice(task.voiceName),
          paragraphNumber: settings.paragraphNumber,
          scriptPrompt: settings.scriptPrompt,
        }));
      await this.taskRepo.update(taskId, { generatedScript: script, script });
      await this.markProgress(taskId, 15, task.videoSource);

      // 2. 检索关键词：本地素材和已经确认过的免费素材都不需要再提炼
      const terms =
        task.videoSource === 'local' || (task.videoSource === 'stock' && settings.stockPicks.length > 0)
          ? []
          : await this.resolveTerms(settings.terms, task.subject, script);
      await this.markProgress(taskId, 25, task.videoSource);

      // 3. 配音：整篇文案一次性合成（免费 Edge 带词级时间戳 / AI Atlas 无时间戳）；
      //    选择"不配音"（voiceName = NO_VOICE_NAME）时没有旁白时长可依据，改由用户显式指定的
      //    noVoiceDurationSec 驱动素材时长与字幕比例分配，narrationBuffer 留空、合成阶段生成等长静音轨占位。
      const isSilent = task.voiceName === NO_VOICE_NAME;
      let durationSec: number;
      let wordCues: TimedCue[] = [];
      let narrationBuffer: Buffer | null = null;
      if (isSilent) {
        durationSec = Math.max(5, settings.noVoiceDurationSec);
      } else {
        const ttsResult = await this.tts.synthesize({ text: script, voiceName: task.voiceName, rate: settings.voiceRate, volume: settings.voiceVolume });
        durationSec = ttsResult.durationSec;
        wordCues = ttsResult.wordCues;
        narrationBuffer = ttsResult.audio;
      }
      await this.markProgress(taskId, 45, task.videoSource);

      // 4. 字幕对齐：优先用词时间戳按句聚合，词数对不齐（或 AI 配音/不配音没有词时间戳）时按字符占比回退
      const lines = splitScriptIntoLines(script);
      let cues: TimedCue[] = [];
      if (settings.subtitleEnabled && lines.length) {
        cues = buildCuesFromWordBoundaries(lines, wordCues) ?? buildCuesProportional(lines, durationSec * 1000);
      }
      await this.markProgress(taskId, 55, task.videoSource);

      // 5. 素材：免费检索 / 本地上传 / AI 生成三档统一产出待拼接的静音片段
      const canvas = composeCanvas(task.aspect);
      const materialsDir = path.join(workDir, 'materials');
      const clips = await this.materialService.prepareMaterials({
        videoSource: task.videoSource,
        terms,
        scriptLines: lines,
        materials: task.materials ?? [],
        targetDurationSec: durationSec,
        canvas,
        fit: settings.fitMode as FitMode,
        clipDurationSec: settings.clipDuration,
        clipSpeed: settings.clipSpeed,
        sequential: settings.concatMode === 'sequential',
        workDir: materialsDir,
        stockSources: settings.stockSources,
        semanticMatch: settings.semanticMatch,
        stockDedupe: settings.stockDedupe,
        imageModelId: settings.imageModelId,
        imageLora: settings.imageLora,
        clipSeed: taskId,
        stockPicks: settings.stockPicks,
      });
      await this.markProgress(taskId, 85, task.videoSource);

      // 6. 合成：拼接 + 烧字幕 + 配音/BGM 混音，videoCount>1 时重新洗牌素材顺序产出多个不同剪辑版本
      const narrationPath = path.join(workDir, `narration.${isSilent ? 'aac' : 'mp3'}`);
      if (narrationBuffer) {
        fs.writeFileSync(narrationPath, narrationBuffer);
      } else {
        await this.ffmpeg.generateSilence(durationSec, narrationPath);
      }
      const bgmPath = await this.bgm.resolve(task.bgmType, settings.bgmFile, workDir, `${task.subject} instrumental short video bgm`);
      const subtitleStyle = settings.subtitleEnabled ? buildSubtitleStyle(settings) : undefined;
      const fontFilePath = resolveFontPath(settings.fontName);
      const count = Math.max(1, Math.min(5, settings.videoCount));

      const keys: string[] = [];
      for (let i = 0; i < count; i++) {
        const ordered = settings.concatMode === 'random' ? this.shuffle(clips) : clips;
        const silentPath = path.join(workDir, `silent-${i}.mp4`);
        await this.ffmpeg.concatClips(ordered, silentPath, settings.transitionMode);
        const finalPath = path.join(workDir, `final-${i}.mp4`);
        await this.ffmpeg.composeFinal(silentPath, finalPath, {
          narrationAudioPath: narrationPath,
          narrationVolume: isSilent ? 0 : settings.voiceVolume,
          bgmPath,
          bgmVolume: settings.bgmVolume,
          subtitleCues: cues,
          subtitleStyle,
          overlays: [],
          fontFilePath,
          targetDurationSec: durationSec,
          canvas,
        });
        const objectKey = `ai-short-video/${task.userId}/${task.id}/final-${i + 1}.mp4`;
        await this.storage.uploadFile(objectKey, finalPath, 'video/mp4');
        keys.push(objectKey);
        await this.markProgress(taskId, Math.min(99, 85 + Math.round(((i + 1) / count) * 14)), task.videoSource);
      }

      await this.continueSeries(task);
      await this.taskRepo.update({ id: taskId, status: 'generating' }, {
        status: 'success',
        progress: 100,
        stage: '已完成',
        videoObjectKey: keys[0],
        videoObjectKeys: keys,
        generatedScript: script,
        error: null,
      });
    } catch (error) {
      if (error instanceof CancelledError) return;
      const message = error instanceof Error ? error.message : '生成失败';
      this.logger.error(`一键成片流水线失败: ${taskId} ${message}`, error instanceof Error ? error.stack : undefined);
      await this.continueSeries(task);
      await this.taskRepo.update({ id: taskId, status: 'generating' }, { status: 'failed', stage: '失败', error: message });
    } finally {
      if (workDir) fs.rm(workDir, { recursive: true, force: true }, () => undefined);
    }
  }

  /** 本条到达终态前排出下一条：文案留空以便重写，免费素材留空以便重新检索 */
  private async continueSeries(task: ShortVideoTaskEntity): Promise<void> {
    const fresh = await this.taskRepo.findOne({ where: { id: task.id } });
    if (!fresh || fresh.status !== 'generating') return;
    const settings = mergeSettings(fresh.settings);
    if (settings.seriesRemaining <= 0 || settings.seriesSpawned) return;
    try {
      await this.billing.assertCanSpend(task.userId, PIPELINE_MIN_BALANCE_CENTS);
    } catch (error) {
      this.logger.warn(`余额不足，停止后续成片 ${fresh.id}: ${error instanceof Error ? error.message : error}`);
      return;
    }
    const nextSettings = mergeSettings({
      ...settings,
      stockPicks: [],
      terms: '',
      seriesRemaining: settings.seriesRemaining - 1,
      seriesSpawned: false,
      videoCount: 1,
    });
    try {
      const record = await this.taskRepo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(ShortVideoTaskEntity);
        const parent = await repo.findOne({ where: { id: fresh.id, status: 'generating' }, lock: { mode: 'pessimistic_write' } });
        if (!parent || parent.settings?.seriesSpawned) return;
        await repo.update(parent.id, {
          settings: mergeSettings({ ...settings, seriesRemaining: 0, seriesSpawned: true }),
        });
        return repo.save(repo.create({
          userId: fresh.userId,
          billing: fresh.billing,
          subject: fresh.subject,
          script: '',
          aspect: fresh.aspect,
          voiceName: fresh.voiceName,
          bgmType: fresh.bgmType,
          videoSource: fresh.videoSource,
          materials: fresh.videoSource === 'local' ? fresh.materials : null,
          settings: nextSettings,
          status: 'queued',
          progress: 0,
          stage: '排队中',
        }));
      });
      if (record) await this.enqueue(record);
    } catch (error) {
      this.logger.error(`后续成片入队失败: ${fresh.id}`, error instanceof Error ? error.stack : String(error));
    }
  }

  private async resolveTerms(rawTerms: string, subject: string, script: string): Promise<string[]> {
    const provided = rawTerms
      .split(/[,，、\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (provided.length) return provided;
    try {
      return await this.scriptService.generateTerms(subject, script);
    } catch (error) {
      this.logger.warn(`生成检索关键词失败，回退使用主题本身: ${error instanceof Error ? error.message : error}`);
      return [subject];
    }
  }

  private languageOfVoice(voiceName: string): string {
    if (voiceName.startsWith('zh-HK')) return 'yue';
    if (voiceName.startsWith('en-')) return 'en';
    return 'zh';
  }

  private async markProgress(taskId: string, progress: number, videoSource: string): Promise<void> {
    const updated = await this.taskRepo.update({ id: taskId, status: 'generating' }, { progress, stage: stageFromProgress(progress, videoSource) });
    if (!updated.affected) throw new CancelledError();
  }

  private shuffle<T>(items: T[]): T[] {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** 成片目录之外的上传素材和自定义配乐。别的成片还在用的文件留下。 */
  private async removeTaskUploads(task: ShortVideoTaskEntity): Promise<void> {
    const bgmFile = (task.settings as { bgmFile?: string } | null)?.bgmFile;
    const files = [...(task.materials ?? []).map((item) => item.file), bgmFile];
    for (const file of files) {
      if (!file) continue;
      const key = this.storage.toObjectName(file);
      if (!key.startsWith('ai-short-video/uploads/')) continue;
      const used = await this.taskRepo.manager.query(
        `SELECT 1 FROM short_video_tasks WHERE id <> $1 AND (position($2 in materials::text) > 0 OR position($2 in settings::text) > 0) LIMIT 1`,
        [task.id, key],
      );
      if (!used.length) await this.storage.remove(key);
    }
  }

  private async findOwned(userId: string, id: string) {
    const task = await this.taskRepo.findOne({ where: { id, userId } });
    if (!task) throw new NotFoundException('记录不存在');
    return task;
  }

  private normalizeMaterials(items?: CreateShortVideoTaskDto['materials']): ShortVideoMaterial[] {
    if (!items?.length) return [];
    return items
      .map((item) => ({
        file: item.file.trim(),
        name: (item.name || item.file).trim(),
        size: item.size ?? 0,
      }))
      .filter((item) => item.file);
  }

  toClient(task: ShortVideoTaskEntity) {
    const settings = mergeSettings(task.settings);
    const keys = task.videoObjectKeys?.length
      ? task.videoObjectKeys
      : task.videoObjectKey
        ? [task.videoObjectKey]
        : [];
    const videoUrls = keys.map((key) => this.storage.getPublicUrl(key));
    return {
      id: task.id,
      subject: task.subject,
      script: task.script,
      generatedScript: task.generatedScript,
      aspect: task.aspect,
      voiceName: task.voiceName,
      bgmType: task.bgmType,
      videoSource: task.videoSource,
      materials: task.materials,
      billing: task.billing,
      ...settings,
      status: task.status,
      progress: task.progress,
      stage: task.stage,
      videoUrl: videoUrls[0] || null,
      videoUrls,
      error: task.error,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  private safeFileName(subject: string): string {
    return Array.from((subject || 'video').replace(/[\\/:*?"<>|]/g, '')).slice(0, 60).join('') || 'video';
  }
}
