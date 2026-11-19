import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { MENTION_NAME_RE } from '../../common/media';
import { PromptType } from './prompt.entity';

class PromptParamsDto {
  @IsOptional() @IsString() @MaxLength(20)
  ratio?: string;

  @IsOptional() @IsString() @MaxLength(20)
  resolution?: string;

  @IsOptional() @IsInt() @Min(1) @Max(60)
  durationSec?: number;
}

export class PromptReferenceDto {
  @IsString() @MaxLength(40) @Matches(MENTION_NAME_RE, { message: '参考名称不能包含空格或标点' })
  name: string;

  @IsIn(['image', 'video', 'audio'])
  kind: 'image' | 'video' | 'audio';

  /** 已上传文件的地址（只能是自己上传的） */
  @IsString()
  url: string;
}

export class CreatePromptDto {
  @IsString() @MaxLength(120)
  title: string;

  @IsString() @MaxLength(8000)
  content: string;

  @IsIn(['image', 'video'])
  type: PromptType;

  @IsOptional() @IsString() @MaxLength(100)
  modelId?: string;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => PromptParamsDto)
  params?: PromptParamsDto;

  /** 参考素材：和工作台的素材库一样，提示词里用 @名称 引用 */
  @IsOptional() @IsArray() @ArrayMaxSize(9) @ValidateNested({ each: true }) @Type(() => PromptReferenceDto)
  references?: PromptReferenceDto[];

  /** 用该提示词成功生成过的任务 id：作为示例成品，保证库里每条提示词都有可见效果 */
  @IsUUID()
  taskId: string;
}

export class QueryPromptDto {
  @IsOptional() @IsIn(['image', 'video'])
  type?: PromptType;

  @IsOptional() @IsIn(['hot', 'new'])
  sort?: 'hot' | 'new';

  @IsOptional() @IsString() @MaxLength(50)
  keyword?: string;

  @IsOptional() @IsString()
  page?: string;

  @IsOptional() @IsString()
  pageSize?: string;
}
