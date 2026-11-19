import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { VideoModule } from '../video/video.module';
import { GenerationTaskEntity } from './generation.entity';
import { GenerationController } from './generation.controller';
import { GenerationProcessor } from './generation.processor';
import { ImageToolsService } from './image-tools.service';
import { GENERATION_QUEUE, GenerationService } from './generation.service';

/** 通用生成（图片 / 视频 / 音频 / 文本）：无限画布与提示词库共用，计费与模型配置复用 Atlas 那一套 */
@Module({
  imports: [TypeOrmModule.forFeature([GenerationTaskEntity]), BullModule.registerQueue({ name: GENERATION_QUEUE }), VideoModule],
  controllers: [GenerationController],
  providers: [GenerationService, GenerationProcessor, ImageToolsService],
  exports: [GenerationService, ImageToolsService],
})
export class GenerationModule {}
