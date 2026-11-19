import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModuleAsyncOptions } from './redis-async-options.interface';
import { REDIS_MODULE_OPTIONS, RedisService } from './redis.service';

@Global()
@Module({})
export class RedisModule {
  static forRootAsync(options: RedisModuleAsyncOptions): DynamicModule {
    return {
      module: RedisModule,
      global: true,
      imports: options.imports || [ConfigModule],
      providers: [
        {
          provide: REDIS_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject || [ConfigService],
        },
        RedisService,
      ],
      exports: [RedisService],
    };
  }
}
