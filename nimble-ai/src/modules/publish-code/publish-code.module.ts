import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShortVideoTaskEntity } from '../short-video/entities/short-video-task.entity';
import { User } from '../user/entities/user.entity';
import { PublishCodeEntity } from './entities/publish-code.entity';
import { PublishCodeController } from './publish-code.controller';
import { PublishCodeService } from './publish-code.service';
import { ShareOpenService } from './share-open.service';
import { VideoShareService } from './video-share.service';
import { VideoModule } from '../video/video.module';
import { ForumModule } from '../forum/forum.module';

/** 一键成片发布码与移动端视频发布，共用抖音和小红书签名。 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PublishCodeEntity, ShortVideoTaskEntity, User]),
    VideoModule,
    ForumModule,
  ],
  controllers: [PublishCodeController],
  providers: [PublishCodeService, ShareOpenService, VideoShareService],
})
export class PublishCodeModule {}
