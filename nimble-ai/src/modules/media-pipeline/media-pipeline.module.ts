import { Global, Module } from '@nestjs/common';
import { FfmpegService } from './ffmpeg.service';
import { TtsService } from './tts.service';
import { BgmService } from './bgm.service';
import { PexelsService } from './pexels.service';
import { PixabayService } from './pixabay.service';
import { CoverrService } from './coverr.service';
import { WikimediaService } from './wikimedia.service';
import { OpenverseService } from './openverse.service';
import { StockMatchService } from './stock-match.service';

/**
 * 媒体生成基础设施（全局模块）
 *
 * 视频制作、一键成片共用 FFmpeg / 配音 / 配乐 / 多源免费素材选片。
 */
@Global()
@Module({
  providers: [
    FfmpegService,
    TtsService,
    BgmService,
    PexelsService,
    PixabayService,
    CoverrService,
    WikimediaService,
    OpenverseService,
    StockMatchService,
  ],
  exports: [
    FfmpegService,
    TtsService,
    BgmService,
    PexelsService,
    PixabayService,
    CoverrService,
    WikimediaService,
    OpenverseService,
    StockMatchService,
  ],
})
export class MediaPipelineModule {}
