/** Skill 元数据（遵循 agentskills.io 规范） */
export interface SkillMetadata {
  /** 技能名称 */
  name: string;
  /** 技能描述 */
  description: string;
}

/** Skill 条目 */
export interface SkillEntry {
  /** 技能元数据 */
  metadata: SkillMetadata;
  /** SKILL.md 文件路径 */
  filePath: string;
  /** 技能目录路径 */
  baseDir: string;
  /** SKILL.md 内容 */
  content: string;
}

/** Skill 快照（用于提示词） */
export interface SkillSnapshot {
  /** 技能提示词 */
  prompt: string;
  /** 技能列表 */
  skills: Array<{
    name: string;
    description: string;
  }>;
}

/** Skill 配置 */
export interface SkillConfig {
  /** 是否启用 */
  enabled?: boolean;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 自定义配置 */
  config?: Record<string, any>;
}

/** Skills 加载配置 */
export interface SkillsLoadConfig {
  /** 额外的技能目录 */
  extraDirs?: string[];
  /** 内置技能目录 */
  builtinDir?: string;
  /** 工作区技能目录 */
  workspaceDir?: string;
}
