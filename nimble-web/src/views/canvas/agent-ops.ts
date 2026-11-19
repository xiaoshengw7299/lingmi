import { NODE_META, type CanvasNode, type NodeType } from './types'
import type { useCanvasStore } from './store'

/** 与后端 canvas_ops 工具的 ops 结构一致 */
export type CanvasOp =
  | { op: 'add_node'; ref: string; type: NodeType; title?: string; prompt?: string; text?: string; ratio?: string; durationSec?: number }
  | { op: 'connect'; from: string; to: string }
  | { op: 'update_node'; node: string; title?: string; prompt?: string; text?: string }
  | { op: 'generate'; node: string }

const LAYOUT_GAP = 60
const COLUMN_SIZE = 4
const SUMMARY_MAX_NODES = 60
const SNIPPET_LEN = 80

/** 给 Agent 看的画布快照：只带它决策需要的信息，控制 token 消耗 */
export function describeCanvas(store: ReturnType<typeof useCanvasStore>): string {
  const clip = (s?: string) => (s ?? '').replace(/\s+/g, ' ').slice(0, SNIPPET_LEN)
  const nodes = store.nodes.slice(0, SUMMARY_MAX_NODES).map((n) => {
    if (n.type === 'group') return `- id=${n.id} 类型=group 标题=${n.title} 成员=${(n.members ?? []).join(',')}`
    const done = n.type === 'text' ? !!n.text : !!n.url
    return `- id=${n.id} 类型=${n.type} 标题=${n.title} 提示词=${clip(n.prompt) || '（空）'} 成品=${done ? '有' : '无'}${n.text ? ` 正文=${clip(n.text)}` : ''}`
  })
  const edges = store.edges.map((e) => `${e.from} → ${e.to}`)
  return ['【画布状态】', nodes.length ? `节点：\n${nodes.join('\n')}` : '节点：（空画布）', edges.length ? `连线（参考来源 → 被生成）：${edges.join('；')}` : '连线：（无）'].join('\n')
}

/**
 * 在本地画布上执行 Agent 下发的操作。
 * 新节点排在现有内容右侧，按列堆叠；引用不存在的节点直接跳过，不让一个错误操作中断整批。
 * 返回需要触发生成的节点，由调用方走统一的生成流程（含登录与计费检查）。
 */
export function applyCanvasOps(store: ReturnType<typeof useCanvasStore>, ops: CanvasOp[]): CanvasNode[] {
  const refs = new Map<string, string>()
  const resolve = (id: string) => refs.get(id) ?? (store.nodeMap.has(id) ? id : undefined)
  const right = store.nodes.reduce((max, n) => Math.max(max, n.x + n.w), -LAYOUT_GAP)
  let placed = 0
  const toGenerate: string[] = []

  for (const op of ops) {
    if (op.op === 'add_node') {
      const meta = NODE_META[op.type]
      const col = Math.floor(placed / COLUMN_SIZE)
      const row = placed % COLUMN_SIZE
      placed += 1
      const node = store.addNode(
        op.type,
        { x: right + LAYOUT_GAP + col * (meta.w + LAYOUT_GAP), y: row * (meta.h + LAYOUT_GAP) },
        { title: op.title ?? meta.label, prompt: op.prompt ?? '', text: op.text, ratio: op.ratio, durationSec: op.durationSec },
      )
      refs.set(op.ref, node.id)
    } else if (op.op === 'connect') {
      const from = resolve(op.from)
      const to = resolve(op.to)
      if (from && to) store.connect(from, to)
    } else if (op.op === 'update_node') {
      const id = resolve(op.node)
      if (id) store.updateNode(id, { ...(op.title && { title: op.title }), ...(op.prompt !== undefined && { prompt: op.prompt }), ...(op.text !== undefined && { text: op.text }) })
    } else if (op.op === 'generate') {
      const id = resolve(op.node)
      if (id) toGenerate.push(id)
    }
  }
  return toGenerate.flatMap((id) => store.nodeMap.get(id) ?? [])
}
