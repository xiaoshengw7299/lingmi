import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** 输入和参数按工具目录做通用校验，这里只校验外层结构 */
export class RunToolDto {
  @IsString() @MaxLength(40)
  tool: string;

  @IsOptional() @IsString() @MaxLength(40)
  mode?: string;

  @IsOptional() @IsObject()
  inputs?: Record<string, unknown>;

  @IsOptional() @IsObject()
  values?: Record<string, unknown>;
}

export class ListToolTasksDto {
  @IsString() @MaxLength(40)
  tool: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  pageSize?: number;

  /** 只要成功的记录，给「选择剧本」这类下拉用 */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean()
  succeeded?: boolean;
}

/** 爆款复刻第二步：用动作视频做参考生成新视频 */
export class CloneGenerateDto {
  @IsString() @MaxLength(4000)
  prompt: string;

  @IsOptional() @IsString() @MaxLength(100)
  modelId?: string;

  @IsOptional() @IsString() @MaxLength(20)
  ratio?: string;

  @IsOptional() @IsString() @MaxLength(20)
  resolution?: string;

  @IsOptional() @IsInt() @Min(1) @Max(60)
  durationSec?: number;

  @IsOptional() @IsBoolean()
  generateAudio?: boolean;

  @IsOptional() @IsArray() @ArrayMaxSize(9) @IsString({ each: true })
  refImages?: string[];
}
