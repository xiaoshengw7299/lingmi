import { IsString, IsOptional, IsNumber, IsInt, IsIn, Min, Max, MaxLength, MinLength, IsEnum, IsArray, ArrayNotEmpty, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { GenerationMode } from '../entities/video-project.entity';

/** 挂载的 LoRA 选择（name 对应 GET /video/models 返回的 loras[].name） */
export class LoraSelectionDto {
  @IsString()
  name: string;

  @IsNumber()
  @Min(0)
  @Max(2)
  weight: number;
}

/** 编辑分镜（前端工作台文字编辑，图片/视频状态字段不通过此接口修改） */
export class UpdateShotDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  videoPrompt?: string;

  @IsOptional()
  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(30)
  durationSec?: number;

  @IsOptional()
  @IsString()
  ratio?: string;

  @IsOptional()
  @IsString()
  resolution?: string;

  /** 视频生成模型 id；不传则沿用当前值，传空字符串/不传均可回退默认模型（见 AtlasModelRegistryService.resolveModel） */
  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LoraSelectionDto)
  lora?: LoraSelectionDto | null;
}

export class AddShotDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsString()
  videoPrompt: string;

  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(30)
  durationSec: number;

  @IsOptional()
  @IsString()
  ratio?: string;

  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsNumber()
  @IsInt()
  @Min(0)
  index?: number;

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LoraSelectionDto)
  lora?: LoraSelectionDto | null;
}

export class ReorderShotsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  shotIds: string[];
}

export class ReorderAssetsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  assetIds: string[];
}

export class GenerationModeDto {
  @IsEnum(['continuous', 'parallel'])
  generationMode: GenerationMode;
}

export class UpdateProjectTitleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;
}

export class BatchVideoDto {
  @IsOptional()
  @IsEnum(['continuous', 'parallel'])
  mode?: GenerationMode;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  shotIds: string[];
}

export class BatchImageDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  assetIds: string[];
}

/** 编辑素材（名称/提示词/图片生成设置；素材文件本身走上传与替换接口）。 */
export class UpdateAssetDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  /** 文本素材正文 */
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  text?: string;

  /** 图片生成模型 id；不传则沿用当前值 */
  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LoraSelectionDto)
  lora?: LoraSelectionDto | null;

  @IsOptional()
  @IsString()
  ratio?: string;

  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsString()
  outputFormat?: string;

  @IsOptional()
  @IsString()
  promptOptimizeMode?: string;
}

/** 新增素材。不传 kind 时新建待生成的图片；kind=text 新建文本。视频/音频只能上传。 */
export class AddAssetDto {
  @IsOptional()
  @IsIn(['image', 'text'])
  kind?: 'image' | 'text';

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  text?: string;

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LoraSelectionDto)
  lora?: LoraSelectionDto | null;

  @IsOptional()
  @IsString()
  ratio?: string;

  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsString()
  outputFormat?: string;

  @IsOptional()
  @IsString()
  promptOptimizeMode?: string;
}

/** 项目列表查询 */
export class QueryProjectDto {
  @IsOptional()
  @IsString()
  sessionId?: string;
}

/** 生成示例 */
export class CreateExampleDto {
  @IsOptional()
  @IsString()
  title?: string;
}

/** 案例库列表查询 */
export class QueryExampleDto {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;

  /** hot=综合（默认），new=最新 */
  @IsOptional()
  @IsIn(['hot', 'new'])
  sort?: 'hot' | 'new';
}

/** 从「我的资产」引入媒体到项目素材库 */
export class ImportAssetDto {
  @IsString()
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

/** 基于示例创建新项目 */
export class UseExampleDto {
  @IsString()
  sessionId: string;
}

/** 创建空白项目：跳过对话生成分镜的过程，直接进入工作台从零创作 */
export class CreateBlankProjectDto {
  @IsString()
  sessionId: string;

  @IsOptional()
  @IsString()
  title?: string;
}