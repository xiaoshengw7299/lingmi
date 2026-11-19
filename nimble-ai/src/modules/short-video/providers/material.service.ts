import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { FfmpegService } from '../../media-pipeline/ffmpeg.service';
import { ImageGenService } from '../../video/providers/image-gen.service';
import { StorageService } from '../../storage';
import { Canvas, ClipPrepareResult, FitMode } from '../../media-pipeline/media-pipeline.types';
import { StockMatchService } from '../../media-pipeline/stock-match.service';
import { downloadStockUrl, stockSourceExt } from '../../media-pipeline/stock-download';
import { StockClip } from '../../media-pipeline/stock.types';
import { ShortVideoMaterial } from '../entities/short-video-task.entity';
import { materialKind, normalizeVideoSource, ShortVideoStockPick } from '../short-video.options';

export interface PrepareMaterialsOptions {
  videoSource: string;
  stockSources?: string[];
  semanticMatch?: boolean;
  stockDedupe?: boolean;
  imageModelId?: string;
  imageLora?: { name: string; weight: number } | null;
  /** pexels 检索关键词 / AI 生图的画面主题词，均为英文短语 */
  terms: string[];
  scriptLines?: string[];
  materials: ShortVideoMaterial[];
  targetDurationSec: number;
  canvas: Canvas;
  fit: FitMode;
  clipDurationSec: number;
  clipSpeed: number;
  sequential: boolean;
  workDir: string;
  /** 取片窗口的稳定种子（通常是 taskId），同一任务重试切点一致 */
  clipSeed?: string;
  /** 用户确认过的免费素材。有值时不再检索 */
  stockPicks?: ShortVideoStockPick[];
}

@Injectable()
export class MaterialService {
  private readonly logger = new Logger(MaterialService.name);
  private static readonly WINDOW_MIN_SEC = 2;
  private static readonly WINDOW_MAX_SEC = 15;

  constructor(
    private readonly stock: StockMatchService,
    private readonly ffmpeg: FfmpegService,
    private readonly storage: StorageService,
    private readonly imageGen: ImageGenService,
  ) {}

  async prepareMaterials(opts: PrepareMaterialsOptions): Promise<ClipPrepareResult[]> {
    fs.mkdirSync(opts.workDir, { recursive: true });
    const source = normalizeVideoSource(opts.videoSource);
    if (source === 'local') return this.prepareFromLocal(opts);
    if (source === 'ai') return this.prepareFromAi(opts);
    return this.prepareFromStock(opts);
  }

  private async prepareFromStock(opts: PrepareMaterialsOptions): Promise<ClipPrepareResult[]> {
    const picked = (opts.stockPicks ?? []).filter((item) => item.url);
    const sources = picked.length ? picked.map((item) => this.pickToClip(item)) : await this.searchStock(opts);
    if (!sources.length) {
      throw new BadRequestException('未检索到匹配的免费素材，请更换提示词、多选几个素材源，或改用本地素材 / AI 生成');
    }
    return this.materializeStock(sources, opts);
  }

  private pickToClip(item: ShortVideoStockPick): StockClip {
    return {
      id: item.id,
      source: (item.source || 'pexels') as StockClip['source'],
      url: item.url,
      poster: item.poster,
      width: item.width,
      height: item.height,
      durationSec: item.durationSec,
      title: item.title,
      mediaType: item.mediaType,
    };
  }

  private async searchStock(opts: PrepareMaterialsOptions): Promise<StockClip[]> {
    if (!this.stock.anyConfigured(opts.stockSources)) {
      throw new BadRequestException('未配置可用的免费素材源，请勾选 Wikimedia / Openverse，或配置 Pexels / Pixabay / Coverr 的 API Key');
    }
    const orientation = opts.canvas.width >= opts.canvas.height ? 'landscape' : opts.canvas.width === opts.canvas.height ? 'square' : 'portrait';
    const terms = opts.terms.length ? opts.terms : ['lifestyle'];
    const queries = terms.map((term, index) => ({
      id: String(index),
      term,
      voiceover: opts.scriptLines?.[index] ?? opts.scriptLines?.[0],
    }));
    const hits = await this.stock.matchQueries({
      queries,
      sources: opts.stockSources,
      orientation,
      minDurationSec: MaterialService.WINDOW_MIN_SEC,
      rules: { semantic: opts.semanticMatch !== false, dedupe: opts.stockDedupe !== false },
    });
    return hits.map((hit) => hit.clip);
  }

