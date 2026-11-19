/**
 * 智能体空间元数据（frontmatter）
 *
 * 空间只承载"人设"相关配置（是谁、默认用什么模型），不再声明 toolGroups/skills 等
 * 能力范围参数——工具组/技能范围完全由请求参数决定（不传 = 默认全部，传了才限定）。
 */
export interface AgentSpaceMetadata {
  /** 空间唯一标识（对应请求的 agentId），未显式指定时取目录名 */
  key: string;
  /** 展示名称 */
  name: string;
  /** 默认模型（可选，不填则使用全局默认模型） */
  model?: string;
}

/** 智能体空间条目 */
export interface AgentSpaceEntry {
  metadata: AgentSpaceMetadata;
  /** AGENT.md 文件路径 */
  filePath: string;
  /** 空间专属人设/业务提示词（去除 frontmatter 后的正文） */
  persona: string;
}

/** 智能体空间加载配置 */
export interface AgentSpaceLoadConfig {
  /** 空间配置根目录，每个子目录一个空间（子目录名 = key），需包含 AGENT.md */
  dir: string;
  /** 未指定/未找到对应空间时使用的兜底空间 key */
  defaultKey: string;
}
