import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as dayjs from 'dayjs';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 一次对话请求的公共上下文。
 * sessionId 已编码在日志文件路径（logs/ai/{date}/{sessionId}.jsonl）中。
 */
export interface AiLogContext {
  requestId: string;
  sessionId: string;
}

/**
 * JSONL 日志行类型（按时间序还原一次完整任务）：
 *   system → user → assistant → tool → assistant → ...
 *   media  图片/视频等大模型调用（工作台异步任务也会写入同一会话文件）
 */
export type AiLogType = 'system' | 'user' | 'assistant' | 'tool' | 'media' | 'error';

export interface AiLogLine {
  ts: string;
  /** 请求追踪 ID，关联同一轮任务内的全部日志行 */
  rid: string;
  type: AiLogType;
  [key: string]: unknown;
}

/** 图片/视频大模型调用日志载荷 */
export interface AiMediaLogData {
  mediaType: 'image' | 'video';
  /** 模型 ID（Seedream / Seedance 等） */
  model: string;
  /** 角色/场景/分镜名称，便于排查 */
  name: string;
  /** success | failed | submitted */
  status: 'success' | 'failed' | 'submitted';
  prompt?: string;
  referenceImageCount?: number;
  referenceVideoCount?: number;
  referenceAudioCount?: number;
  durationSec?: number;
  /** 提交视频任务后的 Atlas prediction id */
  taskId?: string;
  /** 成功时的结果 URL（临时或永久） */
  url?: string;
  error?: string;
  /** 项目/分镜等业务 ID，便于跨端关联 */
  projectId?: string;
  shotId?: string;
  takeId?: string;
  refId?: string;
}

/**
 * AI 会话日志：按 `logs/ai/{日期}/{会话ID}.jsonl` 落盘。
 *
 * 一次完整任务按时间序记录，不重复 dump 全量上下文：
 *   1. system     系统提示词（一次）
 *   2. user       本轮用户提示词（一次）
 *   3. assistant  模型本步返回（文本 / 推理 / 工具调用）
 *   4. tool       工具执行结果（回传给模型的内容）
 *   5. media      图片/视频大模型调用（工作台异步任务）
 *   6. 后续轮次继续追加 assistant / tool / media 增量
 */
@Injectable()
export class AILoggerService {
  private readonly logger = new Logger(AILoggerService.name);
  private readonly baseDir: string;

  constructor(private readonly configService: ConfigService) {
    this.baseDir = this.configService.get<string>(
      'AI_LOG_DIR',
      path.join(process.cwd(), 'logs', 'ai'),
    );
  }

  /** 系统提示词（每轮任务写一次） */
  logSystem(ctx: AiLogContext, instructions: string) {
    this.write(ctx, 'system', { content: instructions });
  }

  /** 本轮用户提示词（每轮任务写一次） */
  logUser(ctx: AiLogContext, content: string) {
    this.write(ctx, 'user', { content });
  }

  /** 模型本步返回（循环轮次增量） */
  logAssistant(
    ctx: AiLogContext,
    data: {
      step: number;
      text?: string;
      reasoning?: string;
      toolCalls?: Array<{ name: string; args: unknown }>;
    },
  ) {
    this.write(ctx, 'assistant', data);
  }

  /** 工具执行结果（回传给模型的内容） */
  logTool(
    ctx: AiLogContext,
    data: {
      name: string;
      args?: unknown;
      result: string;
      ok: boolean;
    },
  ) {
    this.write(ctx, 'tool', data);
  }

  /** 图片/视频等大模型调用（Seedream / Seedance） */
  logMedia(ctx: AiLogContext, data: AiMediaLogData) {
    this.write(ctx, 'media', { ...data });
  }

  /** 异常 */
  logError(ctx: AiLogContext, stage: string, error: unknown) {
    this.write(ctx, 'error', {
      stage,
      msg: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  /** 读取指定会话某天的日志 */
  readSession(sessionId: string, date?: string): AiLogLine[] {
    const file = this.getLogFilePath(sessionId, date);
    if (!fs.existsSync(file)) return [];

    return fs
      .readFileSync(file, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as AiLogLine;
        } catch {
          return { ts: '', rid: '', type: 'error', raw: line } as AiLogLine;
        }
      });
  }

  // ─── 内部实现 ──────────────────────────────────────────────

  private write(ctx: AiLogContext, type: AiLogType, data: Record<string, unknown>) {
    const line: AiLogLine = {
      ts: dayjs().format('HH:mm:ss.SSS'),
      rid: ctx.requestId,
      type,
      ...data,
    };

    const dateStr = dayjs().format('YYYY-MM-DD');
    const logDir = path.join(this.baseDir, dateStr);
    const logFile = path.join(logDir, `${ctx.sessionId}.jsonl`);
    fsp.mkdir(logDir, { recursive: true })
      .then(() => fsp.appendFile(logFile, JSON.stringify(line) + '\n', 'utf-8'))
      .catch((error) =>
        this.logger.error('Failed to write AI log', error instanceof Error ? error.stack : String(error)),
      );
  }

  private getLogFilePath(sessionId: string, date?: string): string {
    const dateStr = date || dayjs().format('YYYY-MM-DD');
    return path.join(this.baseDir, dateStr, `${sessionId}.jsonl`);
  }
}
