import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { personalDataDir } from '../user-data.util';

/** 记忆分区：memory=智能体自己的笔记（环境/经验），user=用户画像（偏好/习惯） */
export type MemoryTarget = 'memory' | 'user';

/** 单次记忆操作的结果（供工具层直接序列化返回给模型） */
export interface MemoryOpResult {
  success: boolean;
  message: string;
  /** 当前用量提示，如 "12% — 260/2200 chars, 3 entries" */
  usage?: string;
  /** 仅在失败（未匹配/超限）时附带，供模型据此重试 */
  entries?: string[];
}

/** 系统提示词注入用的快照 */
export interface MemorySnapshot {
  memoryText: string;
  userText: string;
}

/** 渲染进系统提示词的分区标题——英文措辞对齐 hermes-agent 的 MEMORY_BLOCK_HEADERS */
const TARGET_LABEL: Record<MemoryTarget, string> = {
  memory: 'MEMORY (agent notes — environment facts, conventions, lessons learned)',
  user: 'USER PROFILE (who the user is — preferences, habits, identity)',
};

const TARGET_FILENAME: Record<MemoryTarget, string> = {
  memory: 'MEMORY.md',
  user: 'USER.md',
};

/** 记忆在用户个人目录下的子目录名 */
const PERSONAL_MEMORY_SUBDIR = 'memory';

/** 条目分隔符：允许条目内容本身包含换行，纯 \n 无法安全切分多行条目 */
const ENTRY_DELIMITER = '\n§\n';

/**
 * 轻量的进程内按 key 互斥锁
 *
 * nimble-ai 单进程部署（pm2 fork, instances=1），不存在跨进程/跨实例并发写同一
 * 记忆文件的场景，因此无需 hermes 那套跨进程文件锁（fcntl/msvcrt）——按
 * `userId:target` 串行化同一文件的读-改-写即可保证安全。
 */
class KeyedMutex {
  private tail = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tail.get(key) ?? Promise.resolve();
    const result = previous.then(fn, fn);
    this.tail.set(key, result.catch(() => undefined));
    return result;
  }
}

