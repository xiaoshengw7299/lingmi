import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PayModule } from '../pay/pay.module';
import { ShortVideoTaskEntity } from '../short-video/entities/short-video-task.entity';
import { User } from '../user/entities/user.entity';
import { VideoProjectEntity } from '../video/entities/video-project.entity';
import { PresenceService } from './presence.service';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

/** 平台统计：在线状态由登录守卫写入（PresenceService），统计页由管理员访问 */
@Module({
  imports: [
    PayModule,
    TypeOrmModule.forFeature([User, VideoProjectEntity, ShortVideoTaskEntity]),
  ],
  controllers: [StatsController],
  providers: [StatsService, PresenceService],
  exports: [PresenceService],
})
export class StatsModule {}
