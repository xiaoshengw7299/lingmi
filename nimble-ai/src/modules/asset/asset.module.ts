import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserAssetEntity } from './asset.entity';
import { AssetController } from './asset.controller';
import { AssetService } from './asset.service';

/** 我的资产：图片 / 视频 / 音频 / 提示词，视频制作与无限画布共用 */
@Module({
  imports: [TypeOrmModule.forFeature([UserAssetEntity])],
  controllers: [AssetController],
  providers: [AssetService],
  exports: [AssetService],
})
export class AssetModule {}
