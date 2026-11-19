import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { STOCK_REQUEST_HEADERS } from './stock-download';
import { StockClip, StockSearchOpts } from './stock.types';

interface CommonsDerivative {
  src?: string;
  type?: string;
  transcodekey?: string;
  width?: number;
  height?: number;
}

interface CommonsMediaInfo {
  url?: string;
  thumburl?: string;
  width?: number;
  height?: number;
  mime?: string;
  duration?: number;
  user?: string;
  extmetadata?: {
    LicenseShortName?: { value?: string };
    Artist?: { value?: string };
  };
  derivatives?: CommonsDerivative[];
}

interface CommonsPage {
  pageid: number;
  title: string;
  imageinfo?: CommonsMediaInfo[];
  videoinfo?: CommonsMediaInfo[];
}

/**
 * Wikimedia Commons 免 Key 视频源（commons.wikimedia.org/w/api.php）。
 * 取 ≤720p VP9 webm 转码，避免原片 .ogv 过大、FFmpeg 不好处理。
 * 官方要求带描述性 User-Agent，缺了会被拒。
 */
@Injectable()
export class WikimediaService {
  private readonly logger = new Logger(WikimediaService.name);
  private readonly http: AxiosInstance;
  readonly configured = true;

  constructor() {
    this.http = axios.create({
      baseURL: 'https://commons.wikimedia.org/w',
      timeout: 15_000,
      headers: STOCK_REQUEST_HEADERS,
    });
  }

  async search(term: string, opts: StockSearchOpts): Promise<StockClip[]> {
    const query = term.trim();
    if (!query) return [];
    try {
      const { data } = await this.http.get<{ query?: { pages?: Record<string, CommonsPage> } }>('/api.php', {
        params: {
          action: 'query',
          format: 'json',
          generator: 'search',
          gsrsearch: `${query} filetype:video`,
          gsrnamespace: 6,
          gsrlimit: opts.perPage ?? 8,
          prop: 'videoinfo',
          viprop: 'url|size|mime|extmetadata|user|derivatives',
          viurlwidth: 640,
        },
      });
      const pages = data.query?.pages ? Object.values(data.query.pages) : [];
      const clips: StockClip[] = [];
      for (const page of pages) {
        const clip = this.toClip(page, opts.minDurationSec);
        if (clip) clips.push(clip);
      }
      return clips;
    } catch (error) {
      this.logger.warn(`Wikimedia 检索失败(term="${term}"): ${error instanceof Error ? error.message : error}`);
      return [];
    }
  }

  private toClip(page: CommonsPage, minDurationSec: number): StockClip | null {
    const info = page.videoinfo?.[0] ?? page.imageinfo?.[0];
    if (!info?.url) return null;
    const url = pickWebmSrc(info.derivatives, info.url);
    if (!/\.webm(\?|$)/i.test(url)) return null;
    const durationSec = Math.round(info.duration ?? 0) || 8;
    if (info.duration && info.duration < minDurationSec) return null;
    const title = page.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '');
    const artist = stripHtml(info.extmetadata?.Artist?.value);
    return {
      id: `wikimedia:${page.pageid}`,
      source: 'wikimedia',
      url,
      width: info.width ?? 1280,
      height: info.height ?? 720,
      durationSec,
      title,
      tags: title.split(/[\s_-]+/).filter((item) => item.length >= 2),
      author: artist || info.user,
      mediaType: 'video',
      poster: info.thumburl,
    };
  }
}

function stripHtml(value?: string): string {
  return (value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function derivativeHeight(item: CommonsDerivative): number {
  if (typeof item.height === 'number') return item.height;
  const match = /(\d+)p/.exec(item.transcodekey ?? '');
  return match ? Number(match[1]) : 0;
}

function pickWebmSrc(derivatives: CommonsDerivative[] | undefined, fallback: string): string {
  const webm = (derivatives ?? []).filter((item) => item.src && /webm/i.test(`${item.transcodekey ?? ''} ${item.type ?? ''}`));
  if (!webm.length) return fallback;
  const sorted = webm.slice().sort((a, b) => derivativeHeight(a) - derivativeHeight(b));
  const best = [...sorted].reverse().find((item) => derivativeHeight(item) <= 720) ?? sorted[0];
  return best.src ?? fallback;
}
