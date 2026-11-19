import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { axiosStatus, parseApiKeys, StockKeyPool } from './stock-keys';
import { STOCK_REQUEST_HEADERS } from './stock-download';
import { StockClip, StockSearchOpts } from './stock.types';

interface PexelsVideoFile {
  file_type: string;
  width: number;
  height: number;
  link: string;
}

interface PexelsVideo {
  id: number;
  duration: number;
  width: number;
  height: number;
  url?: string;
  user?: { name?: string };
  video_files: PexelsVideoFile[];
  video_pictures?: Array<{ picture: string }>;
}

/**
 * Pexels 免费素材检索（一键成片选片引擎）
 *
 * 未配置 PEXELS_API_KEY 时 `configured=false`，调用方据此跳过该源，而不是让整条流水线失败。
 * 同一变量可配多个 Key，限流/失效时按顺序切换。
 */
@Injectable()
export class PexelsService {
  private readonly logger = new Logger(PexelsService.name);
  private readonly http: AxiosInstance;
  private readonly keys: StockKeyPool;
  readonly configured: boolean;

  constructor(configService: ConfigService) {
    this.keys = new StockKeyPool(parseApiKeys(configService.get<string>('PEXELS_API_KEY', '')));
    this.configured = this.keys.configured;
    this.http = axios.create({
      baseURL: 'https://api.pexels.com/videos',
      timeout: 15_000,
      headers: STOCK_REQUEST_HEADERS,
    });
  }

  async search(term: string, opts: StockSearchOpts): Promise<StockClip[]> {
    if (!this.configured) return [];
    try {
      return await this.keys.withKey(
        (key) => this.searchWith(key, term, opts),
        (status) => this.logger.warn(`Pexels Key 返回 ${status}，已切换下一个`),
      );
    } catch (error) {
      const status = axiosStatus(error);
      this.logger.warn(
        `Pexels 检索失败(term="${term}"${status ? `, status=${status}` : ''}): ${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
  }

  private async searchWith(apiKey: string, term: string, opts: StockSearchOpts): Promise<StockClip[]> {
    const { data } = await this.http.get<{ videos: PexelsVideo[] }>('/search', {
      params: { query: term, orientation: opts.orientation, per_page: opts.perPage ?? 8 },
      headers: { Authorization: apiKey },
    });
    const clips: StockClip[] = [];
    for (const video of data.videos ?? []) {
      if (video.duration < opts.minDurationSec) continue;
      const file = this.pickBestFile(video.video_files);
      if (!file) continue;
      clips.push({
        id: `pexels:${video.id}`,
        source: 'pexels',
        url: file.link,
        width: file.width,
        height: file.height,
        durationSec: video.duration,
        title: video.url?.split('/').filter(Boolean).pop()?.replace(/-/g, ' '),
        tags: term.split(/\s+/).filter(Boolean),
        author: video.user?.name,
        mediaType: 'video',
        poster: video.video_pictures?.[0]?.picture,
      });
    }
    return clips;
  }

  /** mp4 优先，分辨率选接近 1080 档但不拉 4K 大文件，避免下载耗时拖垮整条流水线 */
  private pickBestFile(files: PexelsVideoFile[]): PexelsVideoFile | undefined {
    const mp4 = files.filter((f) => f.file_type === 'video/mp4' && f.width > 0);
    if (!mp4.length) return undefined;
    const preferred = mp4.filter((f) => Math.max(f.width, f.height) <= 1920);
    const pool = preferred.length ? preferred : mp4;
    return pool.reduce((best, cur) => (Math.max(cur.width, cur.height) > Math.max(best.width, best.height) ? cur : best));
  }
}
