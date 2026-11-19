// redis/redis.service.ts
import { Injectable, OnModuleDestroy, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisModuleOptions } from './redis.interface';

export const REDIS_MODULE_OPTIONS = 'REDIS_MODULE_OPTIONS';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(
    @Inject(REDIS_MODULE_OPTIONS) private readonly options: RedisModuleOptions,
  ) {
    this.client = new Redis({
      host: options.host,
      port: options.port,
      password: options.password,
      db: options.db || 0,
    });

    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });
  }

  getClient(): Redis {
    return this.client;
  }

  async get<T = string>(key: string): Promise<T | null> {
    const val = await this.client.get(key);
    if (val === null) return null;
    try {
      return JSON.parse(val) as T;
    } catch {
      return val as unknown as T;
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttl) {
      await this.client.setex(key, ttl, str);
    } else {
      await this.client.set(key, str);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    await this.client.del(...keys);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result > 0;
  }

  async expire(key: string, ttl: number): Promise<void> {
    await this.client.expire(key, ttl);
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
