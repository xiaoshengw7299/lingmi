import { IsString, IsOptional, IsArray, IsBoolean, IsObject, IsIn, IsNumber, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ContentBlock } from '../content-block/content-block.interface';

/** 附件文件信息 */
export class ChatFileDto {
  /** 原始文件名 */
  @IsString()
  filename: string;

  /** 存储后的文件名 */
  @IsString()
  storedName: string;

  /** 相对于 workspace 的路径 */
  @IsString()
  path: string;

  /** 文件大小（字节） */
  @IsOptional()
  size?: number;

  /** MIME 类型 */
  @IsOptional()
  @IsString()
  mimetype?: string;
}

/** 大模型推理参数（由调用方传入，覆盖服务端默认值） */
export class LlmParamsDto {
  /** 最大输出 token 数 */
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxOutputTokens?: number;

  /** 采样温度（0~2），越低越确定性，越高越随机 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  /** Top-P 核采样（0~1） */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  topP?: number;

  /** Top-K 候选词数量（正整数） */
  @IsOptional()
  @IsNumber()
  @Min(1)
  topK?: number;

  /** 频率惩罚（-2~2），抑制重复词 */
  @IsOptional()
  @IsNumber()
  @Min(-2)
  @Max(2)
  frequencyPenalty?: number;

  /** 存在惩罚（-2~2），鼓励新话题 */
  @IsOptional()
  @IsNumber()
  @Min(-2)
  @Max(2)
  presencePenalty?: number;
}

/** 聊天请求 DTO（HTTP 入参，不含 userId；身份由 JWT 注入） */
export class ChatRequestDto {
  /** 会话ID（必填，由调用方生成并传入） */
  @IsString()
  sessionId: string;

  /** 用户输入 */
  @IsString()
  input: string;

  /** 智能体空间 ID（可选，不传则使用默认空间：视频制作 video-producer） */
  @IsOptional()
  @IsString()
  agentId?: string;

  /** 附件文件列表（独立于 input，作为上下文传入 LLM） */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatFileDto)
  files?: ChatFileDto[];

  /** 指定使用的 skills（可选，不传 = 默认加载全部技能；传了 = 仅加载数组内指定的技能） */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  /**
   * 指定开启的可选工具组（ToolDef.tag，如 video_gen）
   * 内置工具（read/memory/skill_manage）始终加载，不受此参数影响
   * 不传 = 默认加载全部可选工具组；传了（含空数组）= 仅加载数组内指定的分组
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  toolGroups?: string[];

  /** 指定使用的 LLM（atlas-models.json 的 llm 分组 id，可选，缺省用该分组默认模型） */
  @IsOptional()
  @IsString()
  model?: string;

  /** 是否流式返回 */
  @IsOptional()
  @IsBoolean()
  stream?: boolean;

  /** 额外的系统提示词 */
  @IsOptional()
  @IsString()
  extraPrompt?: string;

  /** 大模型推理参数（温度、最大 token 等，可选覆盖服务端默认） */
  @IsOptional()
  @ValidateNested()
  @Type(() => LlmParamsDto)
  llmParams?: LlmParamsDto;

  /** 扩展参数 */
  @IsOptional()
  @IsObject()
  extra?: Record<string, any>;
}

/** 内部聊天请求：DTO + 由控制器从 JWT 注入的 userId */
export type ChatRequest = ChatRequestDto & { userId: string };

/** Token 使用统计 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** 聊天响应 DTO */
export class ChatResponseDto {
  sessionId: string;
  messageId: string;
  /** 结构化内容块（唯一响应数据） */
  blocks: ContentBlock[];
  model: string;
  tokenUsage?: TokenUsage;
  latencyMs: number;
  title?: string;
  /** 本次请求的追踪 ID，排查问题时可用于查询 /agent/sessions/:id/logs */
  requestId: string;
}

// ─── SSE 事件 ─────────────────────────────────────────────────

/**
 * SSE 事件类型
 *
 * 两类本质：
 *   delta 类 → text / think（LLM 流式增量，逐字推送）
 *   block 类 → block（完整内容块：process / bi / 任意未来类型）
 *
 * 控制类 → start / done / error
 */
export type SSEEventType =
  | 'start'
  | 'text'
  | 'think'
  | 'block'
  | 'done'
  | 'error';

/** SSE 事件数据 */
export interface SSEEventData {
  type: SSEEventType;
  sessionId?: string;
  /** 本次请求的追踪 ID，排查问题时可用于查询 /agent/sessions/:id/logs */
  requestId?: string;

  /** text / think delta 内容 */
  content?: string;

  /** block 事件：完整的 ContentBlock（process / bi / 任意类型） */
  block?: ContentBlock;

  /** done 事件 */
  messageId?: string;
  blocks?: ContentBlock[];
  tokenUsage?: TokenUsage;
  title?: string;

  /** error 事件 */
  error?: string;
}

// ─── 消息反馈 ─────────────────────────────────────────────────

/** 消息反馈 DTO */
export class MessageFeedbackDto {
  /** 反馈类型：like=喜欢, dislike=不喜欢, null=取消反馈 */
  @IsOptional()
  @IsIn(['like', 'dislike', null])
  feedback: 'like' | 'dislike' | null;
}

