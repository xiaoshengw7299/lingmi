import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CanvasProjectEntity } from './canvas.entity';
import { CanvasExampleEntity } from './canvas-example.entity';
import { CanvasController } from './canvas.controller';
import { CanvasExampleController } from './canvas-example.controller';
import { CanvasService } from './canvas.service';
import { CanvasExampleService } from './canvas-example.service';

/** 无限画布：项目（jsonb 文档 + 乐观锁保存）与分享的画布作品 */
@Module({
  imports: [TypeOrmModule.forFeature([CanvasProjectEntity, CanvasExampleEntity])],
  controllers: [CanvasController, CanvasExampleController],
  providers: [CanvasService, CanvasExampleService],
  exports: [CanvasService],
})
export class CanvasModule {}
