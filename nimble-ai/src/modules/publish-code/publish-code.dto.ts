import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdatePublishCodeDto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @MaxLength(40)
  displayName: string;

  @IsString()
  @MaxLength(1000)
  caption: string;

  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  hashtags: string[];

  @IsString()
  @MaxLength(32)
  poiId: string;

  @IsString()
  @MaxLength(80)
  poiName: string;

  @IsString()
  @MaxLength(20)
  xhsTitle: string;

  /** 海报底部文案。空字符串表示用默认那句 */
  @IsString()
  @MaxLength(40)
  qrCaption: string;
}

/** 落地页提交的是扫码人改过的描述。作品和话题仍以创作者的设置为准。 */
export class PublicShareDto {
  @IsUUID()
  taskId: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  index: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  caption?: string;
}

const VIDEO_SOURCES = [
  'short-video',
  'tool',
  'generation',
  'asset',
  'project',
  'video-example',
  'canvas',
  'canvas-example',
  'prompt',
  'forum',
  'tool-example',
  'stock',
] as const;

export class VideoShareDto {
  @IsIn(['douyin', 'xhs'])
  platform: 'douyin' | 'xhs';

  @IsIn(VIDEO_SOURCES)
  source: (typeof VIDEO_SOURCES)[number];

  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  id: string;

  /** 多视频作品内的选中项。服务端只从已授权的作品中取对应地址。 */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  video?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  caption?: string;
}
