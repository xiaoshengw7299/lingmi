import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { ApiException } from '../api-exception';
import { hmacSha256Hex, safeEqualHex, sha256Hex } from '../crypto/crypto.util';
import { NONCE_TTL_SEC, OPEN_RATE_LIMIT_PER_MIN } from '../constants';
import { RedisService } from '../../infra/redis/redis.service';
import { OpenAppService } from '../../modules/open-app/open-app.service';

@Injectable()
export class OpenAppGuard implements CanActivate {
  constructor(
    private readonly apps: OpenAppService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const appId = String(req.headers['x-app-id'] || '');
    const timestamp = String(req.headers['x-timestamp'] || '');
    const nonce = String(req.headers['x-nonce'] || '');
    const sign = String(req.headers['x-sign'] || '');
    if (!appId || !timestamp || !nonce || !sign) throw ApiException.unauthorized('缺少签名头', 40102);
    if (appId !== this.apps.appId()) throw ApiException.unauthorized('应用不存在', 40102);

    const windowSec = Number(this.config.get('OPEN_SIGN_WINDOW_SEC') || 300);
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > windowSec) {
      throw ApiException.unauthorized('请求已过期', 40102);
    }
    const first = await this.redis.setNx(`nonce:nimble:${nonce}`, '1', NONCE_TTL_SEC);
    if (!first) throw ApiException.unauthorized('重复请求', 40102);
    const rate = await this.redis.incrWindow(`rl:nimble:${Math.floor(Date.now() / 60000)}`, 70);
    const limit = Number(this.config.get('OPEN_RATE_LIMIT_PER_MIN')) || OPEN_RATE_LIMIT_PER_MIN;
    if (rate > limit) throw ApiException.bad('请求过于频繁', 42901);

    const app = await this.apps.ensure();
    const raw = req.rawBody ?? '';
    const path = (req.originalUrl || req.url).split('?')[0];
    const canonical = `${timestamp}\n${nonce}\n${req.method.toUpperCase()}\n${path}\n${sha256Hex(raw)}`;
    const expected = hmacSha256Hex(this.apps.appSecret(), canonical);
    if (!safeEqualHex(expected, sign)) throw ApiException.unauthorized('验签失败', 40102);
    req.openApp = { id: app.id, appId: app.appId, appName: app.appName };
    return true;
  }
}
