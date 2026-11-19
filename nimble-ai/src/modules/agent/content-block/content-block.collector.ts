import {
  ContentBlock,
  TextBlock,
  ThinkBlock,
  ProcessBlock,
} from './content-block.interface';

/** 流式内容解析事件 */
export interface StreamParseEvent {
  type: 'text' | 'think';
  content: string;
}

/**
 * Content Block Collector
 *
 * 在一轮对话中收集结构化内容块。
 *
 * 核心能力：
 * 1. 流式解析 <think> 标签，分离 text / think
 * 2. 记录通用进度 process 块
 * 3. 接收工具返回的任意 ContentBlock（bi / 未来类型），类型无感知
 * 4. 最终输出有序 blocks 数组供持久化和回放
 *
 * @example 流式用法
 *   const c = new ContentBlockCollector();
 *   c.processContentDelta(delta);     // → StreamParseEvent[]
 *   c.addProcess('正在生成分镜脚本...');
 *   c.addBlocks([biBlock]);
 *   const blocks = c.finalize();
 *
 * @example 非流式用法
 *   const c = new ContentBlockCollector();
 *   c.addProcess('正在生成分镜脚本...');
 *   c.addBlocks([biBlock]);
 *   c.addParsedContent(responseContent);
 *   const blocks = c.finalize();
 */
export class ContentBlockCollector {
  private blocks: ContentBlock[] = [];
  private inThink = false;
  private textBuf = '';
  private thinkBuf = '';
  private tagBuf = '';
  private processIdCounter = 0;

  // ═══════════════════════════════════════════════════════════
  //  流式内容解析
  // ═══════════════════════════════════════════════════════════

  /** 喂入流式 content delta，返回 SSE 可用的事件列表 */
  processContentDelta(delta: string): StreamParseEvent[] {
    const events: StreamParseEvent[] = [];
    let input = this.tagBuf + delta;
    this.tagBuf = '';

    while (input.length > 0) {
      input = this.inThink
        ? this.parseThink(input, events)
        : this.parseNormal(input, events);
    }
    return events;
  }

  // ═══════════════════════════════════════════════════════════
  //  进度 / BI / 外部块
  // ═══════════════════════════════════════════════════════════

  /** 添加进度提示块（初始状态为 running，自动分配唯一 id） */
  addProcess(content: string): ProcessBlock {
    this.flushText();
    const block: ProcessBlock = {
      type: 'process',
      id: `proc_${++this.processIdCounter}`,
      content,
      status: 'running',
    };
    this.blocks.push(block);
    return block;
  }

  /** 添加外部内容块（BI 组件等） */
  addBlocks(blocks: ContentBlock[]): void {
    if (blocks?.length) {
      this.blocks.push(...blocks);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  非流式内容
  // ═══════════════════════════════════════════════════════════

  /** 解析完整响应文本为 blocks（非流式路径） */
  addParsedContent(content: string): void {
    const parsed = ContentBlockCollector.parseContent(content);
    this.blocks.push(...parsed);
  }

  // ═══════════════════════════════════════════════════════════
  //  结束 & 输出
  // ═══════════════════════════════════════════════════════════

  /** 冲刷缓冲区，返回全部 blocks */
  finalize(): ContentBlock[] {
    if (this.tagBuf) {
      if (this.inThink) {
        this.thinkBuf += this.tagBuf;
      } else {
        this.textBuf += this.tagBuf;
      }
      this.tagBuf = '';
    }
    this.flushText();
    this.flushThink();

    // 合并多个 think 块为一个（多轮迭代可能产生多个 reasoning 块）
    const thinkBlocks = this.blocks.filter((b): b is ThinkBlock => b.type === 'think');
    if (thinkBlocks.length > 1) {
      const merged: ThinkBlock = {
        type: 'think',
        content: thinkBlocks.map((b) => b.content).join('\n\n'),
      };
      this.blocks = [merged, ...this.blocks.filter((b) => b.type !== 'think')];
    }

    return [...this.blocks];
  }

  /** 获取纯文本内容（仅 text 块拼接） */
  getTextContent(): string {
    return this.blocks
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.content)
      .join('');
  }

  // ═══════════════════════════════════════════════════════════
  //  静态工具方法
  // ═══════════════════════════════════════════════════════════

  /** 从 blocks 数组中提取纯文本（用于 LLM 上下文等场景） */
  static toText(blocks: ContentBlock[]): string {
    if (!blocks?.length) return '';
    return blocks
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.content)
      .join('');
  }

  /** 解析完整文本为 text/think 块（提取 <think> 标签） */
  static parseContent(content: string): ContentBlock[] {
    if (!content) return [];

    const blocks: ContentBlock[] = [];
    const regex = /<think>([\s\S]*?)<\/think>/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const before = content.substring(lastIdx, match.index);
      if (before.trim()) blocks.push({ type: 'text', content: before });
      if (match[1].trim()) blocks.push({ type: 'think', content: match[1] });
      lastIdx = match.index + match[0].length;
    }

    const rest = content.substring(lastIdx);
    if (rest.trim()) blocks.push({ type: 'text', content: rest });

    return blocks;
  }

  // ─── 内部实现 ──────────────────────────────────────────────

  private parseNormal(input: string, events: StreamParseEvent[]): string {
    const idx = input.indexOf('<think>');
    if (idx !== -1) {
      const before = input.substring(0, idx);
      if (before) { this.textBuf += before; events.push({ type: 'text', content: before }); }
      this.flushText();
      this.inThink = true;
      return input.substring(idx + 7);
    }
    const p = this.matchPartial(input, '<think>');
    if (p > 0) {
      const text = input.substring(0, input.length - p);
      if (text) { this.textBuf += text; events.push({ type: 'text', content: text }); }
      this.tagBuf = input.substring(input.length - p);
    } else {
      this.textBuf += input;
      events.push({ type: 'text', content: input });
    }
    return '';
  }

  private parseThink(input: string, events: StreamParseEvent[]): string {
    const idx = input.indexOf('</think>');
    if (idx !== -1) {
      const before = input.substring(0, idx);
      if (before) { this.thinkBuf += before; events.push({ type: 'think', content: before }); }
      this.flushThink();
      this.inThink = false;
      return input.substring(idx + 8);
    }
    const p = this.matchPartial(input, '</think>');
    if (p > 0) {
      const think = input.substring(0, input.length - p);
      if (think) { this.thinkBuf += think; events.push({ type: 'think', content: think }); }
      this.tagBuf = input.substring(input.length - p);
    } else {
      this.thinkBuf += input;
      events.push({ type: 'think', content: input });
    }
    return '';
  }

  private matchPartial(input: string, tag: string): number {
    const max = Math.min(tag.length - 1, input.length);
    for (let len = max; len > 0; len--) {
      if (input.endsWith(tag.substring(0, len))) return len;
    }
    return 0;
  }

  private flushText(): void {
    if (this.textBuf.trim()) {
      this.blocks.push({ type: 'text', content: this.textBuf });
    }
    this.textBuf = '';
  }

  private flushThink(): void {
    if (this.thinkBuf.trim()) {
      this.blocks.push({ type: 'think', content: this.thinkBuf });
    }
    this.thinkBuf = '';
  }
}
