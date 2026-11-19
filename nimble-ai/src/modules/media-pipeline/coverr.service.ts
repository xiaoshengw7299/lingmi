import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { axiosStatus, parseApiKeys, StockKeyPool } from './stock-keys';
import { STOCK_REQUEST_HEADERS } from './stock-download';
import { StockClip, StockSearchOpts } from './stock.types';

interface CoverrHit {
  id?: string | number;
  title?: string;
  duration?: number;
  tags?: string[] | string;
  urls?: {
    mp4?: string;
    mp4_preview?: string;
    mp4_download?: string;
  };
  mp4?: string;
  poster?: string;
}

/**
 * Coverr 免费素材检索。未配置 COVERR_API_KEY 时跳过该源。
 * 文档：https://coverr.co/developers
 * 同一变量可配多个 Key，限流/失效时按顺序切换。
 */
@Injectable()
export class CoverrService {
  private readonly logger = new Logger(CoverrService.name);
  private readonly http: AxiosInstance;
  private readonly keys: StockKeyPool;
  readonly configured: boolean;

  constructor(configService: ConfigService) {
    this.keys = new StockKeyPool(parseApiKeys(configService.get<string>('COVERR_API_KEY', '')));
    this.configured = this.keys.configured;
    this.http = axios.create({
      baseURL: 'https://api.coverr.co',
      timeout: 15_000,
      headers: STOCK_REQUEST_HEADERS,
    });
  }

  async search(term: string, opts: StockSearchOpts): Promise<StockClip[]> {
    if (!this.configured) return [];
    try {
      return await this.keys.withKey(
        (key) => this.searchWith(key, term, opts),
        (status) => this.logger.warn(`Coverr Key 返回 ${status}，已切换下一个`),
      );
    } catch (error) {
      const status = axiosStatus(error);
      this.logger.warn(
        `Coverr 检索失败(term="${term}"${status ? `, status=${status}` : ''}): ${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
  }

  private async searchWith(apiKey: string, term: string, opts: StockSearchOpts): Promise<StockClip[]> {
    const { data } = await this.http.get<{ hits?: CoverrHit[]; videos?: CoverrHit[] }>('/videos', {
      params: { query: term, page_size: opts.perPage ?? 8, urls: true },
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const hits = data.hits ?? data.videos ?? [];
    const clips: StockClip[] = [];
    for (const hit of hits) {
      const durationSec = Number(hit.duration) || 8;
      if (durationSec < opts.minDurationSec) continue;
      const url = hit.urls?.mp4_download || hit.urls?.mp4 || hit.mp4;
      if (!url) continue;
      const tags = Array.isArray(hit.tags) ? hit.tags : String(hit.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      clips.push({
        id: `coverr:${hit.id ?? url}`,
        source: 'coverr',
        url,
        width: opts.orientation === 'portrait' ? 1080 : 1920,
        height: opts.orientation === 'portrait' ? 1920 : 1080,
        durationSec,
        title: hit.title,
        tags,
        mediaType: 'video',
        poster: hit.poster,
      });
    }
    return clips;
  }
}
