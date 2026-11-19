import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import * as dayjs from 'dayjs';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { ResponseDto } from '../../common/dto/response.dto';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthUser } from '../../common/types/auth-user';
import { RequireBalance } from '../billing/require-balance';
import { AgentService, SessionActor } from './agent.service';
import { UPLOADS_SUBDIR, userUploadsDir } from './file-content.util';
import { ChatRequestDto, ChatRequest, MessageFeedbackDto, SSEEventData } from './dto/chat.dto';
import { SessionQueryDto } from './dto/session.dto';

// ─── UI Message Stream 适配器 ─────────────────────────────────
// 将内部 SSEEventData 流统一转换为 AI SDK UIMessageChunk JSON-SSE 格式，
// 所有流式响应（含 /chat?stream=true）均使用此协议，前端通过 useChat 消费。
//
// 映射关系：
//   text/think delta → text-start/text-delta/text-end + reasoning-start/…/end
//   block(process)   → data-process
//   block(bi)        → data-bi
//   done             → finish（含 messageMetadata）
//   error            → error

interface UmsChunk {
  type: string;
  [key: string]: unknown;
}

class SseToUmsAdapter {
  private textId: string | null = null;
  private thinkId: string | null = null;

  transform(event: SSEEventData): UmsChunk[] {
    const chunks: UmsChunk[] = [];

    switch (event.type) {
      case 'start':
        chunks.push({ type: 'start', messageId: randomUUID() });
        break;

      case 'text': {
        this.closeThink(chunks);
        if (!this.textId) {
          this.textId = randomUUID();
          chunks.push({ type: 'text-start', id: this.textId });
        }
        chunks.push({ type: 'text-delta', id: this.textId, delta: event.content ?? '' });
        break;
      }

      case 'think': {
        this.closeText(chunks);
        if (!this.thinkId) {
          this.thinkId = randomUUID();
          chunks.push({ type: 'reasoning-start', id: this.thinkId });
        }
        chunks.push({ type: 'reasoning-delta', id: this.thinkId, delta: event.content ?? '' });
        break;
      }

      case 'block': {
        this.flush(chunks);
        const block = event.block;
        if (!block) break;
        if (block.type === 'process') {
          chunks.push({ type: 'data-process', id: block.id, data: block });
        } else if (block.type === 'bi') {
          chunks.push({ type: 'data-bi', data: block });
        }
        break;
      }

      case 'done':
        this.flush(chunks);
        chunks.push({
          type: 'finish',
          finishReason: 'stop',
          messageMetadata: {
            messageId: event.messageId,
            title: event.title,
            tokenUsage: event.tokenUsage,
            sessionId: event.sessionId,
            requestId: event.requestId,
          },
        });
        break;

      case 'error':
        this.flush(chunks);
        chunks.push({ type: 'error', errorText: event.error ?? 'Unknown error' });
        break;
    }

    return chunks;
  }

  private closeText(chunks: UmsChunk[]) {
    if (this.textId) {
      chunks.push({ type: 'text-end', id: this.textId });
      this.textId = null;
    }
  }

  private closeThink(chunks: UmsChunk[]) {
    if (this.thinkId) {
      chunks.push({ type: 'reasoning-end', id: this.thinkId });
      this.thinkId = null;
    }
  }

  private flush(chunks: UmsChunk[]) {
    this.closeText(chunks);
    this.closeThink(chunks);
  }
}

/**
 * Agent 控制器
 * 提供 HTTP API 接口
 */
const RECOMMEND_QUESTIONS = [
  '制作一条夏季新品连衣裙时尚展示视频',
  '为品牌女装新品设计一段电商推广视频',
  '生成一段模特上身展示秋季外套的视频',
  '制作一支服装品牌新品发布宣传片',
];

const actorOf = (user: AuthUser): SessionActor => ({ userId: String(user.userId), isAdmin: !!user.isAdmin });

@Controller('agent')
export class AgentController {
  private readonly workspaceDir: string;

  constructor(
    private readonly agentService: AgentService,
    private readonly configService: ConfigService,
  ) {
    this.workspaceDir = this.configService.get<string>(
      'AGENT_WORKSPACE_DIR',
      path.join(process.cwd(), 'workspace'),
    );
    // 确保 workspace 目录存在
    if (!fs.existsSync(this.workspaceDir)) {
      fs.mkdirSync(this.workspaceDir, { recursive: true });
    }
  }

