import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ApiException } from '../../common/api-exception';
import { RedisModuleOptions } from './redis.interface';

export const REDIS_MODULE_OPTIONS = 'REDIS_MODULE_OPTIONS';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(@Inject(REDIS_MODULE_OPTIONS) options: RedisModuleOptions) {
    this.client = new Redis({
      host: options.host,
      port: options.port,
      password: options.password || undefined,
      db: options.db || 0,
    });
    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });
  }

  getClient(): Redis {
    return this.client;
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async setNx(key: string, value: string, ttlSec: number): Promise<boolean> {
    const r = await this.client.set(key, value, 'EX', ttlSec, 'NX');
    return r === 'OK';
  }

  async incrWindow(key: string, ttlSec: number): Promise<number> {
    const n = await this.client.incr(key);
    if (n === 1) await this.client.expire(key, ttlSec);
    return n;
  }

  async withLock<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
    const ok = await this.setNx(key, '1', ttlSec);
    if (!ok) throw ApiException.conflict('操作处理中，请稍后重试');
    try {
      return await fn();
    } finally {
      await this.client.del(key);
    }
  }
}
