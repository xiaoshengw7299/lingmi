import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable, Subject } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { ToolLoopAgent, isStepCount, generateText } from 'ai';
import { randomUUID } from 'crypto';
import * as path from 'path';

import { SessionEntity } from './entities/session.entity';
import { MessageEntity } from './entities/message.entity';
import { ModelPolicyService } from './providers';
import { AtlasLlmService } from '../atlas/atlas-llm.service';
import { ToolRegistry } from './tools/tool.registry';
import { ToolExecuteCtx, ToolResult } from './tools/tool.define';
import { SkillLoader } from './skills/skill.loader';
import { AgentSpaceLoader, DEFAULT_AGENT_KEY } from './agent-space';
import { SystemPromptBuilder } from './prompt/system-prompt.builder';
import { AILoggerService, AiLogContext } from './logger/ai-logger.service';
import { MemoryService } from './memory';
import { ChatRequest, SSEEventData } from './dto/chat.dto';
import { RedisService } from '../redis/redis.service';
import { VideoService } from '../video/video.service';
import { ContentBlock, ProcessBlock } from './content-block/content-block.interface';
import { ContentBlockCollector } from './content-block/content-block.collector';
import { TEXT_DOC_EXTS, BINARY_DOC_EXTS, userUploadsDir, extractFileContent, resolveWithin } from './file-content.util';

/** 发起请求的用户（会话归属校验用） */
export interface SessionActor {
  userId: string;
  isAdmin: boolean;
}

/** 会话上下文缓存（只存对话历史，不含 system/instructions，见 buildChatContext 说明） */
interface SessionContext {
  messages: any[];
  model: string;
  lastActiveAt: Date;
}

/** 单次请求解析出的完整对话上下文 */
interface ChatContext {
  messages: any[];
  model: string;
  /** 系统提示词（底座 + 智能体空间人设），AI SDK v7 顶层 instructions，不再拼进 messages */
  instructions: string;
  /** 本次请求实际生效的可选工具组（不传 = 默认全部，传了才限定，与智能体空间无关） */
  toolGroups?: string[];
}

/** 对话循环返回 */
interface ConversationResult {
  blocks: ContentBlock[];
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/**
 * 工具调用去重器
 *
 * 两层机制：
 *   1. resultCache  —— 同参数重复调用直接返回缓存结果
 *   2. processBlocks —— 每个唯一调用对应一个进度块（失败后重试时复用）
 */
interface ToolCallDedup {
  resultCache: Map<string, { contextText: string; blocks: ContentBlock[] }>;
  processBlocks: Map<string, ProcessBlock>;
}

/**
 * Agent 核心服务
 *
 * LLM 调用统一通过 `ToolLoopAgent`（AI SDK v7 agent 抽象）封装 model/instructions/
 * tools/stopWhen，流式与非流式路径分别调用其 `.stream()` / `.generate()`，避免手写
 * 两套重复的循环逻辑。
 *
 * 请求的 agentId 通过 AgentSpaceLoader 解析出对应"智能体空间"（专属人设 + 可选默认模型），
 * 叠加在底座系统提示词之上；工具组/技能范围与智能体空间无关，完全由请求参数 toolGroups/skills 决定。
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly workspaceDir: string;
  private readonly skillsDir: string;
  private readonly sessionContextTTL = 3600;
  /** 历史上下文窗口上限（消息条数，非 DB 行数），DB 冷加载与缓存读写统一按此裁剪，避免长会话上下文无限增长 */
  private readonly maxHistoryMessages: number;
  private static readonly DEFAULT_MAX_STEPS = 10;
  /** 自动注入上下文的附件内容摘要上限（字符数），超出部分提示模型改用 read 工具查看全文 */
  private static readonly FILE_EXCERPT_MAX_CHARS = 4000;