  private async materializeStock(sources: StockClip[], opts: PrepareMaterialsOptions): Promise<ClipPrepareResult[]> {
    const seed = opts.clipSeed || 'stock';
    const ordered = opts.sequential ? sources : this.seededShuffle(sources, `${seed}:order`);
    const downloaded = new Map<string, string>();
    const clips: ClipPrepareResult[] = [];
    let remaining = opts.targetDurationSec;
    let round = 0;
    while (remaining > 0.05 && round < 40) {
      const source = ordered[round % ordered.length];
      round++;
      try {
        let src = downloaded.get(source.url);
        if (!src) {
          src = path.join(opts.workDir, `stock-src-${downloaded.size}${stockSourceExt(source)}`);
          await downloadStockUrl(source.url, src);
          downloaded.set(source.url, src);
        }
        const out = path.join(opts.workDir, `clip-${clips.length}.mp4`);
        const clip =
          source.mediaType === 'image'
            ? await this.prepareLocalImageClip(src, out, opts, remaining, `${seed}:stock-img:${round}`)
            : await this.prepareWindowedVideoClip(src, out, opts, remaining, `${seed}:stock:${round}`);
        if (!clip) continue;
        clips.push(clip);
        remaining -= clip.durationSec;
      } catch (error) {
        this.logger.warn(`下载/处理免费素材失败，跳过: ${error instanceof Error ? error.message : error}`);
      }
    }
    if (!clips.length) throw new BadRequestException('免费素材下载失败，请稍后重试或改用本地素材 / AI 生成');
    return clips;
  }

  private async prepareFromLocal(opts: PrepareMaterialsOptions): Promise<ClipPrepareResult[]> {
    if (!opts.materials.length) throw new BadRequestException('请先上传本地素材');
    const seed = opts.clipSeed || 'local';
    const order = opts.sequential ? opts.materials : this.seededShuffle(opts.materials, `${seed}:order`);
    const clips: ClipPrepareResult[] = [];
    let remaining = opts.targetDurationSec;
    let round = 0;
    while (remaining > 0.05 && round < 60) {
      const item = order[round % order.length];
      round++;
      try {
        const src = path.join(opts.workDir, `local-src-${round}${path.extname(item.name) || '.dat'}`);
        await this.storage.downloadToTemp(item.file, src);
        const out = path.join(opts.workDir, `clip-${clips.length}.mp4`);
        const clip =
          materialKind(item.name) === 'image'
            ? await this.prepareLocalImageClip(src, out, opts, remaining, `${seed}:img:${round}`)
            : await this.prepareWindowedVideoClip(src, out, opts, remaining, `${seed}:vid:${round}`);
        if (!clip) continue;
        clips.push(clip);
        remaining -= clip.durationSec;
      } catch (error) {
        this.logger.warn(`处理本地素材失败，跳过: ${error instanceof Error ? error.message : error}`);
      }
    }
    if (!clips.length) throw new BadRequestException('本地素材处理失败，请检查文件是否可正常播放');
    return clips;
  }

  /** 本地图片：Ken Burns 推镜，时长在 2–15 秒内按哈希取值，覆盖配音总时长 */
  private async prepareLocalImageClip(
    src: string,
    out: string,
    opts: PrepareMaterialsOptions,
    remaining: number,
    seed: string,
  ): Promise<ClipPrepareResult | null> {
    const durationSec = this.pickWindowDuration(seed, remaining, MaterialService.WINDOW_MAX_SEC);
    await this.ffmpeg.prepareImageClip(src, out, { canvas: opts.canvas, durationSec });
    return { path: out, durationSec };
  }

