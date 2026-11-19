/**
 * Content Block 类型系统
 *
 * 4 种核心块，对应前端 4 种渲染模式：
 *   text    → 普通文本（支持 Markdown）
 *   think   → 模型思考过程（可折叠展示）
 *   process → 进度/步骤提示（如工具调用）
 *   bi      → 内置组件渲染（如分镜脚本卡片 video-storyboard）
 */

/** Content block type identifiers */
export type BlockType = 'text' | 'think' | 'process' | 'bi';

/** BI component tag (extensible) */
export type BiTag = 'video-storyboard' | (string & {});

// ─── Block Definitions ────────────────────────────────────────

/** 普通文本内容 */
export interface TextBlock {
  type: 'text';
  content: string;
}

/** 模型思考/推理过程 */
export interface ThinkBlock {
  type: 'think';
  content: string;
}

/** 进度/步骤提示（通用） */
export interface ProcessBlock {
  type: 'process';
  /** 唯一标识（用于前端精确匹配 SSE 更新，借鉴 OpenClaw toolCallId 模式） */
  id?: string;
  /** 人类可读的进度描述 */
  content: string;
  /** 进度状态：running=执行中, done=已完成, error=执行失败 */
  status?: 'running' | 'done' | 'error';
}

/** 内置组件渲染 */
export interface BiBlock {
  type: 'bi';
  /** 组件标签（对应前端渲染组件） */
  tag: BiTag;
  /** 组件数据 */
  data: any;
  /** 可选标题 */
  title?: string;
}

// ─── Union Type ───────────────────────────────────────────────

/** 所有内容块联合类型 */
export type ContentBlock =
  | TextBlock
  | ThinkBlock
  | ProcessBlock
  | BiBlock;
