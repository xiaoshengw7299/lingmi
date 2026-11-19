// redis/redis.module.ts
import { Module, DynamicModule, Global } from '@nestjs/common';
import { RedisService, REDIS_MODULE_OPTIONS } from './redis.service';
import { RedisModuleAsyncOptions } from './redis-async-options.interface';
import { ConfigModule, ConfigService } from '@nestjs/config';

export interface RedisModuleOptions {
  host: string;
  port: number;
  password?: string;
  db?: number;
}

@Global()
@Module({})
export class RedisModule {
  static forRootAsync(options: RedisModuleAsyncOptions): DynamicModule {
    const asyncOptions = {
      name: REDIS_MODULE_OPTIONS,
      imports: options.imports || [ConfigModule],
      useFactory: options.useFactory,
      inject: options.inject || [ConfigService],
    };

    return {
      module: RedisModule,
      global: true,
      imports: options.imports || [ConfigModule],
      providers: [
        {
          provide: REDIS_MODULE_OPTIONS,
          ...asyncOptions,
        },
        RedisService,
      ],
      exports: [RedisService],
    };
  }
}