  /**
   * 学工厂取片：按配音剩余时长，从每个视频里切 2–15 秒窗口（起点用哈希稳定，而不是永远从 0 秒切 3 秒）。
   * 本地上传与免费素材共用。素材不够长时用整段；同一文件多轮取片时 seed 含 round，切点不同。
   */
  private async prepareWindowedVideoClip(
    src: string,
    out: string,
    opts: PrepareMaterialsOptions,
    remaining: number,
    seed: string,
  ): Promise<ClipPrepareResult | null> {
    const probed = await this.ffmpeg.probeMedia(src);
    const assetSec = probed.durationSec ?? 0;
    if (assetSec < 0.2) return null;
    const speed = opts.clipSpeed > 0 ? opts.clipSpeed : 1;
    const maxOutputSec = assetSec / speed;
    const durationSec = this.pickWindowDuration(seed, Math.min(remaining, maxOutputSec), Math.min(MaterialService.WINDOW_MAX_SEC, maxOutputSec));
    const sourceWindow = durationSec * speed;
    const maxStart = Math.max(0, assetSec - sourceWindow);
    const startSec = maxStart > 0 ? this.hashRange(`${seed}:start`, 0, maxStart) : 0;
    await this.ffmpeg.prepareVideoClip(src, out, {
      canvas: opts.canvas,
      fit: opts.fit,
      durationSec,
      speed,
      startSec,
    });
    return { path: out, durationSec };
  }

  private pickWindowDuration(seed: string, remaining: number, maxCap: number): number {
    const maxSeg = Math.min(MaterialService.WINDOW_MAX_SEC, maxCap, remaining);
    if (maxSeg <= 0.1) return Math.max(0.1, remaining);
    const minSeg = Math.min(MaterialService.WINDOW_MIN_SEC, maxSeg);
    return this.hashRange(`${seed}:dur`, minSeg, maxSeg);
  }

  private hash01(seed: string): number {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
  }

  private hashRange(seed: string, min: number, max: number): number {
    if (max <= min) return min;
    return min + this.hash01(seed) * (max - min);
  }

  private seededShuffle<T>(items: T[], seed: string): T[] {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.hash01(`${seed}:${i}`) * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  private async prepareFromAi(opts: PrepareMaterialsOptions): Promise<ClipPrepareResult[]> {
    const themes = opts.terms.length ? opts.terms : ['cinematic lifestyle scene'];
    const clipDuration = Math.max(3, opts.clipDurationSec);
    const count = Math.max(1, Math.ceil(opts.targetDurationSec / clipDuration));
    const ratio = opts.canvas.width >= opts.canvas.height ? '16:9' : opts.canvas.width === opts.canvas.height ? '1:1' : '9:16';
    const clips: ClipPrepareResult[] = [];
    for (let i = 0; i < count; i++) {
      const theme = themes[i % themes.length];
      try {
        const { url } = await this.imageGen.generate({
          prompt: `Cinematic photo-realistic shot for a short video, theme: ${theme}. High detail, natural lighting, no text, no watermark.`,
          ratio,
          modelId: opts.imageModelId || undefined,
          lora: opts.imageLora,
        });
        if (!url) throw new Error('未返回图片');
        const src = path.join(opts.workDir, `ai-src-${i}.png`);
        await downloadStockUrl(url, src);
        const out = path.join(opts.workDir, `clip-${clips.length}.mp4`);
        await this.ffmpeg.prepareImageClip(src, out, { canvas: opts.canvas, durationSec: clipDuration });
        clips.push({ path: out, durationSec: clipDuration });
      } catch (error) {
        this.logger.warn(`AI 生成素材失败，跳过第 ${i + 1} 段: ${error instanceof Error ? error.message : error}`);
      }
    }
    if (!clips.length) throw new BadRequestException('AI 生成素材失败，请稍后重试');
    return clips;
  }
}