/**
 * 持久记忆服务 —— 按用户隔离的长期记忆存取（文件存储）
 *
 * 目录结构与技能自学（skill_manage）共用同一套用户数据布局（见 user-data.util.ts）：
 *   `ai/_users/<userId>/memory/MEMORY.md`  智能体笔记
 *   `ai/_users/<userId>/memory/USER.md`    用户画像
 *
 * 写入走字符预算：单分区总字数超过上限时拒绝写入并返回当前条目，
 * 由模型自行判断精简（replace/remove 旧条目）后重试，而不是无限增长。
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private readonly usersRoot: string;
  private readonly charLimits: Record<MemoryTarget, number>;
  private readonly mutex = new KeyedMutex();

  constructor(configService: ConfigService) {
    this.usersRoot = configService.get<string>(
      'AGENT_USER_DATA_DIR',
      path.join(process.cwd(), 'ai', '_users'),
    );
    this.charLimits = {
      memory: Number(configService.get('AGENT_MEMORY_CHAR_LIMIT', '2200')) || 2200,
      user: Number(configService.get('AGENT_USER_PROFILE_CHAR_LIMIT', '1375')) || 1375,
    };
  }

  /** 供 System Prompt 注入的当前用户记忆快照，两个分区均为空时返回空字符串 */
  async getSnapshot(userId: string): Promise<MemorySnapshot> {
    return {
      memoryText: this.renderBlock('memory', this.readEntries(userId, 'memory')),
      userText: this.renderBlock('user', this.readEntries(userId, 'user')),
    };
  }

  add(userId: string, target: MemoryTarget, content: string): Promise<MemoryOpResult> {
    return this.mutex.run(this.lockKey(userId, target), async () => {
      const trimmed = content?.trim();
      if (!trimmed) return { success: false, message: 'Content cannot be empty.' };

      const entries = this.readEntries(userId, target);
      if (entries.includes(trimmed)) {
        const msg = 'Entry already exists (no duplicate added).';
        return this.usageResult(target, entries.length, this.totalChars(entries), msg);
      }

      const projected = this.totalChars(entries) + trimmed.length;
      if (projected > this.charLimits[target]) {
        return this.overBudgetResult(target, entries, trimmed.length);
      }

      const next = [...entries, trimmed];
      this.writeEntries(userId, target, next);
      return this.usageResult(target, next.length, projected, 'Entry added.');
    });
  }

  replace(userId: string, target: MemoryTarget, oldText: string, content: string): Promise<MemoryOpResult> {
    return this.mutex.run(this.lockKey(userId, target), async () => {
      const newContent = content?.trim();
      if (!oldText?.trim()) return { success: false, message: 'old_text cannot be empty.' };
      if (!newContent) return { success: false, message: "content cannot be empty. Use 'remove' to delete entries." };

      const entries = this.readEntries(userId, target);
      const match = this.findUniqueMatch(entries, oldText);
      if ('error' in match) return match.error;

      const others = entries.filter((_, i) => i !== match.index);
      const projected = this.totalChars(others) + newContent.length;
      if (projected > this.charLimits[target]) {
        return this.overBudgetResult(target, others, newContent.length);
      }

      const next = entries.map((e, i) => (i === match.index ? newContent : e));
      this.writeEntries(userId, target, next);
      return this.usageResult(target, next.length, projected, 'Entry replaced.');
    });
  }

  remove(userId: string, target: MemoryTarget, oldText: string): Promise<MemoryOpResult> {
    return this.mutex.run(this.lockKey(userId, target), async () => {
      if (!oldText?.trim()) return { success: false, message: 'old_text cannot be empty.' };

      const entries = this.readEntries(userId, target);
      const match = this.findUniqueMatch(entries, oldText);
      if ('error' in match) return match.error;

      const next = entries.filter((_, i) => i !== match.index);
      this.writeEntries(userId, target, next);
      return this.usageResult(target, next.length, this.totalChars(next), 'Entry removed.');
    });
  }

  // ─── 内部辅助 ─────────────────────────────────────────────────

  private lockKey(userId: string, target: MemoryTarget): string {
    return `${userId}:${target}`;
  }

  private filePath(userId: string, target: MemoryTarget): string {
    const dir = personalDataDir(this.usersRoot, userId, PERSONAL_MEMORY_SUBDIR);
    return path.join(dir, TARGET_FILENAME[target]);
  }

  private readEntries(userId: string, target: MemoryTarget): string[] {
    const file = this.filePath(userId, target);
    if (!fs.existsSync(file)) return [];
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      if (!raw.trim()) return [];
      return raw.split(ENTRY_DELIMITER).map((e) => e.trim()).filter(Boolean);
    } catch (error) {
      this.logger.warn(`读取记忆文件失败: ${file}`, error instanceof Error ? error.stack : String(error));
      return [];
    }
  }

  /** 原子写入（临时文件 + rename），避免进程崩溃时留下半写文件 */
  private writeEntries(userId: string, target: MemoryTarget, entries: string[]): void {
    const file = this.filePath(userId, target);
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });

    const content = entries.join(ENTRY_DELIMITER);
    const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, file);
  }

  private totalChars(entries: string[]): number {
    return entries.reduce((sum, e) => sum + e.length, 0);
  }

  /** 按子串查找唯一匹配的条目；零匹配或多个不同条目匹配时返回可供模型重试的错误 */
  private findUniqueMatch(
    entries: string[],
    oldText: string,
  ): { index: number } | { error: MemoryOpResult } {
    const needle = oldText.trim();
    const matchIndexes = entries.reduce<number[]>((acc, e, i) => (e.includes(needle) ? [...acc, i] : acc), []);

    if (matchIndexes.length === 0) {
      return {
        error: {
          success: false,
          message: `No entry matched "${oldText}". Check entries below and retry with the exact text of the entry you want to modify.`,
          entries,
        },
      };
    }
    const distinct = new Set(matchIndexes.map((i) => entries[i]));
    if (distinct.size > 1) {
      return {
        error: {
          success: false,
          message: `Multiple entries matched "${oldText}". Be more specific.`,
          entries: matchIndexes.map((i) => entries[i]),
        },
      };
    }
    return { index: matchIndexes[0] };
  }

  private usageResult(target: MemoryTarget, count: number, chars: number, message: string): MemoryOpResult {
    return { success: true, message, usage: this.usageText(target, chars, count) };
  }

  private overBudgetResult(target: MemoryTarget, entries: string[], incomingLen: number): MemoryOpResult {
    const current = this.totalChars(entries);
    const limit = this.charLimits[target];
    return {
      success: false,
      message:
        `Memory at ${current}/${limit} chars. This write (${incomingLen} chars) would exceed the limit. ` +
        `Consolidate first — use replace to merge/shorten entries or remove stale ones (see entries below), then retry.`,
      entries,
    };
  }

  private usageText(target: MemoryTarget, chars: number, count: number): string {
    const limit = this.charLimits[target];
    const pct = limit > 0 ? Math.min(100, Math.round((chars / limit) * 100)) : 0;
    return `${pct}% — ${chars}/${limit} chars, ${count} entries`;
  }

  private renderBlock(target: MemoryTarget, entries: string[]): string {
    if (!entries.length) return '';
    const chars = this.totalChars(entries);
    const limit = this.charLimits[target];
    const pct = limit > 0 ? Math.min(100, Math.round((chars / limit) * 100)) : 0;
    const header = `${TARGET_LABEL[target]} [${pct}% — ${chars}/${limit} chars]`;
    const body = entries.map((e, i) => `${i + 1}. ${e}`).join('\n');
    return `${header}\n${body}`;
  }
}
