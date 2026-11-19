import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class KeywordPageQuery extends PageQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;
}

/** Query 字符串在未走 class-transformer 时仍是 string，Prisma take 必须是 number */
export function paging(q: { page?: number | string; pageSize?: number | string }) {
  const page = Math.max(1, Math.floor(Number(q.page) || 1));
  let pageSize = Math.floor(Number(q.pageSize) || 20);
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 20;
  if (pageSize > 100) pageSize = 100;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function pageSkip(q: PageQueryDto): number {
  return paging(q).skip;
}
