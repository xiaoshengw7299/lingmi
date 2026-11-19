import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SHORT_VIDEO_PRICE_MODES, ShortVideoPriceMode } from '../short-video-pricing.service';
import {
  allVoiceValues,
  SHORT_VIDEO_ASPECTS,
  SHORT_VIDEO_BGM,
  SHORT_VIDEO_CONCAT,
  SHORT_VIDEO_FIT,
  SHORT_VIDEO_FONTS,
  SHORT_VIDEO_SOURCES,
  SHORT_VIDEO_STOCK_SOURCES,
  SHORT_VIDEO_SUBTITLE_POSITIONS,
  SHORT_VIDEO_TRANSITIONS,
  SHORT_VIDEO_VOICES,
} from '../short-video.options';

const ASPECTS = SHORT_VIDEO_ASPECTS.map((item) => item.value);
const VOICES = allVoiceValues();
const TTS_VOICES = SHORT_VIDEO_VOICES.map((item) => item.value);
const SOURCES = [...SHORT_VIDEO_SOURCES.map((item) => item.value), 'pexels'];
const STOCK_SOURCES = SHORT_VIDEO_STOCK_SOURCES.map((item) => item.value);
const BGM_TYPES = SHORT_VIDEO_BGM.map((item) => item.value);
const CONCAT_MODES = SHORT_VIDEO_CONCAT.map((item) => item.value);
const FIT_MODES = SHORT_VIDEO_FIT.map((item) => item.value);
const TRANSITIONS = SHORT_VIDEO_TRANSITIONS.map((item) => item.value);
const SUBTITLE_POSITIONS = SHORT_VIDEO_SUBTITLE_POSITIONS.map((item) => item.value);
const FONTS = SHORT_VIDEO_FONTS.map((item) => item.value);
const HEX_COLOR = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

export class StockPickDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  id: string;

  @IsString()
  @MaxLength(40)
  source: string;

  @IsString()
  @MaxLength(2000)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  poster?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsNumber()
  @Min(0)
  @Max(3600)
  @Type(() => Number)
  durationSec: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  width?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  height?: number;

  @IsOptional()
  @IsIn(['video', 'image'])
  mediaType?: 'video' | 'image';
}

export class ShortVideoMaterialDto {
  @IsString()
  @MaxLength(200)
  file: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  size?: number;
}

export class LoraSelectionDto {
  @IsString()
  @MaxLength(80)
  name: string;

  @IsNumber()
  @Min(0)
  @Max(2)
  @Type(() => Number)
  weight: number;
}

class ShortVideoPricedRequestDto {
  @IsOptional()
  @IsIn(SHORT_VIDEO_PRICE_MODES)
  confirmedPricing?: ShortVideoPriceMode;
}

export class CreateShortVideoTaskDto extends ShortVideoPricedRequestDto {
  @IsOptional()
  @IsUUID('4')
  requestId?: string;

  @IsString()
  @MinLength(1, { message: '请填写提示词' })
  @MaxLength(200)
  subject: string;

  /** 一次排队生成的条数。大于 1 时，做完一条再开下一条，每条重新写文案 */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  @Type(() => Number)
  count?: number;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  script?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  terms?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scriptPrompt?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  @Type(() => Number)
  paragraphNumber?: number;

  @IsOptional()
  @IsIn(ASPECTS)
  aspect?: string;

  @IsOptional()
  @IsIn(VOICES)
  voiceName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.6)
  @Max(5)
  @Type(() => Number)
  voiceVolume?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.8)
  @Max(2)
  @Type(() => Number)
  voiceRate?: number;

  @IsOptional()
  @IsIn(BGM_TYPES)
  bgmType?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  bgmVolume?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  bgmFile?: string;

  @IsOptional()
  @IsIn(SOURCES)
  videoSource?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsIn(STOCK_SOURCES, { each: true })
  stockSources?: string[];

  @IsOptional()
  @IsBoolean()
  semanticMatch?: boolean;

  @IsOptional()
  @IsBoolean()
  stockDedupe?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  imageModelId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LoraSelectionDto)
  imageLora?: LoraSelectionDto | null;

  @IsOptional()
  @IsIn(FIT_MODES)
  fitMode?: string;

  @IsOptional()
  @IsIn(CONCAT_MODES)
  concatMode?: string;

  @IsOptional()
  @IsIn(TRANSITIONS)
  transitionMode?: string;

  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(10)
  @Type(() => Number)
  clipDuration?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2)
  @Type(() => Number)
  clipSpeed?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  videoCount?: number;

  @IsOptional()
  @IsBoolean()
  matchMaterials?: boolean;

  /** 仅在 voiceName = "no-voice"（不配音）时生效：没有旁白时长可依据，需要显式指定视频总时长 */
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(180)
  @Type(() => Number)
  noVoiceDurationSec?: number;

  @IsOptional()
  @IsBoolean()
  subtitleEnabled?: boolean;

  @IsOptional()
  @IsIn(SUBTITLE_POSITIONS)
  subtitlePosition?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  customPosition?: number;

  @IsOptional()
  @IsIn(FONTS)
  fontName?: string;

  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(120)
  @Type(() => Number)
  fontSize?: number;

  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR, { message: '字幕颜色格式不正确' })
  textForeColor?: string;

  @IsOptional()
  @IsBoolean()
  textBackgroundEnabled?: boolean;

  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR, { message: '字幕背景色格式不正确' })
  textBackgroundColor?: string;

  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR, { message: '描边颜色格式不正确' })
  strokeColor?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(8)
  @Type(() => Number)
  strokeWidth?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ShortVideoMaterialDto)
  materials?: ShortVideoMaterialDto[];

  /** 免费素材来源时，用户确认过的素材 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => StockPickDto)
  stockPicks?: StockPickDto[];
}

export class QueryShortVideoTaskDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  pageSize?: number = 12;
}

export class DownloadShortVideoDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  index?: number = 0;
}

export class VoicePreviewDto extends ShortVideoPricedRequestDto {
  @IsIn(TTS_VOICES, { message: '请选择有效的配音音色' })
  voiceName: string;

  @IsOptional()
  @IsNumber()
  @Min(0.8)
  @Max(2)
  @Type(() => Number)
  voiceRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.6)
  @Max(5)
  @Type(() => Number)
  voiceVolume?: number;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  text?: string;
}

export class GenerateShortVideoScriptDto extends ShortVideoPricedRequestDto {
  @IsString()
  @MinLength(1, { message: '请填写提示词' })
  @MaxLength(200)
  subject: string;

  @IsOptional()
  @IsIn(VOICES)
  voiceName?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  @Type(() => Number)
  paragraphNumber?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scriptPrompt?: string;
}

export class PreviewShortVideoStockDto extends ShortVideoPricedRequestDto {
  @IsString()
  @MinLength(1, { message: '请填写提示词' })
  @MaxLength(200)
  subject: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  script?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  terms?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scriptPrompt?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  @Type(() => Number)
  paragraphNumber?: number;

  @IsOptional()
  @IsIn(VOICES)
  voiceName?: string;

  @IsOptional()
  @IsIn(ASPECTS)
  aspect?: string;

  @IsOptional()
  @IsArray()
  @IsIn(STOCK_SOURCES, { each: true })
  stockSources?: string[];

  @IsOptional()
  @IsBoolean()
  semanticMatch?: boolean;

  @IsOptional()
  @IsBoolean()
  stockDedupe?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  excludeIds?: string[];
}
