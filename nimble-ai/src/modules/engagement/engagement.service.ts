import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ObjectLiteral, Repository } from 'typeorm';
import { RedisService } from '../redis/redis.service';

/** 同一用户对同一内容的同一种行为，一天内只记一次，防止刷量 */
const DEDUP_TTL_SECONDS = 24 * 60 * 60;

export type EngagementKind = 'view' | 'copy';

/** 访客标识：IP + UA。登录与否都按真实访客算，游客的浏览也计入，同一访客一天内刷新不重复计数 */
export const viewerOf = (req: Request): string =>
  createHash('md5').update(`${req.ip}|${req.headers['user-agent'] ?? ''}`).digest('hex').slice(0, 16);

/**
 * 浏览/复制计数。去重放在 Redis（SET NX + 过期），不需要额外建表；
 * 计数字段约定为实体上的 viewCount / copyCount，列名 view_count / copy_count，排序见 common/hot-rank.ts。
 */
@Injectable()
export class EngagementService {
  constructor(private readonly redis: RedisService) {}

  /** 返回本次是否真正计数（今天已记过则返回 false） */
  async record<T extends ObjectLiteral & { id: string }>(
    repo: Repository<T>,
    scope: string,
    id: string,
    userId: string,
    kind: EngagementKind,
  ): Promise<boolean> {
    const key = `engagement:${scope}:${id}:${userId}:${kind}`;
    const created = await this.redis.getClient().set(key, '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
    if (!created) return false;
    await repo.increment({ id } as never, kind === 'view' ? 'viewCount' : 'copyCount', 1);
    return true;
  }
}
