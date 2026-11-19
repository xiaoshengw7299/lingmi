import type { AppMessage, AgentUploadResult } from '@/api/agent'

// 重新导出 AppMessage 作为 ChatMessage，供组件直接使用
export type { AppMessage as ChatMessage } from '@/api/agent'

/** 与后端 ChatFileDto / POST /agent/upload 响应对齐 */
export type UploadResult = AgentUploadResult

// AgentSession 和 ChatMessage 从 api/agent 统一导出，此处向后兼容
export type { AgentSession } from '@/api/agent'
