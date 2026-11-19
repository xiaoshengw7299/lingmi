// redis/redis.interface.ts
export interface RedisModuleOptions {
  host: string;
  port: number;
  password?: string;
  db?: number;
}
