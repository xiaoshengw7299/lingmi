import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ForumCommentEntity, ForumLikeEntity, ForumPostEntity } from './forum.entity';
import { ForumController } from './forum.controller';
import { ForumService } from './forum.service';

/** 论坛与反馈：公开讨论，或仅管理员可见的问题反馈 */
@Module({
  imports: [TypeOrmModule.forFeature([ForumPostEntity, ForumCommentEntity, ForumLikeEntity])],
  controllers: [ForumController],
  providers: [ForumService],
  exports: [ForumService],
})
export class ForumModule {}
