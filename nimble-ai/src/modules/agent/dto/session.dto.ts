import { IsString, IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ContentBlock } from '../content-block/content-block.interface';

/** 会话查询 DTO */
export class SessionQueryDto {
  @IsOptional()
  @IsString()
  agentId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  pageSize?: number = 20;
}

/** 会话详情响应 */
export class SessionDetailDto {
  id: string;
  title: string;
  agentId: string;
  userId: string;
  status: string;
  model: string;
  messageCount: number;
  lastActiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** 会话消息响应 */
export class SessionMessageDto {
  id: string;
  role: string;
  input: string;
  blocks: ContentBlock[];
  model: string;
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  latencyMs: number;
  createdAt: Date;
}

/** 会话列表响应 */
export class SessionListDto {
  items: SessionDetailDto[];
  total: number;
  page: number;
  pageSize: number;
}
