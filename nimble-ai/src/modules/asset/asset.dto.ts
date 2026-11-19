import { IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { AssetKind, AssetMeta } from './asset.entity';

export class CreateAssetDto {
  @IsIn(['image', 'video', 'audio', 'prompt'])
  kind: AssetKind;

  @IsString() @MaxLength(255)
  name: string;

  /** 媒体资产：来源 URL 或对象键（会复制一份独立副本） */
  @ValidateIf((o: CreateAssetDto) => o.kind !== 'prompt')
  @IsString()
  url?: string;

  /** 提示词资产：正文 */
  @ValidateIf((o: CreateAssetDto) => o.kind === 'prompt')
  @IsString() @MaxLength(8000)
  content?: string;

  @IsOptional() @IsObject()
  meta?: AssetMeta;
}

export class QueryAssetDto {
  @IsOptional() @IsIn(['image', 'video', 'audio', 'prompt'])
  kind?: AssetKind;

  @IsOptional() @IsString()
  keyword?: string;

  @IsOptional() @IsString()
  page?: string;

  @IsOptional() @IsString()
  pageSize?: string;
}
