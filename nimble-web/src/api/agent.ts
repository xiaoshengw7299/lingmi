import request, { get, del } from '@/utils/request'
import { storage } from '@/utils/storage'
import { DefaultChatTransport } from 'ai'
import type { UIMessage } from 'ai'
import type { Resolvable } from '@ai-sdk/provider-utils'

// ─── 业务类型 ─────────────────────────────────────────────────

/** 进度块数据（来自 data-process 自定义 chunk） */
export interface ProcessPart {
  type: 'process'
  id?: string
  content: string
  status?: 'running' | 'done' | 'error'
}

/** 组件块数据（来自 data-bi 自定义 chunk），目前只有分镜脚本卡片 video-storyboard */
export interface BiPart {
  type: 'bi'
  tag: 'video-storyboard' | (string & Record<never, never>)
  data: unknown
  title?: string
}

/** useChat 消息元数据（done 事件携带的会话信息） */
export interface AgentMessageMetadata {
  messageId?: string
  title?: string
  sessionId?: string
  requestId?: string
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number }
}

/** 扩展 UIMessage 的应用类型（含自定义 data 类型声明） */
export type AppMessage = UIMessage<
  AgentMessageMetadata,
  { process: ProcessPart; bi: BiPart }
>

/** Agent 会话 */
export interface AgentSession {
  id: string
  title: string
  agentId?: string
  userId?: string
  status?: string
  messageCount?: number
  lastActiveAt?: string
  createdAt?: string
}

/** 上传文件到智能体工作空间，返回可写入 chat.files 的元数据 */
export interface AgentUploadResult {
  filename: string
  storedName: string
  path: string
  size?: number
  mimetype?: string
}

/** Agent 会话消息（来自服务端历史记录） */
export interface AgentMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  input: string
  /** 用户附件（与 ChatFileDto 对齐，刷新后可恢复） */
  files?: AgentUploadResult[]
  blocks?: Array<{ type: string; content?: string; [k: string]: unknown }>
  createdAt: string
}

/** 可用模型（id 为 atlas-models.json llm 分组的 id） */
export interface AvailableModel {
  id: string
  name?: string
  isDefault: boolean
}

export function formatAvailableModelLabel(model: AvailableModel) {
  const name = (model.name || model.id).replace(/\|/g, ' ')
  return model.isDefault ? `${name} (默认)` : name
}

/** 分镜脚本摘要（bi.tag === 'video-storyboard'，点击后跳转视频工作台） */
export interface VideoStoryboardSummary {
  projectId: string
  title: string
  shotCount: number
  assetCount: number
}

// ─── API 调用 ─────────────────────────────────────────────────

export const getSessions = (params?: { agentId?: string; page?: number; pageSize?: number }) =>
  get<{ items: AgentSession[]; total: number; page: number; pageSize: number }>('/agent/sessions', params)

export const getSession = (id: string) =>
  get<AgentSession>(`/agent/sessions/${id}`)

export const getSessionMessages = (id: string, limit?: number) =>
  get<AgentMessage[]>(`/agent/sessions/${id}/messages`, limit ? { limit } : undefined)

export const deleteSession = (id: string) =>
  del(`/agent/sessions/${id}`)

export const getAvailableModels = () =>
  get<{ models: AvailableModel[]; default: string }>('/agent/models')

export const getRecommendQuestions = () =>
  get<string[]>('/agent/recommend-questions')

export const uploadAgentFile = (file: File) => {
  const formData = new FormData()
  formData.append('file', file)
  return request.post('/agent/upload', formData) as Promise<AgentUploadResult>
}

/**
 * 将上传结果转为 AI SDK FileUIPart，供 sendMessage / 历史回放在气泡中展示。
 * url 使用 agent-file:// 哨兵协议（工作区相对路径，非可下载地址）。
 */
export function toFileUIParts(files: AgentUploadResult[]) {
  return files.map((f) => ({
    type: 'file' as const,
    filename: f.filename,
    mediaType: f.mimetype || 'application/octet-stream',
    url: `agent-file://${encodeURIComponent(f.path)}`,
  }))
}

// ─── useChat Transport 工厂 ───────────────────────────────────

export interface AgentChatOptions {
  /** 智能体空间 id（不传 = 后端默认空间：视频制作） */
  agentId?: string
  /** 可选工具组（不传 = 后端默认加载全部） */
  toolGroups?: string[]
  /** 指定技能（不传 = 后端默认加载全部） */
  skills?: string[]
  /** 指定模型 */
  model?: string
}

/**
 * 构建 DefaultChatTransport 实例，供 useChat 使用。
 *
 * - api 统一指向 /api/agent/chat（单一接口，stream=true 时输出 UI Message Stream 协议）
 * - 服务端自行从 DB/Redis 维护会话历史，前端只传当前用户输入（input），不传全量 messages
 * - input 由调用方通过 sendMessage(_, { body: { input } }) 显式传入
 * - headers 注入 JWT token
 */
export function createAgentTransport(options: AgentChatOptions) {
  const headers: Resolvable<Record<string, string>> = (): Record<string, string> => {
    const token = storage.getToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  return new DefaultChatTransport({
    api: '/api/agent/chat',
    headers,
    prepareSendMessagesRequest: ({ id, body }) => ({
      body: {
        ...(body as object),  // 包含 input（来自 sendMessage 的 body 选项）
        sessionId: id,
        stream: true,
        agentId: options.agentId,
        toolGroups: options.toolGroups,
        skills: options.skills,
        model: options.model,
      },
    }),
  })
}

// ─── 历史消息转换（服务端 blocks → UIMessage parts） ──────────

/**
 * 将服务端返回的历史消息（ContentBlock[] 格式）转换为 UIMessage[] 格式。
 * 用于切换会话时初始化 useChat 的 messages。
 */
export function convertHistoryToUiMessages(history: AgentMessage[]): AppMessage[] {
  const result: AppMessage[] = []

  for (const msg of history) {
    const fileParts = msg.files?.length ? toFileUIParts(msg.files) : []
    // 仅附件时后端会写入「请查看附件：…」占位文案，有 file parts 时不再重复展示
    const hideAttachmentPrompt = fileParts.length > 0 && !!msg.input && /^请查看附件[：:]/.test(msg.input)
    const userText = msg.input && !hideAttachmentPrompt ? msg.input : ''

    if (userText || fileParts.length) {
      result.push({
        id: `user-${msg.id}`,
        role: 'user',
        parts: [
          ...(userText ? [{ type: 'text' as const, text: userText, state: 'done' as const }] : []),
          ...fileParts,
        ],
      } as AppMessage)
    }

    if (msg.blocks?.length) {
      const parts: AppMessage['parts'] = []
      for (const block of msg.blocks) {
        if (block.type === 'text') {
          parts.push({ type: 'text', text: String(block.content ?? ''), state: 'done' })
        } else if (block.type === 'think') {
          parts.push({ type: 'reasoning', text: String(block.content ?? ''), state: 'done' })
        } else if (block.type === 'process') {
          parts.push({
            type: 'data-process',
            data: block as ProcessPart,
            id: block.id as string | undefined,
          } as any)
        } else if (block.type === 'bi') {
          parts.push({
            type: 'data-bi',
            data: block as unknown as BiPart,
          } as any)
        }
      }
      if (parts.length) {
        result.push({
          id: `assistant-${msg.id}`,
          role: 'assistant',
          parts,
        } as AppMessage)
      }
    }
  }

  return result
}
