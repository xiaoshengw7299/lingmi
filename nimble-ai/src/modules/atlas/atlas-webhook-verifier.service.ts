import * as crypto from 'crypto';
import axios from 'axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** 签名允许的最大时钟偏移（秒），防重放；与 Atlas 官方文档建议的 ~5 分钟一致 */
const REPLAY_WINDOW_SEC = 300;
/** JWKS 缓存最长有效期（毫秒），超过后即使 kid 命中也强制刷新一次，避免密钥被吊销后仍长期沿用旧缓存 */
const JWKS_MAX_AGE_MS = 60 * 60 * 1000;

export interface AtlasWebhookHeaders {
  timestamp?: string;
  keyId?: string;
  signatureEd25519?: string;
}

/**
 * 模型平台API Webhook 签名校验（Ed25519 + JWKS，官方推荐方案）。
 *
 * 只实现 Ed25519：HMAC 是官方标注的"迁移期遗留方案"，我们是全新接入，直接用推荐方案即可，
 * 不需要再多维护一套共享密钥校验逻辑。
 *
 * 验签步骤（对齐官方文档 Verifying signatures 一节）：
 * 1. 拒绝超出 5 分钟重放窗口的请求；
 * 2. 按 X-AtlasCloud-Webhook-Key-Id 从 JWKS 里查公钥（缓存，未命中的 kid 重新拉一次，应对密钥轮转）；
 * 3. 对 `"${timestamp}.${rawBody}"` 做 Ed25519 验签。
 */
@Injectable()
export class AtlasWebhookVerifierService {
  private readonly logger = new Logger(AtlasWebhookVerifierService.name);
  private readonly jwksUrl: string;
  private jwksCache: { at: number; keys: Map<string, crypto.KeyObject> } = { at: 0, keys: new Map() };

  constructor(private readonly configService: ConfigService) {
    const base = this.configService.get<string>('ATLASCLOUD_BASE_URL', 'https://api.atlascloud.ai/api/v1');
    this.jwksUrl = `${base.replace(/\/+$/, '')}/webhooks/jwks.json`;
  }

  private async loadJwks(forceRefresh: boolean): Promise<Map<string, crypto.KeyObject>> {
    const stale = Date.now() - this.jwksCache.at > JWKS_MAX_AGE_MS;
    if (!forceRefresh && !stale && this.jwksCache.keys.size) return this.jwksCache.keys;
    const { data } = await axios.get<{ keys: Array<Record<string, string>> }>(this.jwksUrl, { timeout: 10000 });
    const keys = new Map<string, crypto.KeyObject>();
    for (const jwk of data.keys ?? []) {
      try {
        keys.set(jwk.kid, crypto.createPublicKey({ key: jwk as any, format: 'jwk' }));
      } catch (error) {
        this.logger.warn(`JWKS 中的公钥 kid=${jwk.kid} 解析失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.jwksCache = { at: Date.now(), keys };
    return keys;
  }

  private async publicKeyFor(kid: string): Promise<crypto.KeyObject | undefined> {
    let keys = await this.loadJwks(false);
    if (!keys.has(kid)) keys = await this.loadJwks(true); // 未命中的 kid 可能是密钥刚轮转，强制刷新一次
    return keys.get(kid);
  }

  /** rawBody 必须是原始请求体字节（未经 JSON 反序列化再序列化），否则签名必然不匹配 */
  async verify(rawBody: Buffer, headers: AtlasWebhookHeaders): Promise<boolean> {
    const { timestamp, keyId, signatureEd25519 } = headers;
    if (!timestamp || !keyId || !signatureEd25519) {
      this.logger.warn('Webhook 请求缺少签名相关 Header，拒绝');
      return false;
    }
    const skewSec = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(skewSec) || skewSec > REPLAY_WINDOW_SEC) {
      this.logger.warn(`Webhook 时间戳超出重放窗口（偏移 ${skewSec}s），拒绝`);
      return false;
    }
    const publicKey = await this.publicKeyFor(keyId);
    if (!publicKey) {
      this.logger.warn(`Webhook 签名 kid="${keyId}" 未在 JWKS 中找到，拒绝`);
      return false;
    }
    try {
      const message = Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]);
      const signature = Buffer.from(signatureEd25519, 'base64url');
      return crypto.verify(null, message, publicKey, signature);
    } catch (error) {
      this.logger.warn(`Webhook 签名校验异常: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
