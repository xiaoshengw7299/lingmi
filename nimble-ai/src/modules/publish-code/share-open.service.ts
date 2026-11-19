import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHash, randomBytes } from 'crypto';
import { RedisService } from '../redis/redis.service';

const DOUYIN_TOKEN = 'https://open.douyin.com/oauth/client_token/';
const DOUYIN_TICKET = 'https://open.douyin.com/open/getticket/';
const XHS_TOKEN = 'https://edith.xiaohongshu.com/api/sns/v1/ext/access/token';
export const DOUYIN_H5_VIDEO_MAX_BYTES = 128 * 1024 * 1024;
/** 无权访问、未获得该能力、token 无效或过期。下一轮重新申请 token，避免刚开通后还拿着旧凭证。 */
const REFRESH_TOKEN_CODES = new Set([2190004, 28001018, 28001014, 28001003, 28001008]);

export interface DouyinShareFields {
  videoUrl: string;
  title: string;
  hashtags: string[];
  poiId: string;
}

export interface XhsVerify {
  appKey: string;
  nonce: string;
  timestamp: string;
  signature: string;
}

interface TokenPayload {
  error_code?: number;
  description?: string;
  access_token?: string;
  expires_in?: number;
  ticket?: string;
}

/**
 * 抖音 H5 分享和小红书 JS 分享的服务端签名。
 * 密钥和 ticket 只留在服务端；签名每次现算，不写进二维码。
 */
