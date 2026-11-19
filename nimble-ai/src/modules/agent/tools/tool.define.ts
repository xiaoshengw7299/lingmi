import { z } from 'zod';
import type { LanguageModel } from 'ai';
import type { MemoryService } from '../memory';
import type { SkillLoader } from '../skills/skill.loader';
import type { VideoService } from '../../video/video.service';

// ─── 工具层 BI 渲染规格 ────────────────────────────────────────
// 注意：toolBi 中的 tag 对应 content-block.interface.ts BiBlock.tag
//       不要与 ContentBlock 中的 BiBlock.type='bi' 混淆

export interface BiToolSpec {
  /** 组件类型标签（对应前端渲染组件，如 video-storyboard） */
  tag: string;
  data: any;
  title?: string;
}

// ─── 工具执行结果 ───────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  /** 仅用于日志记录，不进入 LLM 上下文 */
  metadata?: Record<string, any>;
}

// ─── 可注入的服务集合 ───────────────────────────────────────────

export interface ToolServices {
  /** LLM 模型实例（工具内部调用 LLM 时使用） */
  model?: LanguageModel;
  /** 持久记忆服务（memory 工具使用，按 userId 隔离） */
  memoryService?: MemoryService;
  /** 技能加载器（skill_manage 工具用于定位/校验用户专属技能目录） */
  skillLoader?: SkillLoader;
  /** AI 视频制作服务（generate_storyboard 工具用于落库分镜脚本） */
  videoService?: VideoService;
}

// ─── 工具执行上下文 ─────────────────────────────────────────────

export interface ToolExecuteCtx {
  sessionId: string;
  userId: string;
  agentId: string;
  workspaceDir?: string;
  /** 技能根目录（skill_manage 工具据此定位用户专属技能子目录） */
  skillsDir?: string;
  extra?: Record<string, any>;
  services: ToolServices;
}

// ─── 工具定义 ───────────────────────────────────────────────────

export interface ToolDef<T extends z.ZodTypeAny = z.ZodTypeAny> {
  /** 工具唯一标识（LLM function calling 用，扁平命名，如 generate_storyboard） */
  name: string;
  /** 人类可读展示名（UI 进度块用） */
  title: string;
  /**
   * 工具标签（用于请求级过滤及扩展分类）
   * 不填 = 内置工具（始终加载，无需过滤）
   * 填写 = 可过滤工具（需 request.toolGroups 包含此值才加载）
   */
  tag?: string;
  /** 工具功能描述（给 LLM 理解用途） */
  description: string;
  /** Zod 参数 Schema（AI SDK tool() 直接使用，无需 jsonSchema() 包装） */
  parameters: T;
  /** 是否在 UI 中展示调用进度块，默认 = !!tag */
  showProgress?: boolean;
  execute: (args: z.infer<T>, ctx: ToolExecuteCtx) => Promise<ToolResult>;
}

/**
 * 定义一个工具
 *
 * 使用方式：
 * ```ts
 * export default defineTool({
 *   name: 'my_tool',
 *   title: '我的工具',
 *   description: '...',
 *   parameters: z.object({ ... }),
 *   execute: async (args, ctx) => { ... },
 * });
 * ```
 */
export function defineTool<T extends z.ZodTypeAny>(config: ToolDef<T>): ToolDef<T> {
  return config;
}

// ─── 结果辅助函数 ──────────────────────────────────────────────

/** 成功结果（纯文本） */
export const toolOk = (output: string, metadata?: Record<string, any>): ToolResult => ({
  success: true,
  output,
  metadata,
});

/**
 * 成功结果（含 BI 渲染块）
 *
 * 遵循 `{ content, bi }` 约定：
 * - content → LLM 上下文文本
 * - bi      → 前端渲染组件规格（tag + data + title）
 */
export const toolBi = (
  content: string,
  bi: BiToolSpec,
  metadata?: Record<string, any>,
): ToolResult => ({
  success: true,
  output: JSON.stringify({ content, bi }),
  metadata,
});

/** 失败结果 */
export const toolFail = (error: string, output?: string): ToolResult => ({
  success: false,
  output: output || error,
  error,
});