  constructor(
    @InjectRepository(SessionEntity)
    private readonly sessionRepo: Repository<SessionEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    private readonly atlasLlm: AtlasLlmService,
    private readonly modelPolicy: ModelPolicyService,
    private readonly toolRegistry: ToolRegistry,
    private readonly skillLoader: SkillLoader,
    private readonly agentSpaceLoader: AgentSpaceLoader,
    private readonly promptBuilder: SystemPromptBuilder,
    private readonly aiLogger: AILoggerService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly memoryService: MemoryService,
    private readonly videoService: VideoService,
  ) {
    this.workspaceDir = this.configService.get<string>(
      'AGENT_WORKSPACE_DIR',
      path.join(process.cwd(), 'workspace'),
    );
    this.skillsDir = this.configService.get<string>(
      'SKILLS_DIR',
      path.join(process.cwd(), 'ai', 'skills'),
    );
    this.maxHistoryMessages =
      Number(this.configService.get<string>('AGENT_MAX_HISTORY_MESSAGES', '50')) || 50;
  }

  // ═══════════════════════════════════════════════════════════
  //  Public API
  // ═══════════════════════════════════════════════════════════

  chatStream(request: ChatRequest, abortSignal?: AbortSignal): Observable<SSEEventData> {
    const subject = new Subject<SSEEventData>();
    const requestId = randomUUID();
    this.processChatStream(requestId, request, subject, abortSignal).catch((error) => {
      this.logger.error('Chat stream error', error instanceof Error ? error.stack : String(error));
      subject.next({ type: 'error', requestId, error: error instanceof Error ? error.message : String(error) });
      subject.complete();
    });
    return subject.asObservable();
  }

