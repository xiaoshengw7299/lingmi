import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

const KEY = 'presence:users';

/** 在线判定窗口。前端每 60 秒轮询一次余额，窗口取 5 倍留足网络抖动和切后台的余量 */
export const ONLINE_WINDOW_MS = 5 * 60_000;

/**
 * 用户活跃状态：登录用户每次请求都在 Redis 有序集合里记下最后活跃时间（分数），一个用户一个成员，
 * 集合大小不会超过用户总数。"在线"就是最后活跃时间落在窗口内。
 */
@Injectable()
export class PresenceService {
  constructor(private readonly redis: RedisService) {}

  touch(userId: number | string) {
    return this.redis.getClient().zadd(KEY, Date.now(), String(userId));
  }

  /** 从 sinceMs 起活跃过的用户数 */
  countSince(sinceMs: number) {
    return this.redis.getClient().zcount(KEY, sinceMs, '+inf');
  }

  online() {
    return this.countSince(Date.now() - ONLINE_WINDOW_MS);
  }
}
