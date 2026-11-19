import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ArkClientService } from './ark-client.service';
import { MediaKitClientService } from './mediakit-client.service';
import { MinimaxClientService } from './minimax-client.service';
import { VideoEnhanceService } from './video-enhance.service';

/** 官方模型通道。业务代码按模型目录里的 provider 选择，不把某一家写死成唯一入口 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [ArkClientService, MinimaxClientService, MediaKitClientService, VideoEnhanceService],
  exports: [ArkClientService, MinimaxClientService, MediaKitClientService, VideoEnhanceService],
})
export class ProvidersModule {}
