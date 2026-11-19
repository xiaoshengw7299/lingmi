import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ShortVideoTaskEntity } from './entities/short-video-task.entity';
import { ShortVideoController } from './short-video.controller';
import { ShortVideoService } from './short-video.service';
import { ScriptService } from './providers/script.service';
import { MaterialService } from './providers/material.service';
import { ShortVideoProcessor } from './processors/short-video.processor';
import { VideoModule } from '../video/video.module';
import { SHORT_VIDEO_QUEUE } from './short-video.queues';
import { ShortVideoPricingService } from './short-video-pricing.service';
import { ShortVideoAdminController } from './short-video-admin.controller';
import { SystemConfigModule } from '../system-config/system-config.module';

/**
 * 一键成片：文案/配音/字幕/素材/合成全部在本模块内自研实现（不再依赖外部 MoneyPrinterTurbo 服务）。
 * 配音（TtsService）、合成（FfmpegService）、免费素材检索（PexelsService）复用全局的 MediaPipelineModule；
 * AI 生成素材复用 VideoModule 导出的 ImageGenService（模型平台API 文生图）；
 * 文案生成（ScriptService）复用全局的 AtlasLlmService（模型平台API LLM 网关），
 * AtlasModule 是 @Global() 模块，无需在此显式 import 即可注入。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ShortVideoTaskEntity]),
    BullModule.registerQueue({ name: SHORT_VIDEO_QUEUE }),
    VideoModule,
    SystemConfigModule,
  ],
  controllers: [ShortVideoController, ShortVideoAdminController],
  providers: [
    ShortVideoService,
    ShortVideoPricingService,
    ScriptService,
    MaterialService,
    ShortVideoProcessor,
  ],
})
export class ShortVideoModule {}
