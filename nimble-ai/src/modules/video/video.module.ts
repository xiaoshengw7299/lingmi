import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { VideoProjectEntity } from './entities/video-project.entity';
import { ShotEntity } from './entities/shot.entity';
import { VideoTakeEntity } from './entities/video-take.entity';
import { VideoComposeHistoryEntity } from './entities/video-compose-history.entity';
import { VideoExampleEntity } from './entities/video-example.entity';
import { ExampleShareReward } from './entities/example-share-reward.entity';
import { ExampleShareRewardService } from './example-share-reward.service';
import { SessionEntity } from '../agent/entities/session.entity';
import { PayModule } from '../pay/pay.module';
import { ImageGenService } from './providers/image-gen.service';
import { VideoGenService } from './providers/video-gen.service';
import { VideoService } from './video.service';
import { VideoController } from './video.controller';
import { VideoGateway } from './video.gateway';
import { ImageGenProcessor } from './processors/image-gen.processor';
import { VideoGenProcessor } from './processors/video-gen.processor';
import { ComposeProcessor } from './processors/compose.processor';
import { VIDEO_IMAGE_QUEUE, VIDEO_GEN_QUEUE, VIDEO_COMPOSE_QUEUE } from './video.queues';
import { AILoggerService } from '../agent/logger/ai-logger.service';
import { AuthModule } from '../auth/auth.module';

/**
 * AI 视频制作模块
 *
 * 分镜脚本生成复用通用 Agent 对话底座（见 agent/tools/video/generate-storyboard.tool.ts），
 * 本模块负责脚本生成之后的持久化与素材生产：素材库/分镜 CRUD、图片生成、视频生成（异步任务）、FFmpeg 合成。
 * 素材库统一承载图片、视频、音频三类素材，分镜提示词用 `@名称` 引用，生成时分别落到 Atlas 请求体的
 * 参考图/参考视频/参考音频字段（见 mention.util.ts、AtlasClientService 与 VideoGenService）。
 * 图片/视频生成统一走 模型平台API（AtlasModule，全局模块，见 app.module.ts），
 * 文本大模型（制作经验等）同样走 AtlasLlmService。具体有哪些模型见 config/atlas-models.json。
 * 耗时较长的生成任务统一通过 BullMQ 队列异步执行，完成后经 Socket.IO（VideoGateway）主动推送给前端，无需轮询。
 *
 * AILoggerService 在此独立注册，避免 VideoModule ↔ AgentModule 循环依赖；
 * 图片/视频大模型调用写入同一会话 JSONL，便于排查。
 *
 * FfmpegService 已迁到全局的 MediaPipelineModule（一键成片共用），这里不再本地注册；
 * ImageGenService/VideoGenService 是无状态的 Atlas 调用封装，额外导出给 short-video
 * 模块直接复用（生成 AI 素材/关键帧），不用各自重复实现一套 Atlas 请求逻辑。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      VideoProjectEntity,
      ShotEntity,
      VideoTakeEntity,
      VideoComposeHistoryEntity,
      VideoExampleEntity,
      ExampleShareReward,
      SessionEntity,
    ]),
    ConfigModule,
    AuthModule,
    PayModule,
    BullModule.registerQueue(
      { name: VIDEO_IMAGE_QUEUE },
      { name: VIDEO_GEN_QUEUE },
      { name: VIDEO_COMPOSE_QUEUE },
    ),
  ],
  controllers: [VideoController],
  providers: [
    ImageGenService,
    VideoGenService,
    AILoggerService,
    VideoService,
    ExampleShareRewardService,
    VideoGateway,
    ImageGenProcessor,
    VideoGenProcessor,
    ComposeProcessor,
  ],
  exports: [VideoService, ImageGenService, VideoGenService],
})
export class VideoModule {}
