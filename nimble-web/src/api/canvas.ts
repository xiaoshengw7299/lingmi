import { del, get, post, put } from '@/utils/request'
import type { CanvasDoc } from '@/views/canvas/types'

export interface CanvasSummary {
  id: string
  title: string
  coverUrl: string | null
  updatedAt: string
  version: number
}

export interface CanvasProject extends CanvasSummary {
  doc: CanvasDoc
  /** 已分享到创作首页时的作品 id；没有分享过就是 null */
  exampleId?: string | null
}

export const listCanvases = () => get<CanvasSummary[]>('/canvas')

/** 新建画布；传 doc 可以直接带着内容创建（如从提示词库带入） */
export const createCanvas = (data: { title?: string; doc?: CanvasDoc } = {}) => post<CanvasProject>('/canvas', data)

export const getCanvas = (id: string) => get<CanvasProject>(`/canvas/${id}`)

/** 带版本号保存；版本过期时后端返回 409，由调用方提示刷新 */
export const saveCanvas = (id: string, data: { baseVersion: number; title?: string; doc?: CanvasDoc }) =>
  put<{ version: number; updatedAt: string }>(`/canvas/${id}`, data)

export const deleteCanvas = (id: string) => del<void>(`/canvas/${id}`)

// 创作平台把作品分享到创作首页，别人可以预览并复制

export interface CanvasExampleItem {
  id: string
  title: string
  coverUrl: string | null
  createdBy: string
  createdByName: string | null
  viewCount: number
  copyCount: number
  nodeCount: number
  /** 融合度，和创作平台相同的字段，前端根据它排序 */
  hot: number
  createdAt: string
}

export interface CanvasExample extends CanvasExampleItem {
  doc: CanvasDoc
}

export const listCanvasExamples = (params?: { page?: number; pageSize?: number; sort?: 'hot' | 'new' }) =>
  get<{ items: CanvasExampleItem[]; total: number }>('/canvas-examples', params)

export const getCanvasExample = (id: string) => get<CanvasExample>(`/canvas-examples/${id}`)

export const viewCanvasExample = (id: string) => post<boolean>(`/canvas-examples/${id}/view`).catch(() => false)

export const shareCanvas = (canvasId: string, title?: string) => post<{ id: string }>(`/canvas-examples/from-canvas/${canvasId}`, { title })

/** 使用作品，把作品的文档复制到当前画布 */
export const useCanvasExample = (id: string) => post<CanvasProject>(`/canvas-examples/${id}/use`)

export const deleteCanvasExample = (id: string) => del<void>(`/canvas-examples/${id}`)
