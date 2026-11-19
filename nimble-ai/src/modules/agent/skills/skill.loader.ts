import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { personalDataDir } from '../user-data.util';
import {
  SkillEntry,
  SkillMetadata,
  SkillSnapshot,
  SkillsLoadConfig,
} from './skill.interface';

const SKILL_FILENAME = 'SKILL.md';
/** 用户专属技能在其个人目录下的子目录名 */
const PERSONAL_SKILLS_SUBDIR = 'skills';

/**
 * Skill 加载器
 *
 * 两层技能库：
 *   全局技能 —— 人工维护，启动时加载进 `skills` 缓存，所有用户共享
 *   用户专属技能 —— 由 skill_manage 工具在对话中创建/修改，存于
 *     `ai/_users/<userId>/skills/`，只对该用户生效，每次请求实时读取
 *     （不缓存，创建/修改后下一轮即可用）
 */
@Injectable()
export class SkillLoader {
  private readonly logger = new Logger(SkillLoader.name);
  private readonly skills = new Map<string, SkillEntry>();
  /** 用户自学数据根目录（与 MemoryService 共用同一布局，见 user-data.util.ts） */
  private readonly usersRoot: string;

  constructor(configService: ConfigService) {
    this.usersRoot = configService.get<string>(
      'AGENT_USER_DATA_DIR',
      path.join(process.cwd(), 'ai', '_users'),
    );
  }

