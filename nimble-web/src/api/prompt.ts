import { del, get, post } from '@/utils/request'

export type PromptType = 'image' | 'video'
export type RankSort = 'hot' | 'new'

export interface PromptParams {
  ratio?: string
  resolution?: string
  durationSec?: number
}

/** 参考素材：提示词里用 @名称 引用，别人拿同样的素材就能复现 */
export interface PromptReference {
  name: string
  kind: 'image' | 'video' | 'audio'
  url: string
}

export interface PromptItem {
  id: string
  title: string
  content: string
  type: PromptType
  modelId: string | null
  modelName: string | null
  params: PromptParams | null
  references: PromptReference[]
  /** 示例成品（图片或视频）的地址 */
  mediaUrl: string
  createdBy: string
  createdByName: string | null
  viewCount: number
  copyCount: number
  createdAt: string
}

export const listPrompts = (params?: { type?: PromptType; sort?: RankSort; keyword?: string; page?: number; pageSize?: number }) =>
  get<{ items: PromptItem[]; total: number; page: number; pageSize: number }>('/prompts', params)

/** 发布提示词：taskId 是用它成功生成过的任务，作为示例成品 */
export const createPrompt = (data: {
  title: string
  content: string
  type: PromptType
  modelId?: string
  params?: PromptParams
  references?: PromptReference[]
  taskId: string
}) => post<PromptItem>('/prompts', data)

/** 使用提示词：参考素材会复制成自己的文件，返回后可直接在画布或工作台里搭好同样的创作环境 */
export const usePrompt = (id: string) =>
  post<Pick<PromptItem, 'title' | 'content' | 'type' | 'modelId' | 'params' | 'references'>>(`/prompts/${id}/use`)

export const deletePrompt = (id: string) => del<void>(`/prompts/${id}`)

/** 查看 / 复制计数；后端按"访客 + 天"去重，返回本次是否真的计数了（今天已计过则为 false） */
export const trackPrompt = (id: string, kind: 'view' | 'copy') =>
  post<boolean>(`/prompts/${id}/${kind}`).catch(() => false)