  async chat(request: ChatRequest): Promise<{
    sessionId: string;
    messageId: string;
    blocks: ContentBlock[];
    model: string;
    tokenUsage?: any;
    latencyMs: number;
    title?: string;
    requestId: string;
  }> {
    const requestId = randomUUID();
    const { session, context, logCtx, startTime } = await this.prepareChat(requestId, request);

    try {
      const result = await this.runConversationLoop(logCtx, context, request);
      const latencyMs = Date.now() - startTime;
      const message = await this.saveMessage(session, request.input, {
        model: context.model, tokenUsage: result.tokenUsage, latencyMs,
        blocks: result.blocks, files: request.files,
      });

      await this.finalizeChat(session, context, request.input);
      return {
        sessionId: session.id, messageId: message.id,
        blocks: result.blocks, model: context.model,
        tokenUsage: result.tokenUsage, latencyMs, title: session.title, requestId,
      };
    } catch (error) {
      this.aiLogger.logError(logCtx, 'chat', error);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Stream Processing
  // ═══════════════════════════════════════════════════════════

  private async processChatStream(
    requestId: string,
    request: ChatRequest,
    subject: Subject<SSEEventData>,
    abortSignal?: AbortSignal,
  ) {
    const { session, context, logCtx, startTime } = await this.prepareChat(requestId, request);
    subject.next({ type: 'start', sessionId: session.id, requestId });

    try {
      const result = await this.runStreamConversationLoop(logCtx, context, request, subject, undefined, abortSignal);
      const latencyMs = Date.now() - startTime;
      const message = await this.saveMessage(session, request.input, {
        model: context.model, tokenUsage: result.tokenUsage, latencyMs,
        blocks: result.blocks, files: request.files,
      });

      await this.finalizeChat(session, context, request.input);
      subject.next({
        type: 'done', sessionId: session.id, requestId, messageId: message.id,
        blocks: result.blocks, tokenUsage: result.tokenUsage, title: session.title,
      });
      subject.complete();
    } catch (error) {
      this.aiLogger.logError(logCtx, 'chatStream', error);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Conversation Loops（统一通过 ToolLoopAgent 封装）
  // ═══════════════════════════════════════════════════════════

  private async runStreamConversationLoop(
    logCtx: AiLogContext,
    context: ChatContext,
    request: ChatRequest,
    subject: Subject<SSEEventData>,
    maxSteps = AgentService.DEFAULT_MAX_STEPS,
    abortSignal?: AbortSignal,
  ): Promise<ConversationResult> {
    const collector = new ContentBlockCollector();
    const dedup: ToolCallDedup = { resultCache: new Map(), processBlocks: new Map() };
    const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const onBlock = (block: ContentBlock) => subject.next({ type: 'block', sessionId: logCtx.sessionId, block });

    const ctx = this.buildToolCtx(logCtx.sessionId, request);
    const agent = this.buildAgent(
      logCtx, context, request, maxSteps, totalUsage,
      (name, showProgress, args) => this.executeToolWithDedup(name, showProgress, args, ctx, collector, dedup, onBlock),
    );

    const result = await agent.stream({ messages: context.messages, abortSignal });

    let reasoningBuf = '';
    for await (const chunk of result.stream) {
      if (chunk.type === 'text-delta') {
        for (const evt of collector.processContentDelta(chunk.text)) {
          subject.next({ type: evt.type, sessionId: logCtx.sessionId, content: evt.content });
        }
      } else if (chunk.type === 'reasoning-delta') {
        reasoningBuf += chunk.text;
        subject.next({ type: 'think', sessionId: logCtx.sessionId, content: chunk.text });
      } else if (chunk.type === 'raw') {
        // Atlas OpenAI 兼容通道不一定产出 reasoning-delta，从 raw chunk 兜底抽取思考内容。
        const delta = (chunk.rawValue as any)?.choices?.[0]?.delta;
        const rc = delta?.reasoning_content ?? delta?.reasoning;
        if (rc) {
          reasoningBuf += rc;
          subject.next({ type: 'think', sessionId: logCtx.sessionId, content: rc });
        }
      } else if (chunk.type === 'error') {
        throw chunk.error instanceof Error ? chunk.error : new Error(String(chunk.error));
      }
    }

    if (reasoningBuf) {
      collector.addBlocks([{ type: 'think', content: reasoningBuf }]);
    }

    for (const [, block] of dedup.processBlocks) {
      if (block.status === 'running') {
        block.status = 'done';
        subject.next({ type: 'block', sessionId: logCtx.sessionId, block: { ...block } });
      }
    }

    return { blocks: collector.finalize(), tokenUsage: totalUsage };
  }

  private async runConversationLoop(
    logCtx: AiLogContext,
    context: ChatContext,
    request: ChatRequest,
    maxSteps = AgentService.DEFAULT_MAX_STEPS,
  ): Promise<ConversationResult> {
    const collector = new ContentBlockCollector();
    const dedup: ToolCallDedup = { resultCache: new Map(), processBlocks: new Map() };
    const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const onBlock = (block: ContentBlock) => { if (block.type !== 'process') collector.addBlocks([block]); };

    const ctx = this.buildToolCtx(logCtx.sessionId, request);
    const agent = this.buildAgent(
      logCtx, context, request, maxSteps, totalUsage,
      (name, showProgress, args) => this.executeToolWithDedup(name, showProgress, args, ctx, collector, dedup, onBlock),
    );

    const result = await agent.generate({ messages: context.messages });

    const reasoningText = result.finalStep.reasoning?.map((r: any) => r.text).join('\n');
    if (reasoningText) collector.addBlocks([{ type: 'think', content: reasoningText }]);
    collector.addParsedContent(result.text);
    return { blocks: collector.finalize(), tokenUsage: totalUsage };
  }

  /**
   * 构建本次请求的 ToolLoopAgent：model/instructions/tools/stopWhen 一次定义，
   * `.generate()`（非流式）与 `.stream()`（流式）共用同一份配置。
   */
  private buildAgent(
    logCtx: AiLogContext,
    context: ChatContext,
    request: ChatRequest,
    maxSteps: number,
    totalUsage: { promptTokens: number; completionTokens: number; totalTokens: number },
    executeWrapper: (name: string, showProgress: boolean, args: any) => Promise<string>,
  ) {
    const tools = this.toolRegistry.buildAISDKTools({ toolGroups: context.toolGroups }, executeWrapper);

    // 显式展开 llmParams 字段，保持类型安全，避免 as any
    const { temperature, maxOutputTokens, topP, topK, frequencyPenalty, presencePenalty } = request.llmParams ?? {};

    return new ToolLoopAgent({
      model: this.atlasLlm.text(context.model),
      instructions: context.instructions,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      stopWhen: isStepCount(maxSteps),
      include: { rawChunks: true },
      ...(temperature !== undefined && { temperature }),
      ...(maxOutputTokens !== undefined && { maxOutputTokens }),
      ...(topP !== undefined && { topP }),
      ...(topK !== undefined && { topK }),
      ...(frequencyPenalty !== undefined && { frequencyPenalty }),
      ...(presencePenalty !== undefined && { presencePenalty }),
      onStepEnd: (step: any) => {
        // SDK 在工具执行完后才回调 onStepEnd；此处先写 assistant、再写 tool，保持时间序
        const toolCalls = step.toolCalls?.length
          ? step.toolCalls.map((t: any) => ({ name: t.toolName, args: t.input }))
          : undefined;
        this.aiLogger.logAssistant(logCtx, {
          step: step.stepNumber ?? 0,
          ...(step.text ? { text: step.text } : {}),
          ...(step.reasoningText ? { reasoning: step.reasoningText } : {}),
          ...(toolCalls ? { toolCalls } : {}),
        });
        // executeWrapper 已返回回传模型的 contextText，此处直接落盘
        for (const tr of step.toolResults ?? []) {
          this.aiLogger.logTool(logCtx, {
            name: tr.toolName,
            args: tr.input,
            result: typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output ?? ''),
            ok: tr.type !== 'tool-error',
          });
        }
      },
      onEnd: (event: any) => {
        totalUsage.promptTokens = event.usage.inputTokens ?? 0;
        totalUsage.completionTokens = event.usage.outputTokens ?? 0;
        totalUsage.totalTokens = (event.usage.inputTokens ?? 0) + (event.usage.outputTokens ?? 0);
        // AI SDK v7：onEnd 的 responseMessages 已是全部 step 的累积结果，直接追加回历史即可
        context.messages = [...context.messages, ...event.responseMessages];
      },
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Tool Execution
  // ═══════════════════════════════════════════════════════════

  /** 构建工具执行上下文 */
  private buildToolCtx(sessionId: string, request: ChatRequest): ToolExecuteCtx {
    return {
      sessionId,
      userId: request.userId,
      agentId: request.agentId,
      workspaceDir: this.workspaceDir,
      skillsDir: this.skillsDir,
      extra: request.extra,
      services: {},
    };
  }

  /**
   * 带去重的工具执行
   *
   * key = `toolName::argsJSON`
   *   缓存命中 → 直接返回缓存 contextText，跳过执行和 SSE 展示
   *   缓存未命中 → 展示进度块（showProgress=true）→ 执行 → 处理 BI 块 → 缓存成功结果
   *
   * 返回 string 供 AI SDK execute 函数使用
   */
  private async executeToolWithDedup(
    toolName: string,
    showProgress: boolean,
    args: Record<string, any>,
    ctx: ToolExecuteCtx,
    collector: ContentBlockCollector,
    dedup: ToolCallDedup,
    onBlock: (block: ContentBlock) => void,
  ): Promise<string> {
    const callKey = `${toolName}::${JSON.stringify(args)}`;
    const cached = dedup.resultCache.get(callKey);
    if (cached) return cached.contextText;

    let processBlock: ProcessBlock | undefined;
    if (showProgress) {
      processBlock = dedup.processBlocks.get(callKey);
      if (!processBlock) {
        processBlock = collector.addProcess(`调用工具 ${this.toolRegistry.getTitle(toolName)}`);
        dedup.processBlocks.set(callKey, processBlock);
        onBlock({ ...processBlock });
      }
    }

    const result: ToolResult = await this.toolRegistry.execute(toolName, args, ctx);
    const { contextText, blocks } = this.parseToolOutput(result.output);

    if (result.success) {
      if (processBlock) { processBlock.status = 'done'; onBlock({ ...processBlock }); }
      dedup.resultCache.set(callKey, { contextText, blocks });
      if (blocks.length) {
        collector.addBlocks(blocks);
        for (const block of blocks) onBlock(block);
      }
    } else {
      if (processBlock) { processBlock.status = 'error'; onBlock({ ...processBlock }); }
    }

    return contextText;
  }

  /**
   * 解析工具输出：检测 {content, bi} 约定
   * 命中 → content 作为 LLM 上下文，bi 转为 BiBlock 供前端渲染
   */
  private parseToolOutput(output: string): { contextText: string; blocks: ContentBlock[] } {
    if (output.includes('"bi"')) {
      try {
        const parsed = JSON.parse(output);
        if (parsed?.bi && typeof parsed.bi === 'object') {
          // BiToolSpec: { tag, data, title }（tag = BI 组件类型）
          const { tag, data, title } = parsed.bi;
          return {
            contextText: typeof parsed.content === 'string' ? parsed.content : '',
            blocks: [{ type: 'bi', tag, data, title }],
          };
        }
      } catch { /* not valid JSON */ }
    }
    return { contextText: output, blocks: [] };
  }

  // ═══════════════════════════════════════════════════════════
  //  Context & Session
  // ═══════════════════════════════════════════════════════════

  /** 公共准备逻辑：模型校验 → 创建/获取会话 → 构建上下文 → 追加用户消息 → 写入 system/user 日志 */
  private async prepareChat(requestId: string, request: ChatRequest) {
    // 未传 agentId 时统一归一化为默认空间（视频制作）
    request.agentId = request.agentId || DEFAULT_AGENT_KEY;
    request.model = this.modelPolicy.resolve(request.model);
    const startTime = Date.now();
    const session = await this.getOrCreateSession(request);
    const context = await this.buildChatContext(session, request);
    const userContent = await this.buildUserContent(request);
    context.messages.push({ role: 'user', content: userContent });

    const logCtx: AiLogContext = { requestId, sessionId: session.id };
    // 一次任务的起点：系统提示词 + 本轮用户提示词（后续只记轮次增量）
    this.aiLogger.logSystem(logCtx, context.instructions);
    this.aiLogger.logUser(logCtx, userContent);

    return { session, context, logCtx, startTime };
  }

  /** 公共收尾逻辑：更新会话 → 异步生成标题 */
  private async finalizeChat(session: SessionEntity, context: ChatContext, userInput: string) {
    await this.updateSession(session, context);
    this.generateTitleAsync(session, userInput);
  }

  private async buildUserContent(request: ChatRequest): Promise<string> {
    const parts: string[] = [];
    if (request.files?.length) {
      const descriptions = await Promise.all(request.files.map((f) => this.describeAttachment(f, request.userId)));
      parts.push(`[用户附件]\n${descriptions.join('\n')}\n`);
    }
    parts.push(request.input);
    return parts.join('\n');
  }

  /**
   * 描述单个附件：文档类文件（txt/md/pdf/docx/xlsx 等）自动提取内容摘要直接注入上下文，
   * 不再依赖模型主动调用 read 工具；图片等其它类型仍只提示路径（无法自动做视觉理解）。
   */
  private async describeAttachment(file: { filename: string; path: string }, userId: string): Promise<string> {
    // path 来自客户端：只认当前用户自己的上传目录，防止借附件读取服务器上的任意文件或别人的附件
    const absolutePath = resolveWithin([userUploadsDir(this.workspaceDir, userId)], file.path, this.workspaceDir);
    if (!absolutePath) return `- ${file.filename}（路径无效，已忽略）`;
    const ext = path.extname(file.filename).toLowerCase();
    const isDoc = TEXT_DOC_EXTS.has(ext) || BINARY_DOC_EXTS.has(ext);
    if (!isDoc) return `- ${file.filename}（路径: ${file.path}）`;

    try {
      const content = (await extractFileContent(absolutePath, ext)).trim();
      const excerpt = content.length > AgentService.FILE_EXCERPT_MAX_CHARS
        ? `${content.slice(0, AgentService.FILE_EXCERPT_MAX_CHARS)}\n……（内容较长已截断，如需完整内容可使用 read 工具读取 ${file.path}）`
        : content;
      return `- ${file.filename}（路径: ${file.path}）\n  文件内容：\n${excerpt || '（空文件）'}`;
    } catch (error) {
      this.logger.warn(`附件内容解析失败: ${file.path}`, error instanceof Error ? error.message : String(error));
      return `- ${file.filename}（路径: ${file.path}，内容自动解析失败，可尝试使用 read 工具读取）`;
    }
  }

  private async buildChatContext(session: SessionEntity, request: ChatRequest): Promise<ChatContext> {
    const space = this.agentSpaceLoader.resolve(request.agentId);
    const cacheKey = `agent:context:${session.id}`;

    // 缓存只存对话历史（不含系统提示词）：不同请求的 toolGroups/skills/智能体空间可能不同，
    // 系统提示词每次动态构建，不能跨请求复用
    const cached = await this.getCachedContext(cacheKey);
    let history: any[];
    let model: string;

    if (cached) {
      // 裁剪一次：自愈历史遗留的超窗口缓存（修复前可能已无限增长的会话）
      history = this.trimHistory(cached.messages);
      // 优先级：请求参数 > 智能体空间默认模型 > 缓存中上次用的模型
      model = this.modelPolicy.resolve(request.model || space?.metadata.model || cached.model);
    } else {
      history = await this.loadSessionHistory(session.id);
      model = this.modelPolicy.resolve(request.model || space?.metadata.model);
      await this.cacheContext(cacheKey, { messages: history, model, lastActiveAt: new Date() });
    }

    // toolGroups/skills 完全由请求参数决定，与智能体空间无关：不传 = 默认全部，传了才限定
    const toolDefs = this.toolRegistry.getForRequest(request.toolGroups);
    // 技能 = 全局共享技能库 + 该用户自学的专属技能（skill_manage 工具产出，仅对本人可见）
    const skillsPrompt = this.skillLoader.buildSnapshotForUser(request.userId, request.skills).prompt;
    // 持久记忆按 userId 隔离，每次请求取当前快照注入，工具中途写入的内容下一轮才生效（保持本轮提示词稳定）
    const memory = await this.memoryService.getSnapshot(request.userId);
    const timezone = this.configService.get<string>('AGENT_TIMEZONE', 'Asia/Shanghai');

    const instructions = this.promptBuilder.build({
      tools: toolDefs,
      skillsPrompt,
      memory,
      extraPrompt: request.extraPrompt,
      agentPersona: space?.persona,
      userTimezone: timezone,
      runtimeInfo: {
        agentId: request.agentId,
        model,
      },
    });

    return { messages: history, model, instructions, toolGroups: request.toolGroups };
  }

  /**
   * 加载会话最近的历史消息（DB 冷启动路径，Redis 缓存未命中时使用）
   *
   * 每行 DB 记录（input + blocks）对应最多 2 条对话消息，按 createdAt 倒序取最近
   * ceil(窗口/2) 行后反转为时间正序，再统一按 maxHistoryMessages 裁剪。
   */
  private async loadSessionHistory(sessionId: string): Promise<any[]> {
    const rows = await this.messageRepo.find({
      where: { sessionId },
      order: { createdAt: 'DESC' },
      take: Math.ceil(this.maxHistoryMessages / 2),
    });
    rows.reverse();

    const history: any[] = [];
    for (const msg of rows) {
      if (msg.input) {
        let userContent = msg.input;
        if (msg.files?.length) {
          userContent = `[用户附件]\n${msg.files.map((f) => `- ${f.filename}（路径: ${f.path}）`).join('\n')}\n\n${userContent}`;
        }
        history.push({ role: 'user', content: userContent });
      }
      const text = ContentBlockCollector.toText(msg.blocks);
      if (text) history.push({ role: 'assistant', content: text });
    }
    return this.trimHistory(history);
  }

  /** 裁剪历史到窗口上限内（保留最近 N 条），避免长会话上下文无限增长 */
  private trimHistory(messages: any[]): any[] {
    return messages.length > this.maxHistoryMessages ? messages.slice(-this.maxHistoryMessages) : messages;
  }

  private async getOrCreateSession(request: ChatRequest): Promise<SessionEntity> {
    const session = await this.sessionRepo.findOne({ where: { id: request.sessionId } });
    if (session) {
      // sessionId 由客户端传入，不校验归属就能往别人的会话里发消息、读到别人的上下文
      if (session.userId !== request.userId) throw new ForbiddenException('无权访问该会话');
      return session;
    }
    return this.sessionRepo.save(
      this.sessionRepo.create({
        id: request.sessionId,
        title: request.input.substring(0, 100),
        agentId: request.agentId,
        userId: request.userId,
        model: request.model,
        status: 'active',
      }),
    );
  }

  private async saveMessage(
    session: SessionEntity,
    input: string,
    extra: {
      model?: string;
      tokenUsage?: any;
      latencyMs?: number;
      blocks?: ContentBlock[];
      files?: Array<{ filename: string; storedName: string; path: string; size?: number; mimetype?: string }>;
    },
  ): Promise<MessageEntity> {
    return this.messageRepo.save(
      this.messageRepo.create({
        sessionId: session.id, role: 'assistant', input,
        files: extra.files?.length ? extra.files : undefined,
        blocks: extra.blocks, model: extra.model,
        tokenUsage: extra.tokenUsage, latencyMs: extra.latencyMs,
      }),
    );
  }

  private async updateSession(session: SessionEntity, context: ChatContext) {
    session.messageCount = (session.messageCount || 0) + 1;
    session.lastActiveAt = new Date();
    await this.sessionRepo.save(session);

    // 写回缓存前裁剪：本轮追加的消息会不断累积，若不裁剪，长会话的缓存会无限增长
    const cacheKey = `agent:context:${session.id}`;
    const messages = this.trimHistory(context.messages);
    await this.cacheContext(cacheKey, { messages, model: context.model, lastActiveAt: new Date() });
  }

  private async generateTitleAsync(session: SessionEntity, input: string) {
    if (session.titleGenerated) return;
    try {
      const { text } = await generateText({
        model: this.atlasLlm.text(),
        instructions: '请根据用户的问题生成一个简短的对话标题（10字以内），只返回标题文本，不要任何其他内容。',
        prompt: input,
        maxOutputTokens: 50,
      });
      const title = text.trim();
      if (title && title.length <= 50) {
        session.title = title;
        session.titleGenerated = true;
        await this.sessionRepo.save(session);
      }
    } catch (error) {
      this.logger.warn('Failed to generate title', error instanceof Error ? error.stack : String(error));
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Redis Cache
  // ═══════════════════════════════════════════════════════════

  private async getCachedContext(key: string): Promise<SessionContext | null> {
    try {
      const data = await this.redisService.getClient().get(key);
      return data ? JSON.parse(data) : null;
    } catch { return null; }
  }

  private async cacheContext(key: string, context: SessionContext) {
    try {
      await this.redisService.getClient().setex(key, this.sessionContextTTL, JSON.stringify(context));
    } catch (error) {
      this.logger.warn('Failed to cache context', error instanceof Error ? error.stack : String(error));
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Message Feedback & Session Management
  // ═══════════════════════════════════════════════════════════

  async updateMessageFeedback(messageId: string, feedback: 'like' | 'dislike' | null, user: SessionActor): Promise<MessageEntity> {
    const message = await this.messageRepo.findOne({ where: { id: messageId } });
    if (!message) throw new Error('消息不存在');
    await this.assertSessionAccess(message.sessionId, user);
    message.feedback = feedback;
    return this.messageRepo.save(message);
  }

  async getSessions(query: { agentId?: string; userId?: string; status?: string; page?: number; pageSize?: number }) {
    const where: any = {};
    if (query.agentId) where.agentId = query.agentId;
    if (query.userId) where.userId = query.userId;
    if (query.status) where.status = query.status;

    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const [items, total] = await this.sessionRepo.findAndCount({
      where, order: { lastActiveAt: 'DESC' }, skip: (page - 1) * pageSize, take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  async getSession(id: string) {
    return this.sessionRepo.findOne({ where: { id } });
  }

  async getSessionMessages(sessionId: string, limit = 100) {
    return this.messageRepo.find({ where: { sessionId }, order: { createdAt: 'ASC' }, take: limit });
  }

  /** 校验会话归属：仅本人或管理员可访问；会话不存在时放行（视频项目的会话可能还没有消息记录） */
  async assertSessionAccess(sessionId: string, user: SessionActor) {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (session && session.userId !== user.userId && !user.isAdmin) {
      throw new ForbiddenException('无权访问该会话');
    }
    return session;
  }

  async deleteSession(id: string, user: SessionActor) {
    await this.assertSessionAccess(id, user);
    // 视频制作：会话与项目是整体，无会话的孤儿项目也按 sessionId 清掉
    await this.videoService.deleteBySessionId(id);
    await this.messageRepo.delete({ sessionId: id });
    await this.sessionRepo.delete({ id });
    await this.redisService.getClient().del(`agent:context:${id}`);
  }

  /** 可用模型列表（供前端展示/选择） */
  listAvailableModels() {
    return { models: this.modelPolicy.list(), default: this.modelPolicy.defaultModelId };
  }

  /** 读取指定会话的结构化日志（排查问题用） */
  getSessionLogs(sessionId: string, date?: string) {
    return this.aiLogger.readSession(sessionId, date);
  }
}
