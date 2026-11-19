import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { GenerationKind } from './generation.entity';

const MAX_REFS = 9;

class LoraDto {
  @IsString() @MaxLength(100) name: string;

  @IsNumber() @Min(0) @Max(2) weight: number;
}

export class GenerateDto {
  @IsIn(['image', 'video', 'audio', 'text'])
  kind: GenerationKind;

  @IsString()
  @MaxLength(8000)
  prompt: string;

  @IsOptional() @IsString() @MaxLength(100)
  modelId?: string;

  @IsOptional() @IsString() @MaxLength(20)
  ratio?: string;

  @IsOptional() @IsString() @MaxLength(20)
  resolution?: string;

  @IsOptional() @IsString() @MaxLength(20)
  outputFormat?: string;

  @IsOptional() @IsString() @MaxLength(20)
  promptOptimizeMode?: string;

  @IsOptional() @ValidateNested() @Type(() => LoraDto)
  lora?: LoraDto | null;

  @IsOptional() @IsInt() @Min(1) @Max(60)
  durationSec?: number;

  @IsOptional() @IsBoolean()
  generateAudio?: boolean;

  @IsOptional() @IsArray() @ArrayMaxSize(MAX_REFS) @IsString({ each: true })
  refImages?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(MAX_REFS) @IsString({ each: true })
  refVideos?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(MAX_REFS) @IsString({ each: true })
  refAudios?: string[];

  /** 配音音色 id（audio 专用） */
  @IsOptional() @IsString() @MaxLength(50)
  voice?: string;
}

/** 归一化裁剪框：x/y/w/h 都是 0–1 的比例，前端不需要知道图片真实像素 */
export class CropRectDto {
  @IsNumber() @Min(0) @Max(1) x: number;
  @IsNumber() @Min(0) @Max(1) y: number;
  @IsNumber() @Min(0) @Max(1) w: number;
  @IsNumber() @Min(0) @Max(1) h: number;
}

/** 图片小工具：crop 裁剪 / split 拆分 / upscale 放大 / mark 叠加局部重绘标注 */
export class ImageToolDto {
  @IsIn(['crop', 'split', 'upscale', 'mark'])
  op: 'crop' | 'split' | 'upscale' | 'mark';

  @IsString()
  url: string;

  @IsOptional() @ValidateNested() @Type(() => CropRectDto)
  rect?: CropRectDto;

  @IsOptional() @IsInt() @Min(1) @Max(6)
  rows?: number;

  @IsOptional() @IsInt() @Min(1) @Max(6)
  cols?: number;

  @IsOptional() @IsIn([2, 4])
  factor?: 2 | 4;

  /** mark：PNG dataURL，透明底 + 标注笔迹 */
  @IsOptional() @IsString() @MaxLength(8_000_000)
  mask?: string;
}