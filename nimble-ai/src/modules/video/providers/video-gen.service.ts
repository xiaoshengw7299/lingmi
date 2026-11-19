import { createWriteStream } from 'fs';
import { copyFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import axios from 'axios';
import { Injectable, Logger } from '@nestjs/common';
import { formatHttpError } from '../../../common/http/retryable-http-client';
import { AtlasClientService } from '../../atlas/atlas-client.service';
import { AtlasModelRegistryService } from '../../atlas/atlas-model-registry.service';
import { applyLora, applyRefField } from '../../atlas/atlas-request.util';
import { AtlasVariantSpec, LoraSelection, MediaModelOption } from '../../atlas/atlas.types';
import { FfmpegService } from '../../media-pipeline/ffmpeg.service';
import { BillingService } from '../../billing/billing.service';
import { PricingService } from '../../pricing/pricing.service';
import { ArkClientService } from '../../providers/ark-client.service';
import { MinimaxClientService } from '../../providers/minimax-client.service';
import { VideoEnhanceService } from '../../providers/video-enhance.service';
import { videoRunProfile } from './video-run.profile';
import { RedisService } from '../../redis/redis.service';
import { StorageService } from '../../storage';

export interface CreateVideoTaskParams {
  prompt: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  /** 参考视频总时长，用于按官方价计价。没有时长时按无参考视频估算 */
  inputVideoSec?: number;
  durationSec: number;
  generateAudio: boolean;
  ratio?: string;
  /** 用户选择的清晰度。实际提交规格由模型目录决定，不回传给调用方 */
  resolution?: string;
  modelId?: string;
  lora?: LoraSelection | null;
}

export interface CreateVideoTaskResult {
  taskId: string;
  modelId: string;
  modelName: string;
}

export type VideoTaskState = 'queued' | 'pending' | 'running' | 'succeeded' | 'failed' | 'expired' | 'cancelled';

export interface VideoTaskResult {
  state: VideoTaskState;
  videoUrl?: string;
  error?: string;
  progress?: number;
}

interface ResolvedRefs {
  images: string[];
  videos: string[];
  audios: string[];
}

interface VideoRunState {
  provider: string;
  modelId: string;
  enhanceTo?: string;
  enhanceTaskId?: string;
  sourceVideoUrl?: string;
  hiddenResolution?: string;
}

const STATE_TTL_SEC = 3 * 24 * 3600;
const stateKey = (taskId: string) => `video:run:${taskId}`;

function userVideoError(message: string, hidden?: string): string {
  const text = message || '视频生成失败';
  if (/enhance|mediakit|超分|画质增强|后处理/i.test(text)) return '视频生成失败，费用已退回';
  if (hidden && text.toLowerCase().includes(hidden.toLowerCase())) return '视频生成失败，费用已退回';
  return text;
}

/**
 * 视频生成。按模型目录里的 provider 分发到方舟、Atlas 或 MiniMax。
 * 查询接口在任务结束前一直返回生成中。
 */
@Injectable()
export class VideoGenService {
  private readonly logger = new Logger(VideoGenService.name);

  constructor(
    private readonly atlas: AtlasClientService,
    private readonly ark: ArkClientService,
    private readonly minimax: MinimaxClientService,
    private readonly enhance: VideoEnhanceService,
    private readonly modelConfig: AtlasModelRegistryService,
    private readonly pricing: PricingService,
    private readonly billing: BillingService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly ffmpeg: FfmpegService,
  ) {}

  async createTask(params: CreateVideoTaskParams): Promise<CreateVideoTaskResult> {
    const model = await this.modelConfig.resolveModel('video', params.modelId);
    const refs = this.resolveRefs(params);
    this.assertRefsWithinLimits(model, refs);
    const variant = this.pickVariant(model, refs);
    const prompt = this.adaptPrompt(model, params.prompt);
    const userResolution = this.modelConfig.clampResolution('video', params.resolution, model.id);
    const run = videoRunProfile(model.id, userResolution);
    const enhanceTo = run.enhanceTo;
    const submitResolution = run.submitResolution;
    const ratio = variant.fixedRatio || this.modelConfig.clampRatio('video', params.ratio, model.id);

    let quote;
    try {
      quote = await this.pricing.quoteVideo({
        productId: model.id,
        provider: model.provider,
        userResolution: userResolution || submitResolution || model.defaultResolution || '720p',
        generateResolution: submitResolution || userResolution || model.defaultResolution || '720p',
        enhanceTarget: enhanceTo,
        durationSec: this.clampDuration(model, variant, params.durationSec),
        ratio,
        inputVideoSec: params.inputVideoSec ?? 0,
        inputImageCount: refs.images.length,
        atlasModel: variant.model,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('尚未询价')) throw new Error('该模型价格未就绪，请稍后再试');
      throw new Error(userVideoError(message, run.hiddenResolution));
    }

    const ticket = await this.billing.chargeQuoted('video', {
      model: quote.model,
      modelName: model.name,
      cents: quote.cents,
      upstreamCents: quote.upstreamCents,
    });

    try {
      const taskId = await this.submit(model, variant, {
        prompt,
        refs,
        durationSec: quote ? this.clampDuration(model, variant, params.durationSec) : params.durationSec,
        ratio,
        resolution: submitResolution,
        generateAudio: params.generateAudio,
        lora: params.lora,
      });
      await this.billing.bind(ticket, taskId);
      const state: VideoRunState = {
        provider: model.provider,
        modelId: model.id,
        enhanceTo,
        hiddenResolution: run.hiddenResolution,
      };
      await this.redis.set(stateKey(taskId), state, STATE_TTL_SEC);
      return { taskId, modelId: model.id, modelName: model.name };
    } catch (error) {
      await this.billing.refund(ticket);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`视频模型"${model.name}"任务创建失败：${userVideoError(message, run.hiddenResolution)}`);
    }
  }

  async queryTask(taskId: string, modelId?: string | null): Promise<VideoTaskResult> {
    const state = await this.redis.get<VideoRunState>(stateKey(taskId));
    try {
      if (state?.enhanceTaskId) return await this.pollEnhance(taskId, state);
      const upstream = await this.pollUpstream(taskId, state);
      if (upstream.state === 'failed') return { state: 'failed', error: userVideoError(upstream.error || '视频生成失败', state?.hiddenResolution) };
      if (upstream.state !== 'succeeded') return { state: 'running' };
      if (!upstream.url) {
        this.logger.warn(`视频任务已成功但暂时没有链接，保持生成中 task=${taskId} model=${modelId ?? state?.modelId ?? ''}`);
        return { state: 'running' };
      }
      if (state?.enhanceTo) return await this.beginEnhance(taskId, state, upstream.url);
      if (state && state.provider !== 'atlas') await this.billing.settle(taskId);
      return { state: 'succeeded', videoUrl: upstream.url };
    } catch (error) {
      throw new Error(userVideoError(error instanceof Error ? error.message : String(error), state?.hiddenResolution));
    }
  }

  async downloadTaskVideo(
    taskId: string,
    videoUrl: string | undefined,
    _modelId: string | null | undefined,
    destPath: string,
  ): Promise<void> {
    if (!videoUrl) throw new Error(`任务 ${taskId} 成功但未返回视频链接`);
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.downloadToFile(videoUrl, destPath);
        await this.restoreAudio(taskId, destPath);
        return;
      } catch (error) {
        lastError = error;
        await unlink(destPath).catch(() => undefined);
        if (attempt === 3) break;
        this.logger.warn(`下载视频失败，${attempt}s 后进行第 ${attempt + 1}/3 次重试 task=${taskId}: ${formatHttpError(error)}`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
    throw new Error(formatHttpError(lastError));
  }

  private async submit(
    model: MediaModelOption,
    variant: AtlasVariantSpec,
    input: {
      prompt: string;
      refs: ResolvedRefs;
      durationSec: number;
      ratio: string;
      resolution?: string;
      generateAudio: boolean;
      lora?: LoraSelection | null;
    },
  ): Promise<string> {
    if (model.provider === 'ark') return this.ark.submitVideo(this.arkBody(model, variant, input));
    if (model.provider === 'minimax') return this.minimax.submitVideo(this.minimaxBody(model, variant, input));
    const taskId = await this.atlas.submitVideo(this.atlasBody(model, variant, input), { bill: false });
    return taskId;
  }

  private atlasBody(model: MediaModelOption, variant: AtlasVariantSpec, input: {
    prompt: string;
    refs: ResolvedRefs;
    durationSec: number;
    ratio: string;
    resolution?: string;
    generateAudio: boolean;
    lora?: LoraSelection | null;
  }): Record<string, unknown> {
    const body: Record<string, unknown> = { model: variant.model, prompt: input.prompt };
    applyRefField(body, variant.video, input.refs.videos, '参考视频');
    applyRefField(body, variant.image, input.refs.images, '参考图');
    applyRefField(body, variant.audio, input.refs.audios, '参考音频');
    body.duration = input.durationSec;
    if (!variant.omitRatio && !model.omitRatio) body[model.ratioField || 'aspect_ratio'] = input.ratio;
    if (!variant.omitResolution && input.resolution) body.resolution = input.resolution;
    if (model.supportsGenerateAudio) body[model.audioField || 'generate_audio'] = input.generateAudio;
    if (model.supportsWatermark) body.watermark = false;
    applyLora(body, model, input.lora);
    const webhookUrl = this.atlas.buildWebhookUrl();
    if (webhookUrl) body.webhook_url = webhookUrl;
    return body;
  }

  private arkBody(model: MediaModelOption, variant: AtlasVariantSpec, input: {
    prompt: string;
    refs: ResolvedRefs;
    durationSec: number;
    ratio: string;
    resolution?: string;
    generateAudio: boolean;
  }): Record<string, unknown> {
    const singleImage = Boolean(variant.image) && !variant.video && input.refs.images.length === 1 && !input.refs.videos.length && !input.refs.audios.length;
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: input.prompt }];
    const imageRole = singleImage ? 'first_frame' : 'reference_image';
    const volcUrl = (url: string) => this.storage.toVolcengineUrl(url);
    for (const url of input.refs.images) content.push({ type: 'image_url', role: imageRole, image_url: { url: volcUrl(url) } });
    for (const url of input.refs.videos) content.push({ type: 'video_url', role: 'reference_video', video_url: { url: volcUrl(url) } });
    for (const url of input.refs.audios) content.push({ type: 'audio_url', role: 'reference_audio', audio_url: { url: volcUrl(url) } });
    return {
      model: model.upstreamModel || variant.model,
      content,
      duration: input.durationSec,
      ratio: input.ratio,
      ...(input.resolution ? { resolution: input.resolution } : {}),
      generate_audio: input.generateAudio,
      watermark: false,
    };
  }

  private minimaxBody(model: MediaModelOption, variant: AtlasVariantSpec, input: {
    prompt: string;
    refs: ResolvedRefs;
    durationSec: number;
    ratio: string;
    resolution?: string;
  }): Record<string, unknown> {
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: input.prompt }];
    const singleImage = Boolean(variant.image) && !variant.video && input.refs.images.length === 1 && !input.refs.videos.length;
    for (const url of input.refs.images) {
      content.push({ type: 'image_url', role: singleImage ? 'first_frame' : 'reference_image', image_url: { url } });
    }
    for (const url of input.refs.videos) content.push({ type: 'video_url', role: 'reference_video', video_url: { url } });
    for (const url of input.refs.audios) content.push({ type: 'audio_url', role: 'reference_audio', audio_url: { url } });
    return {
      model: model.upstreamModel || variant.model,
      duration: input.durationSec,
      resolution: input.resolution,
      ratio: input.ratio,
      aigc_watermark: false,
      content,
    };
  }

  /** MiniMax 官方标签是 <Picture N>。其它入口如果已经写成 @ImageN，这里改一次 */
  private adaptPrompt(model: MediaModelOption, prompt: string): string {
    if (model.provider !== 'minimax' && model.vendor !== 'minimax') return prompt;
    return prompt
      .replace(/@Image(\d+)/g, '<Picture $1>')
      .replace(/@Video(\d+)/g, '<Video $1>')
      .replace(/@Audio(\d+)/g, '<Audio $1>');
  }

  /** Redis 里的通道丢了时，按任务号区分，不能一律拿去查 Atlas。 */
  private providerOf(taskId: string, state: VideoRunState | null): string {
    if (state?.provider) return state.provider;
    if (taskId.startsWith('cgt-')) return 'ark';
    if (/^\d{6,}$/.test(taskId)) return 'minimax';
    return 'atlas';
  }

  private async pollUpstream(taskId: string, state: VideoRunState | null): Promise<{ state: 'running' | 'succeeded' | 'failed'; url?: string; error?: string }> {
    const provider = this.providerOf(taskId, state);
    if (provider === 'atlas') {
      const result = await this.atlas.getPrediction(taskId, { settle: !state?.enhanceTo });
      if (result.state === 'failed') return { state: 'failed', error: result.error };
      if (result.state === 'succeeded') return { state: 'succeeded', url: result.outputs[0] };
      return { state: 'running' };
    }
    const client = provider === 'minimax' ? this.minimax : this.ark;
    const result = await client.getVideo(taskId);
    if (result.state === 'failed') {
      await this.billing.refundTask(taskId);
      return { state: 'failed', error: result.error };
    }
    if (result.state === 'succeeded') return { state: 'succeeded', url: result.url };
    return { state: 'running' };
  }

  private async beginEnhance(taskId: string, state: VideoRunState, videoUrl: string): Promise<VideoTaskResult> {
    try {
      if (!state.enhanceTo) {
        await this.billing.refundTask(taskId);
        return { state: 'failed', error: '视频生成失败，费用已退回' };
      }
      const enhanceTaskId = await this.enhance.submit(videoUrl, state.enhanceTo);
      await this.redis.set(stateKey(taskId), { ...state, enhanceTaskId, sourceVideoUrl: videoUrl }, STATE_TTL_SEC);
      this.logger.log(`视频任务继续处理 task=${taskId}`);
      return { state: 'running' };
    } catch (error) {
      this.logger.warn(`视频任务提交失败 task=${taskId}: ${error instanceof Error ? error.message : error}`);
      await this.billing.refundTask(taskId);
      return { state: 'failed', error: '视频生成失败，费用已退回' };
    }
  }

  private async pollEnhance(taskId: string, state: VideoRunState): Promise<VideoTaskResult> {
    const result = await this.enhance.get(state.enhanceTaskId || '');
    if (result.state === 'succeeded' && result.url) {
      await this.billing.settle(taskId);
      return { state: 'succeeded', videoUrl: result.url };
    }
    if (result.state === 'failed') {
      await this.billing.refundTask(taskId);
      return { state: 'failed', error: '视频生成失败，费用已退回' };
    }
    return { state: 'running' };
  }

  /** 成片没有音轨而源片有时，把音轨贴回去 */
  private async restoreAudio(taskId: string, destPath: string): Promise<void> {
    const state = await this.redis.get<VideoRunState>(stateKey(taskId));
    if (!state?.sourceVideoUrl) return;
    const current = await this.ffmpeg.probeMedia(destPath).catch(() => undefined);
    if (!current || current.hasAudio) return;
    const sourcePath = join(tmpdir(), `src-${taskId}.mp4`);
    const mixedPath = join(tmpdir(), `mix-${taskId}.mp4`);
    try {
      await this.downloadToFile(state.sourceVideoUrl, sourcePath);
      const source = await this.ffmpeg.probeMedia(sourcePath);
      if (!source.hasAudio) return;
      await this.ffmpeg.attachAudio(destPath, sourcePath, mixedPath);
      await copyFile(mixedPath, destPath);
    } catch (error) {
      this.logger.warn(`音轨回贴失败，保留当前成片 task=${taskId}: ${error instanceof Error ? error.message : error}`);
    } finally {
      await unlink(sourcePath).catch(() => undefined);
      await unlink(mixedPath).catch(() => undefined);
    }
  }

  private pickVariant(model: MediaModelOption, refs: ResolvedRefs): AtlasVariantSpec {
    const { variants } = model;
    const wantsMultiRef = refs.videos.length > 0 || refs.audios.length > 0 || refs.images.length > 1;
    const spec = wantsMultiRef
      ? variants.referenceToVideo ?? variants.imageToVideo ?? variants.textToVideo
      : refs.images.length === 1
        ? variants.imageToVideo ?? variants.referenceToVideo ?? variants.textToVideo
        : variants.textToVideo ?? variants.imageToVideo;
    if (!spec) throw new Error(`视频模型"${model.name}"未配置可用的调用形态`);
    return spec;
  }

  private clampDuration(model: MediaModelOption, variant: AtlasVariantSpec, durationSec: number): number {
    const wanted = Math.round(durationSec);
    const durationValues = variant.durationValues?.length ? variant.durationValues : model.durationValues;
    if (durationValues?.length) {
      return durationValues.reduce((best, value) => (Math.abs(value - wanted) < Math.abs(best - wanted) ? value : best));
    }
    const fallback = Math.min(Math.max(model.minDuration, 4), model.maxDuration);
    return Math.min(model.maxDuration, Math.max(model.minDuration, wanted || fallback));
  }

  private resolveRefs(params: CreateVideoTaskParams): ResolvedRefs {
    return {
      images: this.toPublicRefs(params.referenceImageUrls ?? []),
      videos: this.toPublicRefs(params.referenceVideoUrls ?? []),
      audios: this.toPublicRefs(params.referenceAudioUrls ?? []),
    };
  }

  private toPublicRefs(urls: string[]): string[] {
    return urls.map((url) => url.trim()).filter(Boolean).map((url) => this.storage.toPublicUrl(url));
  }

  private assertRefsWithinLimits(model: MediaModelOption, refs: ResolvedRefs): void {
    const rules = [
      { label: '参考图', unit: '张', count: refs.images.length, max: model.maxReferenceImages },
      { label: '参考视频', unit: '段', count: refs.videos.length, max: model.maxReferenceVideos },
      { label: '参考音频', unit: '段', count: refs.audios.length, max: model.maxReferenceAudios },
    ];
    for (const rule of rules) {
      if (!rule.count) continue;
      if (rule.max <= 0) throw new Error(`模型"${model.name}"暂不支持${rule.label}，请移除相应的 @ 引用后重试，或切换支持的模型`);
      if (rule.count > rule.max) {
        throw new Error(`模型"${model.name}"最多支持 ${rule.max} ${rule.unit}${rule.label}，当前引用了 ${rule.count} ${rule.unit}`);
      }
    }
    const total = refs.images.length + refs.videos.length + refs.audios.length;
    if (model.maxReferenceFiles && total > model.maxReferenceFiles) {
      throw new Error(`模型"${model.name}"最多支持 ${model.maxReferenceFiles} 个参考文件，当前引用了 ${total} 个`);
    }
  }

  private async downloadToFile(videoUrl: string, destPath: string): Promise<void> {
    const res = await axios.get<Readable>(videoUrl, {
      responseType: 'stream',
      timeout: 180_000,
      signal: AbortSignal.timeout(180_000),
    });
    try {
      await pipeline(res.data, createWriteStream(destPath));
    } catch (error) {
      res.data.destroy();
      throw error;
    }
  }
}