  /**
   * 聊天接口
   * POST /api/agent/chat
   *
   * stream=true  → SSE 流式响应（UI Message Stream 协议，供 @ai-sdk/vue useChat 消费）
   * stream=false → 普通 JSON 响应（批处理/Server Action 等场景）
   *
   * 流式输出格式遵循 AI SDK UI Message Stream 协议（x-vercel-ai-ui-message-stream: v1），
   * 统一通过 SseToUmsAdapter 将内部 SSEEventData 转换为标准 UIMessageChunk。
   */
  @Post('chat')
  @RequireBalance()
  @HttpCode(HttpStatus.OK)
  async chat(
    @Body() request: ChatRequestDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const payload: ChatRequest = { ...request, userId: String(user.userId) };

    if (request.stream) {
      // ── 流式：输出 UI Message Stream 协议 ──────────────────
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      // AI SDK useChat（DefaultChatTransport）依赖此头识别协议版本
      res.setHeader('x-vercel-ai-ui-message-stream', 'v1');
      res.flushHeaders();

      const abortController = new AbortController();
      const stream$ = this.agentService.chatStream(payload, abortController.signal);
      const adapter = new SseToUmsAdapter();
      let closed = false;

      // 心跳：每 15s 发一条 SSE 注释行，防止 Nginx 等代理因无数据传输而断开连接
      const heartbeat = setInterval(() => {
        if (!closed) res.write(': ping\n\n');
      }, 15000);

      const subscription = stream$.subscribe({
        next: (event) => {
          if (closed) return;
          for (const chunk of adapter.transform(event)) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        },
        error: (error) => {
          if (!closed) {
            res.write(`data: ${JSON.stringify({ type: 'error', errorText: error instanceof Error ? error.message : String(error) })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
          }
        },
        complete: () => {
          if (!closed) {
            res.write('data: [DONE]\n\n');
            res.end();
          }
        },
      });

      res.on('close', () => {
        closed = true;
        abortController.abort();
        clearInterval(heartbeat);
        subscription.unsubscribe();
      });

      return;
    }

    // ── 非流式：返回普通 JSON ────────────────────────────────
    const result = await this.agentService.chat(payload);
    res.json(ResponseDto.success(result));
  }

  /**
   * 获取会话列表
   * GET /api/agent/sessions
   */
  @Get('sessions')
  async getSessions(@Query() query: SessionQueryDto, @CurrentUser() user: AuthUser) {
    return this.agentService.getSessions({ ...query, userId: String(user.userId) });
  }

  /**
   * 获取会话详情
   * GET /api/agent/sessions/:id
   */
  @Get('sessions/:id')
  async getSession(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const session = await this.agentService.assertSessionAccess(id, actorOf(user));
    if (!session) {
      throw new BadRequestException('会话不存在');
    }
    return session;
  }

  /**
   * 获取会话消息
   * GET /api/agent/sessions/:id/messages
   */
  @Get('sessions/:id/messages')
  async getSessionMessages(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: number,
  ) {
    await this.agentService.assertSessionAccess(id, actorOf(user));
    return this.agentService.getSessionMessages(id, limit);
  }

  /**
   * 获取会话的结构化调用日志（排查问题用）
   * GET /api/agent/sessions/:id/logs?date=YYYY-MM-DD
   */
  @Get('sessions/:id/logs')
  async getSessionLogs(@Param('id') id: string, @CurrentUser() user: AuthUser, @Query('date') date?: string) {
    await this.agentService.assertSessionAccess(id, actorOf(user));
    return this.agentService.getSessionLogs(id, date);
  }

  /**
   * 删除会话
   * DELETE /api/agent/sessions/:id
   */
  @Delete('sessions/:id')
  async deleteSession(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.agentService.deleteSession(id, actorOf(user));
    return null;
  }

  /**
   * 消息反馈（喜欢/不喜欢）
   * PUT /api/agent/messages/:id/feedback
   */
  @Put('messages/:id/feedback')
  async updateMessageFeedback(
    @Param('id') id: string,
    @Body() body: MessageFeedbackDto,
    @CurrentUser() user: AuthUser,
  ) {
    try {
      const message = await this.agentService.updateMessageFeedback(id, body.feedback, actorOf(user));
      return { id: message.id, feedback: message.feedback };
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new BadRequestException(error.message);
    }
  }

  /**
   * 可用模型列表（前端模型选择器数据源）
   * GET /api/agent/models
   */
  @Public()
  @Get('models')
  getModels() {
    return this.agentService.listAvailableModels();
  }

  /**
   * 推荐问题（视频制作智能体的引导问题）
   * GET /api/agent/recommend-questions
   */
  @Public()
  @Get('recommend-questions')
  getRecommendQuestions() {
    return RECOMMEND_QUESTIONS;
  }

  /**
   * 上传文件到智能体工作空间
   * POST /api/agent/upload
   */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, _file, cb) => {
          const dir = process.env.AGENT_WORKSPACE_DIR || path.join(process.cwd(), 'workspace');
          // 按用户分目录：智能体只能读取当前用户自己上传的附件
          const uploadDir = userUploadsDir(dir, (req as { user?: AuthUser }).user!.userId);
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          cb(null, uploadDir);
        },
        filename: (_req, file, cb) => {
          // 保留原文件名，添加时间戳前缀避免冲突
          const timestamp = Date.now();
          const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
          const ext = path.extname(originalName);
          const baseName = path.basename(originalName, ext);
          cb(null, `${timestamp}_${baseName}${ext}`);
        },
      }),
      limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
    }),
  )
  uploadFile(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthUser) {
    if (!file) {
      throw new BadRequestException('请选择要上传的文件');
    }

    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    // 返回相对于 workspace 的路径，方便 LLM 工具读取
    const relativePath = `${UPLOADS_SUBDIR}/${user.userId}/${file.filename}`;

    return {
      filename: originalName,
      storedName: file.filename,
      path: relativePath,
      size: file.size,
      mimetype: file.mimetype,
    };
  }

  /**
   * 健康检查
   * GET /api/agent/health
   */
  @Public()
  @Get('health')
  health() {
    return {
      status: 'ok',
      timestamp: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    };
  }
}
