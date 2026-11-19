import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { APP_INTERCEPTOR, APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import jwtConfig from './config/jwt.config';
import { RedisModule } from './modules/redis/redis.module';
import { AgentModule } from './modules/agent/agent.module';
import { AtlasModule } from './modules/atlas/atlas.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { MediaPipelineModule } from './modules/media-pipeline/media-pipeline.module';
import { VideoModule } from './modules/video/video.module';
import { EngagementModule } from './modules/engagement/engagement.module';
import { GenerationModule } from './modules/generation/generation.module';
import { AssetModule } from './modules/asset/asset.module';
import { PromptModule } from './modules/prompt/prompt.module';
import { ForumModule } from './modules/forum/forum.module';
import { CanvasModule } from './modules/canvas/canvas.module';
import { ShortVideoModule } from './modules/short-video/short-video.module';
import { PublishCodeModule } from './modules/publish-code/publish-code.module';
import { MediaToolsModule } from './modules/media-tools/media-tools.module';
import { StorageModule } from './modules/storage/storage.module';
import { AuthModule } from './modules/auth/auth.module';
import { PayModule } from './modules/pay/pay.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { BillingModule } from './modules/billing/billing.module';
import { UserModule } from './modules/user/user.module';
import { StatsModule } from './modules/stats/stats.module';
import { DistributorModule } from './modules/distributor/distributor.module';
import { InitModule } from './modules/init/init.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production' ? '.env.production' : '.env',
      load: [jwtConfig],
    }),

    RedisModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        host: configService.get('REDIS_HOST', '127.0.0.1'),
        port: configService.get('REDIS_PORT', 6379),
        password: configService.get('REDIS_PASSWORD'),
        db: configService.get('REDIS_DB', 0),
      }),
      inject: [ConfigService],
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST', '127.0.0.1'),
        port: configService.get('DB_PORT', 5432),
        username: configService.get('DB_USERNAME', 'postgres'),
        password: configService.get('DB_PASSWORD'),
        database: configService.get('DB_DATABASE', 'lingmi'),
        autoLoadEntities: true,
        synchronize: process.env.NODE_ENV !== 'production',
        logging: false,
        extra: {
          max: 20,
          min: 5,
          acquire: 30000,
          idle: 10000,
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get('REDIS_HOST', '127.0.0.1'),
          port: configService.get('REDIS_PORT', 6379),
          password: configService.get('REDIS_PASSWORD'),
          db: configService.get('REDIS_DB', 0),
        },
      }),
      inject: [ConfigService],
    }),

    StorageModule,
    PricingModule,
    BillingModule,
    AtlasModule,
    ProvidersModule,
    MediaPipelineModule,
    EngagementModule,
    VideoModule,
    GenerationModule,
    AssetModule,
    PromptModule,
    ForumModule,
    CanvasModule,
    ShortVideoModule,
    PublishCodeModule,
    MediaToolsModule,
    AgentModule,

    AuthModule,
    PayModule,
    UserModule,
    StatsModule,
    DistributorModule,
    InitModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
