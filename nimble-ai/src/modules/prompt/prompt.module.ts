import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GenerationModule } from '../generation/generation.module';
import { PromptEntity } from './prompt.entity';
import { PromptController } from './prompt.controller';
import { PromptService } from './prompt.service';

/** 共享提示词库：发布、浏览、复制，按热度综合排序 */
@Module({
  imports: [TypeOrmModule.forFeature([PromptEntity]), GenerationModule],
  controllers: [PromptController],
  providers: [PromptService],
})
export class PromptModule {}
