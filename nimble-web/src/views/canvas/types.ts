import type { GenerationKind } from '@/api/generation'
import type { LoraSelection } from '@/api/video'

/** 能生成内容的节点类型：与生成接口的 kind 一一对应 */
export type MediaNodeType = GenerationKind
/** 画布节点类型：四种内容节点 + 用来整理与批量引用的组节点 */
export type NodeType = MediaNodeType | 'group'

export interface CanvasNode {
  id: string
  type: NodeType
  x: number
  y: number
  w: number
  h: number
  title: string
  /** 图片 / 视频 / 音频的公网地址；文本节点为空 */
  url?: string
  /** 图片 / 视频首帧的缩略图：画布里用它渲染，放大查看才加载原图 */
  thumb?: string
  /** 仅组节点：成员节点 id。组的位置和大小由成员决定（见 store.fitGroups），自身不可拖动缩放 */
  members?: string[]
  /** 文本节点的正文（手写或 AI 生成） */
  text?: string
  /** 生成指令；文本节点里 text 是内容、prompt 是让 AI 写什么 */
  prompt: string
  modelId?: string
  ratio?: string
  resolution?: string
  outputFormat?: string
  promptOptimizeMode?: string
  lora?: LoraSelection | null
  durationSec?: number
  generateAudio?: boolean
  voice?: string
  status: 'idle' | 'generating' | 'failed'
  error?: string
  /** 进行中的生成任务 id：刷新页面后据此继续轮询，不会丢结果也不会重复扣费 */
  taskId?: string
}

/** 连线方向：from 作为 to 的参考素材 */
export interface CanvasEdge {
  id: string
  from: string
  to: string
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export interface CanvasDoc {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  viewport: Viewport
}

export const NODE_META: Record<NodeType, { label: string; icon: string; w: number; h: number }> = {
  image: { label: '图片', icon: 'Picture', w: 280, h: 280 },
  video: { label: '视频', icon: 'VideoCamera', w: 320, h: 200 },
  audio: { label: '音频', icon: 'Headset', w: 280, h: 110 },
  text: { label: '文本', icon: 'Document', w: 280, h: 180 },
  group: { label: '组', icon: 'Files', w: 320, h: 200 },
}

/** 创建菜单里可新建的节点类型（组由多选节点打组得到） */
export const CREATABLE_TYPES: MediaNodeType[] = ['image', 'video', 'audio', 'text']

export const MIN_ZOOM = 0.15
export const MAX_ZOOM = 2.5
export const MIN_NODE = { w: 160, h: 90 }
