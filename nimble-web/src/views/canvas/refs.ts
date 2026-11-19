import type { CanvasEdge, CanvasNode } from './types'

/**
 * 指向某节点的参考节点（按连线创建顺序）；组引用会展开成组内全部内容。
 * 纯函数：画布编辑（store）和"画布 → 工作台"转换（不一定加载进 store）共用。
 */
export function referencesFrom(nodes: CanvasNode[], edges: CanvasEdge[], id: string): CanvasNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return edges
    .filter((e) => e.to === id)
    .flatMap((e) => byId.get(e.from) ?? [])
    .flatMap((n) => (n.type === 'group' ? (n.members ?? []).flatMap((m) => byId.get(m) ?? []) : [n]))
}
