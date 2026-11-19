import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { STOCK_REQUEST_HEADERS } from './stock-download';
import { parseApiKeys, StockKeyPool } from './stock-keys';
import { StockClip, StockSearchOpts } from './stock.types';

interface OpenverseImage {
  id: string;
  title?: string;
  url: string;
  creator?: string;
  width?: number;
  height?: number;
  tags?: Array<{ name?: string } | string>;
}

/**
 * Openverse 免 Key 图片源（WordPress 维护的 CC 聚合检索）。
 * 没有视频接口，命中后由调用方做 Ken Burns 推镜；默认可商用授权（排除 NC）。
 * 可选配置 OPENVERSE_TOKEN 提高匿名配额（20/min、200/天），支持多 Token 切换。
 */
@Injectable()
export class OpenverseService {
  private readonly logger = new Logger(OpenverseService.name);
  private readonly http: AxiosInstance;
  private readonly keys: StockKeyPool;
  readonly configured = true;

  constructor(configService: ConfigService) {
    this.keys = new StockKeyPool(parseApiKeys(configService.get<string>('OPENVERSE_TOKEN', '')));
    this.http = axios.create({
      baseURL: 'https://api.openverse.org/v1',
      timeout: 15_000,
      headers: STOCK_REQUEST_HEADERS,
    });
  }

  async search(term: string, opts: StockSearchOpts): Promise<StockClip[]> {
    const query = term.trim();
    if (!query) return [];
    try {
      if (this.keys.configured) {
        try {
          return await this.keys.withKey(
            (token) => this.searchWith(query, opts, token),
            (status) => this.logger.warn(`Openverse Token 返回 ${status}，已切换下一个`),
          );
        } catch (error) {
          this.logger.warn(`Openverse Token 失败，回退匿名检索: ${error instanceof Error ? error.message : error}`);
        }
      }
      return await this.searchWith(query, opts);
    } catch (error) {
      this.logger.warn(`Openverse 检索失败(term="${term}"): ${error instanceof Error ? error.message : error}`);
      return [];
    }
  }

  private async searchWith(query: string, opts: StockSearchOpts, token?: string): Promise<StockClip[]> {
    const { data } = await this.http.get<{ results?: OpenverseImage[] }>('/images/', {
      params: {
        q: query,
        page_size: opts.perPage ?? 8,
        mature: 'false',
        license_type: 'commercial',
      },
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    const clips: StockClip[] = [];
    for (const item of data.results ?? []) {
      if (!item.url) continue;
      const tags = (item.tags ?? [])
        .map((tag) => (typeof tag === 'string' ? tag : tag.name ?? ''))
        .map((tag) => tag.trim())
        .filter(Boolean);
      clips.push({
        id: `openverse:${item.id}`,
        source: 'openverse',
        url: item.url,
        width: item.width ?? 1280,
        height: item.height ?? 720,
        durationSec: 8,
        title: item.title,
        tags,
        author: item.creator,
        mediaType: 'image',
      });
    }
    return clips;
  }
}
