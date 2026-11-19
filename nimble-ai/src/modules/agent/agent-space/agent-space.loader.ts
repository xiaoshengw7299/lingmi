import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import {
  AgentSpaceEntry,
  AgentSpaceLoadConfig,
  AgentSpaceMetadata,
} from './agent-space.interface';

const AGENT_FILENAME = 'AGENT.md';

/** 默认智能体空间 key：请求未传 agentId / 找不到对应空间时使用（当前唯一的空间：视频制作） */
export const DEFAULT_AGENT_KEY = 'video-producer';

/**
 * 智能体空间加载器
 *
 * 设计上完全参照 SkillLoader：从目录加载 AGENT.md（frontmatter + 正文），
 * 每个子目录即一个"智能体空间"（一份专属系统提示词 + 可选默认模型）。
 * 空间只负责"人设"，不声明工具组/技能等能力范围——那些完全由请求参数决定。
 * 请求方通过 agentId 选择空间；找不到时回退到 defaultKey 对应的默认空间（视频制作）。
 */
@Injectable()
export class AgentSpaceLoader {
  private readonly logger = new Logger(AgentSpaceLoader.name);
  private readonly spaces = new Map<string, AgentSpaceEntry>();
  private defaultKey = DEFAULT_AGENT_KEY;

  /** 从目录加载所有智能体空间 */
  loadAll(config: AgentSpaceLoadConfig): AgentSpaceEntry[] {
    this.defaultKey = config.defaultKey;
    this.spaces.clear();

    if (!fs.existsSync(config.dir)) {
      this.logger.warn(`Agent space directory not found: ${config.dir}`);
      return [];
    }

    const entries = fs.readdirSync(config.dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const spaceDir = path.join(config.dir, entry.name);
      const agentFile = path.join(spaceDir, AGENT_FILENAME);
      if (!fs.existsSync(agentFile)) continue;

      try {
        const raw = fs.readFileSync(agentFile, 'utf-8').replace(/\r\n/g, '\n');
        const metadata = this.parseFrontmatter(raw, entry.name);
        const persona = this.stripFrontmatter(raw);

        this.spaces.set(metadata.key, { metadata, filePath: agentFile, persona });
        this.logger.debug(`Loaded agent space: ${metadata.key} (${metadata.name})`);
      } catch (error) {
        this.logger.warn(`Failed to load agent space: ${entry.name}`, error);
      }
    }

    if (!this.spaces.has(this.defaultKey)) {
      this.logger.warn(
        `Default agent space "${this.defaultKey}" not found (expected ai/agents/${this.defaultKey}/AGENT.md)`,
      );
    }

    this.logger.log(`Loaded ${this.spaces.size} agent space(s)`);
    return Array.from(this.spaces.values());
  }

  /** 按 key 精确获取 */
  get(key: string): AgentSpaceEntry | undefined {
    return this.spaces.get(key);
  }

  /** 获取全部空间 */
  getAll(): AgentSpaceEntry[] {
    return Array.from(this.spaces.values());
  }

  /**
   * 解析请求的 agentId 对应的智能体空间
   * 找不到（未传/无匹配配置）时回退到默认空间；默认空间也缺失时返回 undefined（仅缺少人设，底座提示词照常工作）
   */
  resolve(agentId?: string): AgentSpaceEntry | undefined {
    if (agentId && this.spaces.has(agentId)) return this.spaces.get(agentId);
    return this.spaces.get(this.defaultKey);
  }

  // ─── frontmatter 解析 ────────────────────────────────────────

  private parseFrontmatter(content: string, dirName: string): AgentSpaceMetadata {
    const metadata: AgentSpaceMetadata = { key: dirName, name: dirName };
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return metadata;

    const lines = match[1].split('\n');
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1 || /^\s/.test(line)) continue;

      const key = line.slice(0, colonIndex).trim();
      const value = this.unquote(line.slice(colonIndex + 1).trim());
      if (!value) continue;

      switch (key) {
        case 'key':
          metadata.key = value;
          break;
        case 'name':
          metadata.name = value;
          break;
        case 'model':
          metadata.model = value;
          break;
      }
    }

    return metadata;
  }

  private unquote(value: string): string {
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }
    return value;
  }

  private stripFrontmatter(content: string): string {
    return content.replace(/^---\n[\s\S]*?\n---\n*/, '').trim();
  }
}
