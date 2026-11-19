import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PayModule } from '../pay/pay.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { User } from './entities/user.entity';
import { VideoProjectEntity } from '../video/entities/video-project.entity';
import { ShortVideoTaskEntity } from '../short-video/entities/short-video-task.entity';

@Module({
  imports: [
    PayModule,
    TypeOrmModule.forFeature([
      User,
      VideoProjectEntity,
      ShortVideoTaskEntity,
    ]),
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService, TypeOrmModule],
})
export class UserModule {}
