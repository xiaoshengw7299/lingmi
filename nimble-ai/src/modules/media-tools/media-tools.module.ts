import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GenerationModule } from '../generation/generation.module';
import { MediaToolTask } from './entities/media-tool-task.entity';
import { MediaKitWebhookController, MediaToolsController } from './media-tools.controller';
import { MediaToolsService } from './media-tools.service';

/** 视频工具、通用工具：都跑在火山 AI MediaKit 上，计费和定价复用平台那一套 */
@Module({
  imports: [TypeOrmModule.forFeature([MediaToolTask]), GenerationModule],
  controllers: [MediaToolsController, MediaKitWebhookController],
  providers: [MediaToolsService],
})
export class MediaToolsModule {}