@Injectable()
export class ShareOpenService {
  private readonly logger = new Logger(ShareOpenService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  platforms() {
    return { douyin: this.douyinReady(), xhs: this.xhsReady() };
  }

  douyinReady() {
    return Boolean(this.env('DOUYIN_CLIENT_KEY') && this.env('DOUYIN_CLIENT_SECRET'));
  }

  xhsReady() {
    return Boolean(this.env('XHS_APP_KEY') && this.env('XHS_APP_SECRET'));
  }

  async douyinSchema(fields: DouyinShareFields): Promise<string> {
    if (!this.douyinReady()) throw new BadRequestException('暂时不能发到抖音');
    const ticket = await this.douyinTicket();
    const nonce = randomBytes(8).toString('hex');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHash('md5')
      .update(`nonce_str=${nonce}&ticket=${ticket}&timestamp=${timestamp}`)
      .digest('hex');
    const params: Record<string, string> = {
      share_type: 'h5',
      client_key: this.env('DOUYIN_CLIENT_KEY'),
      nonce_str: nonce,
      timestamp,
      signature,
      video_path: fields.videoUrl,
      share_to_publish: '1',
      share_to_type: '0',
    };
    if (fields.title) params.title = fields.title;
    if (fields.hashtags.length) params.hashtag_list = JSON.stringify(fields.hashtags);
    if (fields.poiId) params.poi_id = fields.poiId;
    const query = Object.entries(params)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
    return `snssdk1128://openplatform/share?${query}`;
  }

  async xhsVerify(): Promise<XhsVerify> {
    if (!this.xhsReady()) throw new BadRequestException('暂时不能发到小红书');
    const accessToken = await this.xhsToken();
    const nonce = randomBytes(12).toString('hex');
    const timestamp = String(Date.now());
    return {
      appKey: this.env('XHS_APP_KEY'),
      nonce,
      timestamp,
      signature: this.xhsSign(nonce, timestamp, accessToken),
    };
  }

  private async douyinTicket(): Promise<string> {
    return this.cached('douyin:open_ticket', async () => {
      const token = await this.douyinClientToken();
      const res = await axios.get(DOUYIN_TICKET, {
        headers: { 'access-token': token, 'content-type': 'application/json' },
        timeout: 10000,
      });
      const data = this.douyinData(res.data, '抖音发布暂不可用，请稍后再试');
      if (!data.ticket) throw new ServiceUnavailableException('抖音发布暂不可用，请稍后再试');
      return { value: data.ticket, ttlSec: this.ttl(data.expires_in, 7200) };
    });
  }

  private async douyinClientToken(): Promise<string> {
    return this.cached('douyin:client_token', async () => {
      const res = await axios.post(
        DOUYIN_TOKEN,
        {
          client_key: this.env('DOUYIN_CLIENT_KEY'),
          client_secret: this.env('DOUYIN_CLIENT_SECRET'),
          grant_type: 'client_credential',
        },
        { timeout: 10000 },
      );
      const data = this.douyinData(res.data, '抖音发布暂不可用，请稍后再试');
      if (!data.access_token) throw new ServiceUnavailableException('抖音发布暂不可用，请稍后再试');
      return { value: data.access_token, ttlSec: this.ttl(data.expires_in, 7200) };
    });
  }

  /**
   * 重复申请会让上一张 access_token 失效，所以必须全局缓存。
   * 第一次用 appSecret 签名，第二次用 access_token 签名，算法相同。
   */
  private async xhsToken(): Promise<string> {
    return this.cached('xhs:access_token', async () => {
      const nonce = randomBytes(12).toString('hex');
      const timestamp = Date.now();
      const res = await axios.post(
        XHS_TOKEN,
        {
          app_key: this.env('XHS_APP_KEY'),
          nonce,
          timestamp,
          signature: this.xhsSign(nonce, String(timestamp), this.env('XHS_APP_SECRET')),
        },
        { timeout: 10000 },
      );
      const body = (res.data ?? {}) as {
        access_token?: string;
        expires_in?: number;
        msg?: string;
        message?: string;
        data?: { access_token?: string; expires_in?: number; message?: string };
      };
      const token = body.access_token || body.data?.access_token;
      if (!token) {
        const msg = body.msg || body.message || body.data?.message || '没有拿到凭证';
        this.logger.warn(`小红书 access_token 失败: ${msg}`);
        throw new ServiceUnavailableException('小红书发布暂不可用，请稍后再试');
      }
      return { value: token, ttlSec: this.ttl(body.expires_in ?? body.data?.expires_in, 86400) };
    });
  }

  /** 字段名按官方示例：appKey、nonce、timeStamp，排序后直接拼上密钥，不做转义。 */
  private xhsSign(nonce: string, timeStamp: string, secret: string) {
    const base = `appKey=${this.env('XHS_APP_KEY')}&nonce=${nonce}&timeStamp=${timeStamp}`;
    return createHash('sha256').update(`${base}${secret}`).digest('hex');
  }

  private douyinData(payload: unknown, fallback: string): TokenPayload {
    const body = (payload ?? {}) as { data?: TokenPayload; extra?: TokenPayload; message?: string };
    const data = body.data ?? (payload as TokenPayload);
    const extra = body.extra;
    const code = Number(data?.error_code || extra?.error_code || 0);
    if (!code) return data ?? {};
    const description = String(data?.description || extra?.description || body.message || fallback);
    this.logger.warn(`抖音开放平台 ${code}: ${description}`);
    // 权限是按调用时的应用状态判断的；刚开通时，缓存里的旧 token 可能还是开通前签发的
    if (REFRESH_TOKEN_CODES.has(code)) {
      void this.redis.getClient().del('douyin:client_token', 'douyin:open_ticket');
    }
    throw new ServiceUnavailableException(this.douyinMessage(code, description, fallback));
  }

  /** 2190004 是抖音自己的权限错误，不是请求格式错误。 */
  private douyinMessage(code: number, description: string, fallback: string) {
    if (code === 2190004) {
      return '抖音未授权获取 openTicket。请在「投稿能力」里单独开通「获取 openTicket」和「H5 场景」，只开总开关不够';
    }
    return String(description || fallback).slice(0, 80);
  }

  /** 抖音返回的是剩余秒数；小红书返回的是截止时间戳。提前两分钟刷新。 */
  private ttl(expiresIn: number | undefined, fallbackSec: number) {
    const value = Number(expiresIn);
    if (!Number.isFinite(value) || value <= 0) return Math.max(60, fallbackSec - 120);
    const now = Date.now();
    const expireAt = value > 1e12 ? value : value > 1e9 ? value * 1000 : now + value * 1000;
    return Math.max(60, Math.floor((expireAt - now) / 1000) - 120);
  }

  private async cached(key: string, loader: () => Promise<{ value: string; ttlSec: number }>) {
    const client = this.redis.getClient();
    const hit = await client.get(key);
    if (hit) return hit;
    const lockKey = `${key}:lock`;
    const locked = await client.set(lockKey, '1', 'EX', 20, 'NX');
    if (locked !== 'OK') {
      for (let i = 0; i < 10; i++) {
        await this.delay(200);
        const again = await client.get(key);
        if (again) return again;
      }
    }
    try {
      const again = await client.get(key);
      if (again) return again;
      const loaded = await loader();
      await client.set(key, loaded.value, 'EX', Math.max(60, loaded.ttlSec));
      return loaded.value;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) throw error;
      this.logger.warn(`开放平台请求失败 ${key}: ${this.explain(error)}`);
      throw new ServiceUnavailableException('发布服务暂时不可用，请稍后再试');
    } finally {
      if (locked === 'OK') await client.del(lockKey);
    }
  }

  private explain(error: unknown) {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data as { data?: { description?: string }; message?: string } | undefined;
      return data?.data?.description || data?.message || error.message;
    }
    return error instanceof Error ? error.message : String(error);
  }

  private env(key: string) {
    return (this.config.get<string>(key) || '').trim();
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
