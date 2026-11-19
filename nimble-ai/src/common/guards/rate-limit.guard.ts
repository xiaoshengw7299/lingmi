import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RedisService } from '../../modules/redis/redis.service';

const KEY = 'rate-limit';

interface Rule {
  limit: number;
  windowSec: number;
}

/**
 * 接口限流：同一用户（未登录则按 IP）在窗口内最多调用 limit 次。
 * 用 Redis 计数，多实例共享；主要挡登录、注册、改密这类可被暴力尝试的接口。
 */
export const RateLimit = (limit: number, windowSec = 60) =>
  applyDecorators(SetMetadata(KEY, { limit, windowSec } satisfies Rule), UseGuards(RateLimitGuard));

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.get<Rule | undefined>(KEY, context.getHandler());
    if (!rule) return true;
    const req = context.switchToHttp().getRequest<{ ip?: string; user?: { userId: number } }>();
    const who = req.user?.userId ?? req.ip ?? 'unknown';
    const key = `rate:${context.getClass().name}.${context.getHandler().name}:${who}`;
    const client = this.redis.getClient();
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, rule.windowSec);
    if (count > rule.limit) throw new HttpException('操作太频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    return true;
  }
}
