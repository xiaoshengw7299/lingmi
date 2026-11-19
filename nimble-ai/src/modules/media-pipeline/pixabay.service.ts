import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { axiosStatus, parseApiKeys, StockKeyPool } from './stock-keys';
import { STOCK_REQUEST_HEADERS } from './stock-download';
import { StockClip, StockSearchOpts } from './stock.types';

interface PixabayVideoSize {
  url?: string;
  width?: number;
  height?: number;
  thumbnail?: string;
}

interface PixabayHit {
  id: number;
  duration?: number;
  tags?: string;
  user?: string;
  videos?: {
    large?: PixabayVideoSize;
    medium?: PixabayVideoSize;
    small?: PixabayVideoSize;
    tiny?: PixabayVideoSize;
  };
}

/**
 * Pixabay 免费素材检索。未配置 PIXABAY_API_KEY 时跳过该源。
 * 官方文档：https://pixabay.com/api/docs/
 * 同一变量可配多个 Key，限流/失效时按顺序切换。
 */
@Injectable()
export class PixabayService {
  private readonly logger = new Logger(PixabayService.name);
  private readonly http: AxiosInstance;
  private readonly keys: StockKeyPool;
  readonly configured: boolean;

  constructor(configService: ConfigService) {
    this.keys = new StockKeyPool(parseApiKeys(configService.get<string>('PIXABAY_API_KEY', '')));
    this.configured = this.keys.configured;
    this.http = axios.create({
      baseURL: 'https://pixabay.com/api',
      timeout: 15_000,
      headers: STOCK_REQUEST_HEADERS,
    });
  }

  async search(term: string, opts: StockSearchOpts): Promise<StockClip[]> {
    if (!this.configured) return [];
    try {
      return await this.keys.withKey(
        (key) => this.searchWith(key, term, opts),
        (status) => this.logger.warn(`Pixabay Key 返回 ${status}，已切换下一个`),
      );
    } catch (error) {
      const status = axiosStatus(error);
      this.logger.warn(
        `Pixabay 检索失败(term="${term}"${status ? `, status=${status}` : ''}): ${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
  }

  private async searchWith(apiKey: string, term: string, opts: StockSearchOpts): Promise<StockClip[]> {
    const orientation =
      opts.orientation === 'portrait' ? 'vertical' : opts.orientation === 'landscape' ? 'horizontal' : 'all';
    const { data } = await this.http.get<{ hits?: PixabayHit[] }>('/videos/', {
      params: {
        key: apiKey,
        q: term,
        orientation,
        per_page: opts.perPage ?? 8,
        safesearch: 'true',
      },
    });
    const clips: StockClip[] = [];
    for (const hit of data.hits ?? []) {
      const durationSec = hit.duration ?? 0;
      if (durationSec && durationSec < opts.minDurationSec) continue;
      const file = this.pickBestFile(hit.videos);
      if (!file?.url) continue;
      clips.push({
        id: `pixabay:${hit.id}`,
        source: 'pixabay',
        url: file.url,
        width: file.width ?? 0,
        height: file.height ?? 0,
        durationSec: durationSec || 8,
        title: hit.tags,
        tags: (hit.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean),
        author: hit.user,
        mediaType: 'video',
        poster: file.thumbnail,
      });
    }
    return clips;
  }

  private pickBestFile(videos?: PixabayHit['videos']): PixabayVideoSize | undefined {
    if (!videos) return undefined;
    const order: Array<keyof NonNullable<PixabayHit['videos']>> = ['medium', 'small', 'large', 'tiny'];
    for (const key of order) {
      const item = videos[key];
      if (item?.url) return item;
    }
    return undefined;
  }
}
