import { heightForRatio } from './generate'
import { NODE_META, type CanvasDoc, type CanvasNode, type MediaNodeType } from './types'

const COLUMN_X = [0, 400]
const ROW_GAP = 36

const uid = () => Math.random().toString(36).slice(2, 10)

const mkNode = (type: MediaNodeType, x: number, y: number, patch: Partial<CanvasNode>): CanvasNode => ({
  id: uid(),
  type,
  x,
  y,
  w: NODE_META[type].w,
  h: NODE_META[type].h,
  title: NODE_META[type].label,
  prompt: '',
  status: 'idle',
  ...patch,
})

/**
 * 把一条提示词搭成画布：参考素材一列，生成节点在右边，参考 → 生成节点连线。
 * 提示词库的"在无限画布中使用"用它直接创建画布。
 */
export function promptToDoc(data: {
  title: string
  content: string
  type: 'image' | 'video'
  modelId: string | null
  params: { ratio?: string; resolution?: string; durationSec?: number } | null
  references: Array<{ name: string; kind: 'image' | 'video' | 'audio'; url: string }>
}): CanvasDoc {
  let y = 0
  const refs = data.references.map((r) => {
    const node = mkNode(r.kind, COLUMN_X[0], y, { title: r.name, url: r.url })
    if (r.kind === 'image') node.h = 200
    y += node.h + ROW_GAP
    return node
  })
  const target = mkNode(data.type, COLUMN_X[1], 0, {
    title: data.title.slice(0, 40),
    prompt: data.content,
    modelId: data.modelId ?? undefined,
    ratio: data.params?.ratio,
    resolution: data.params?.resolution,
    durationSec: data.params?.durationSec,
  })
  target.h = heightForRatio(target.w, data.params?.ratio)
  target.y = Math.max(0, (y - ROW_GAP - target.h) / 2)
  return {
    nodes: [...refs, target],
    edges: refs.map((r) => ({ id: uid(), from: r.id, to: target.id })),
    viewport: { x: 120, y: 80, zoom: 0.8 },
  }
}