  /** 从目录加载所有技能 */
  loadFromDirectory(dir: string, source: string = 'custom'): SkillEntry[] {
    if (!fs.existsSync(dir)) {
      this.logger.debug(`Skill directory not found: ${dir}`);
      return [];
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const loaded: SkillEntry[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = path.join(dir, entry.name);
      const skillFile = path.join(skillDir, SKILL_FILENAME);

      if (!fs.existsSync(skillFile)) continue;

      try {
        const rawContent = fs.readFileSync(skillFile, 'utf-8');
        // 规范化换行符
        const content = rawContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const metadata = this.parseFrontmatter(content);

        if (!metadata.name) {
          metadata.name = entry.name;
        }

        const skillEntry: SkillEntry = {
          metadata,
          filePath: skillFile,
          baseDir: skillDir,
          content: this.stripFrontmatter(content),
        };

        loaded.push(skillEntry);
        this.logger.debug(`Loaded skill: ${metadata.name} from ${source}`);
      } catch (error) {
        this.logger.warn(`Failed to load skill: ${entry.name}`, error);
      }
    }

    return loaded;
  }

  /** 加载所有配置的技能目录 */
  loadAll(config: SkillsLoadConfig): SkillEntry[] {
    const allSkills = new Map<string, SkillEntry>();

    // 加载内置技能（最低优先级）
    if (config.builtinDir) {
      const builtinSkills = this.loadFromDirectory(config.builtinDir, 'builtin');
      for (const skill of builtinSkills) {
        allSkills.set(skill.metadata.name, skill);
      }
    }

    // 加载额外目录技能
    for (const dir of config.extraDirs || []) {
      const extraSkills = this.loadFromDirectory(dir, 'extra');
      for (const skill of extraSkills) {
        allSkills.set(skill.metadata.name, skill);
      }
    }

    // 加载工作区技能（最高优先级）
    if (config.workspaceDir) {
      const workspaceSkills = this.loadFromDirectory(
        config.workspaceDir,
        'workspace',
      );
      for (const skill of workspaceSkills) {
        allSkills.set(skill.metadata.name, skill);
      }
    }

    // 更新缓存
    this.skills.clear();
    for (const [name, skill] of allSkills) {
      this.skills.set(name, skill);
    }

    this.logger.log(`Loaded ${allSkills.size} skills`);
    return Array.from(allSkills.values());
  }

  /** 获取技能 */
  get(name: string): SkillEntry | undefined {
    return this.skills.get(name);
  }

  /** 获取所有技能 */
  getAll(): SkillEntry[] {
    return Array.from(this.skills.values());
  }

  /** 获取指定名称的技能 */
  getByNames(names: string[]): SkillEntry[] {
    return names
      .map((name) => this.skills.get(name))
      .filter((skill): skill is SkillEntry => skill !== undefined);
  }

  /**
   * 构建技能提示词
   * 遵循 agentskills.io 官方规范格式
   * @see https://agentskills.io/integrate-skills
   */
  buildPrompt(skills?: SkillEntry[]): string {
    const skillList = skills || this.getAll();
    if (skillList.length === 0) return '';

    const lines = ['<available_skills>'];

    for (const skill of skillList) {
      lines.push(
        '  <skill>',
        `    <name>${skill.metadata.name}</name>`,
        `    <description>${skill.metadata.description}</description>`,
        `    <location>${skill.filePath}</location>`,
        '  </skill>',
      );
    }

    lines.push('</available_skills>');
    return lines.join('\n');
  }

  /** 构建技能快照 */
  buildSnapshot(filter?: string[]): SkillSnapshot {
    const skills = filter ? this.getByNames(filter) : this.getAll();
    return {
      prompt: this.buildPrompt(skills),
      skills: skills.map((s) => ({
        name: s.metadata.name,
        description: s.metadata.description,
      })),
    };
  }

  /**
   * 用户专属技能目录：`ai/_users/<userId>/skills/`，由 skill_manage 工具写入
   *
   * userId 来自请求方，personalDataDir() 已做路径穿越净化。
   */
  personalSkillsDir(userId: string): string {
    return personalDataDir(this.usersRoot, userId, PERSONAL_SKILLS_SUBDIR);
  }

  /**
   * 构建某个用户可见的技能快照 = 全局共享技能 + 该用户自学的专属技能
   *
   * 专属技能不进全局缓存（实时读盘，随写随生效），同名时覆盖全局技能——
   * 允许用户在不影响他人的前提下为自己"修正"一份专属版本。
   */
  buildSnapshotForUser(userId: string, filter?: string[]): SkillSnapshot {
    const merged = new Map<string, SkillEntry>();
    for (const skill of this.getAll()) merged.set(skill.metadata.name, skill);
    for (const skill of this.loadFromDirectory(this.personalSkillsDir(userId), 'personal')) {
      merged.set(skill.metadata.name, skill);
    }

    const skills = filter
      ? filter.map((name) => merged.get(name)).filter((s): s is SkillEntry => !!s)
      : Array.from(merged.values());

    return {
      prompt: this.buildPrompt(skills),
      skills: skills.map((s) => ({ name: s.metadata.name, description: s.metadata.description })),
    };
  }

  /**
   * 校验 SKILL.md 内容是否具备合法 frontmatter（name + description + 正文）
   * 供 skill_manage 工具在写盘前校验，返回错误信息或 null（合法）
   *
   * 错误信息用英文——会作为 skill_manage 工具结果直接返回给模型
   */
  validateSkillContent(content: string): string | null {
    if (!content.trim()) return 'SKILL.md content cannot be empty.';
    if (!content.startsWith('---')) return 'SKILL.md must start with YAML frontmatter (---).';
    const metadata = this.parseFrontmatter(content);
    if (!metadata.name) return "Frontmatter is missing the 'name' field.";
    if (!metadata.description) return "Frontmatter is missing the 'description' field.";
    if (!this.stripFrontmatter(content)) {
      return 'SKILL.md must have content after the frontmatter (usage scenario, steps, etc.).';
    }
    return null;
  }

  /**
   * 解析 YAML frontmatter
   * 仅提取 name 和 description（遵循 agentskills.io 规范）
   */
  private parseFrontmatter(content: string): SkillMetadata {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      return { name: '', description: '' };
    }

    const yaml = match[1];
    const metadata: SkillMetadata = { name: '', description: '' };

    // 简单的 YAML 解析，仅提取 name 和 description
    const lines = yaml.split('\n');
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.substring(0, colonIndex).trim();
      let value = line.substring(colonIndex + 1).trim();

      // 移除引号
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (key === 'name') {
        metadata.name = value;
      } else if (key === 'description') {
        metadata.description = value;
      }
    }

    return metadata;
  }

  /** 去除 frontmatter */
  private stripFrontmatter(content: string): string {
    return content.replace(/^---\n[\s\S]*?\n---\n*/, '').trim();
  }
}
