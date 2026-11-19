import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ForumStatus, ForumVisibility } from './forum.entity';

/** 与上传接口一致：单个附件不超过 20MB，一帖最多 6 个 */
export const FORUM_MAX_FILES = 6;
export const FORUM_MAX_BYTES = 20 * 1024 * 1024;

export class ForumAttachmentDto {
  @IsString() @MaxLength(300)
  key: string;

  @IsString() @MaxLength(80)
  name: string;

  @IsString() @MaxLength(100)
  mime: string;

  @IsInt() @Min(1) @Max(FORUM_MAX_BYTES)
  size: number;
}

export class CreateForumPostDto {
  @IsString() @MaxLength(80)
  title: string;

  @IsString() @MaxLength(5000)
  content: string;

  /** 不传则公开 */
  @IsOptional() @IsIn(['public', 'admin'])
  visibility?: ForumVisibility;

  @IsOptional() @IsArray() @ArrayMaxSize(FORUM_MAX_FILES) @ValidateNested({ each: true }) @Type(() => ForumAttachmentDto)
  attachments?: ForumAttachmentDto[];
}

export class UpdateForumPostDto extends CreateForumPostDto {}

export class QueryForumDto {
  @IsOptional() @IsString() @MaxLength(50)
  keyword?: string;

  @IsOptional() @IsString()
  page?: string;

  @IsOptional() @IsString()
  pageSize?: string;
}

export class CreateForumCommentDto {
  @IsString() @MaxLength(2000)
  content: string;
}

export class UpdateForumStatusDto {
  @IsIn(['open', 'resolved'])
  status: ForumStatus;
}
