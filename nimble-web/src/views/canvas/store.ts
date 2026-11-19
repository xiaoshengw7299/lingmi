import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { ElMessage } from 'element-plus'
import { getCanvas, saveCanvas } from '@/api/canvas'
import { referencesFrom } from './refs'
import { NODE_META, type CanvasDoc, type CanvasEdge, type CanvasNode, type NodeType, type Viewport } from './types'

const HISTORY_LIMIT = 60
const AUTOSAVE_DELAY_MS = 1500
const PASTE_OFFSET = 32
const GROUP_PADDING = 28
const GROUP_HEAD = 34

const uid = () => Math.random().toString(36).slice(2, 10)
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

/**
 * 画布编辑状态：节点 / 连线 / 视口 / 选择 / 撤销重做 / 自动保存。
 * 所有改动都经过这里的 action，视图层只读状态、不直接改数组，保证撤销与保存不会漏。
 */
export const useCanvasStore = defineStore('canvas', () => {
  const projectId = ref('')
  const title = ref('')
  const exampleId = ref<string | null>(null)
  const version = ref(1)
  const nodes = shallowRef<CanvasNode[]>([])
  const edges = shallowRef<CanvasEdge[]>([])
  const viewport = ref<Viewport>({ x: 0, y: 0, zoom: 1 })
  const selection = ref<Set<string>>(new Set())
  const saveState = ref<SaveState>('saved')

  const undoStack = ref<string[]>([])
  const redoStack = ref<string[]>([])
  let clipboard: { nodes: CanvasNode[]; edges: CanvasEdge[] } | null = null
  let saveTimer: number | undefined
  /** 改动计数：保存期间又有新改动时，保存完成后不能把状态标成已保存 */
  let rev = 0

  const nodeMap = computed(() => new Map(nodes.value.map((n) => [n.id, n])))
  const selectedNodes = computed(() => nodes.value.filter((n) => selection.value.has(n.id)))
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  // ─── 加载 / 保存 ────────────────────────────────────────────

  async function load(id: string) {
    flushSave()
    const project = await getCanvas(id)
    projectId.value = project.id
    title.value = project.title
    exampleId.value = project.exampleId ?? null
    version.value = project.version
    nodes.value = project.doc.nodes ?? []
    edges.value = project.doc.edges ?? []
    viewport.value = project.doc.viewport ?? { x: 0, y: 0, zoom: 1 }
    selection.value = new Set()
    undoStack.value = []
    redoStack.value = []
    saveState.value = 'saved'
  }

  function snapshot() {
    return JSON.stringify({ nodes: nodes.value, edges: edges.value })
  }

  function markDirty() {
    rev += 1
    saveState.value = 'dirty'
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(save, AUTOSAVE_DELAY_MS)
  }

  async function save() {
    window.clearTimeout(saveTimer)
    if (!projectId.value || saveState.value === 'saving') return
    saveState.value = 'saving'
    const savedRev = rev
    const doc: CanvasDoc = { nodes: nodes.value, edges: edges.value, viewport: viewport.value }
    try {
      const res = await saveCanvas(projectId.value, { baseVersion: version.value, title: title.value.trim() || undefined, doc })
      version.value = res.version
      if (rev === savedRev) saveState.value = 'saved'
      else markDirty()
    } catch (error) {
      saveState.value = 'error'
      if ((error as { response?: { status?: number } }).response?.status === 409) {
        ElMessage.error('画布已在其他窗口修改，请刷新页面后再编辑')
      }
    }
  }

  /** 离开页面前立即保存未落库的改动 */
  function flushSave() {
    if (saveState.value === 'dirty') void save()
  }

  /** 每次改动前调用：记一条撤销快照并安排保存 */
  function commit() {
    undoStack.value = [...undoStack.value.slice(-(HISTORY_LIMIT - 1)), snapshot()]
    redoStack.value = []
    markDirty()
  }

  function restore(json: string) {
    const data = JSON.parse(json) as { nodes: CanvasNode[]; edges: CanvasEdge[] }
    nodes.value = data.nodes
    edges.value = data.edges
    selection.value = new Set([...selection.value].filter((id) => data.nodes.some((n) => n.id === id)))
    markDirty()
  }

  function undo() {
    const previous = undoStack.value.at(-1)
    if (!previous) return
    redoStack.value = [...redoStack.value, snapshot()]
    undoStack.value = undoStack.value.slice(0, -1)
    restore(previous)
  }

  function redo() {
    const next = redoStack.value.at(-1)
    if (!next) return
    undoStack.value = [...undoStack.value, snapshot()]
    redoStack.value = redoStack.value.slice(0, -1)
    restore(next)
  }

  // ─── 节点 ───────────────────────────────────────────────────

  function addNode(type: NodeType, at: { x: number; y: number }, patch: Partial<CanvasNode> = {}): CanvasNode {
    commit()
    const meta = NODE_META[type]
    const node: CanvasNode = {
      id: uid(),
      type,
      x: Math.round(at.x),
      y: Math.round(at.y),
      w: meta.w,
      h: meta.h,
      title: meta.label,
      prompt: '',
      status: 'idle',
      ...patch,
    }
    nodes.value = [...nodes.value, node]
    selection.value = new Set([node.id])
    return node
  }

  /** 更新节点字段。generation 过程中的状态变化不进撤销栈（record=false），避免撤销到"生成中" */
  function updateNode(id: string, patch: Partial<CanvasNode>, record = true) {
    if (!nodeMap.value.has(id)) return
    if (record) commit()
    else markDirty()
    nodes.value = nodes.value.map((n) => (n.id === id ? { ...n, ...patch } : n))
  }

  /** 选中集合展开成"实际要移动的节点"：组带着成员一起走 */
  function withMembers(ids: Iterable<string>): Set<string> {
    const result = new Set<string>()
    for (const id of ids) {
      result.add(id)
      nodeMap.value.get(id)?.members?.forEach((m) => result.add(m))
    }
    return result
  }

  /** 拖拽 / 缩放过程中的高频更新：不记历史，由调用方在开始时 commit 一次 */
  function moveNodes(ids: Set<string>, dx: number, dy: number, origin: Map<string, { x: number; y: number }>) {
    nodes.value = fitGroups(
      nodes.value.map((n) => {
        const o = origin.get(n.id)
        return ids.has(n.id) && o ? { ...n, x: Math.round(o.x + dx), y: Math.round(o.y + dy) } : n
      }),
    )
    markDirty()
  }

  function resizeNode(id: string, w: number, h: number) {
    nodes.value = fitGroups(nodes.value.map((n) => (n.id === id ? { ...n, w: Math.round(w), h: Math.round(h) } : n)))
    markDirty()
  }

  /** 组的外框永远由成员算出来：成员移动、缩放、增删后外框自动跟随 */
  function fitGroups(list: CanvasNode[]): CanvasNode[] {
    const byId = new Map(list.map((n) => [n.id, n]))
    return list.map((n) => {
      if (n.type !== 'group') return n
      const members = (n.members ?? []).flatMap((id) => byId.get(id) ?? [])
      if (!members.length) return n
      const minX = Math.min(...members.map((m) => m.x))
      const minY = Math.min(...members.map((m) => m.y))
      const maxX = Math.max(...members.map((m) => m.x + m.w))
      const maxY = Math.max(...members.map((m) => m.y + m.h))
      return { ...n, x: minX - GROUP_PADDING, y: minY - GROUP_PADDING - GROUP_HEAD, w: maxX - minX + GROUP_PADDING * 2, h: maxY - minY + GROUP_PADDING * 2 + GROUP_HEAD }
    })
  }

  /** 删除节点：删组只拆组、不删成员；成员都没了的组一并清掉 */
  function removeNodes(ids: Iterable<string>) {
    const set = new Set(ids)
    if (!set.size) return
    commit()
    const alive = nodes.value
      .filter((n) => !set.has(n.id))
      .map((n) => (n.members ? { ...n, members: n.members.filter((m) => !set.has(m)) } : n))
      .filter((n) => n.type !== 'group' || n.members!.length > 0)
    const gone = new Set(nodes.value.filter((n) => !alive.some((a) => a.id === n.id)).map((n) => n.id))
    nodes.value = fitGroups(alive)
    edges.value = edges.value.filter((e) => !gone.has(e.from) && !gone.has(e.to))
    selection.value = new Set()
  }

  /** 把选中的普通节点打成一个组（已在组里的节点不重复入组） */
  function createGroup(ids: Iterable<string>) {
    const members = [...ids].filter((id) => {
      const n = nodeMap.value.get(id)
      return n && n.type !== 'group' && !nodes.value.some((g) => g.members?.includes(id))
    })
    if (members.length < 2) {
      ElMessage.warning('请选择至少 2 个未分组的节点')
      return
    }
    commit()
    const group: CanvasNode = { id: uid(), type: 'group', x: 0, y: 0, w: 0, h: 0, title: '新建组', prompt: '', status: 'idle', members }
    // 组放在数组最前面：渲染在成员下方，不遮挡成员
    nodes.value = fitGroups([group, ...nodes.value])
    selection.value = new Set([group.id])
  }

  function ungroup(id: string) {
    if (nodeMap.value.get(id)?.type !== 'group') return
    commit()
    nodes.value = nodes.value.filter((n) => n.id !== id)
    edges.value = edges.value.filter((e) => e.from !== id && e.to !== id)
    selection.value = new Set()
  }

  /** 复制一批节点：组带上成员，成员 id 与组内连线一并重映射 */
  function cloneNodes(picked: CanvasNode[], source: CanvasEdge[], offset: number) {
    // picked 可能是剪贴板里的节点（已不在画布上），所以也要放进查找表
    const all = new Map([...nodeMap.value, ...picked.map((n) => [n.id, n] as const)])
    const ids = new Set(picked.map((n) => n.id))
    picked.forEach((n) => n.members?.forEach((m) => all.has(m) && ids.add(m)))
    const list = [...ids].flatMap((id) => all.get(id) ?? [])
    const idMap = new Map(list.map((n) => [n.id, uid()]))
    const copies = list.map((n) => ({
      ...clone(n),
      id: idMap.get(n.id)!,
      x: n.x + offset,
      y: n.y + offset,
      members: n.members?.flatMap((m) => idMap.get(m) ?? []),
      status: 'idle' as const,
      taskId: undefined,
      error: undefined,
    }))
    const copyEdges = source
      .filter((e) => idMap.has(e.from) && idMap.has(e.to))
      .map((e) => ({ id: uid(), from: idMap.get(e.from)!, to: idMap.get(e.to)! }))
    return { copies, copyEdges }
  }

  function duplicateNodes(ids: Iterable<string>) {
    const picked = nodes.value.filter((n) => new Set(ids).has(n.id))
    if (!picked.length) return
    commit()
    const { copies, copyEdges } = cloneNodes(picked, edges.value, PASTE_OFFSET)
    nodes.value = fitGroups([...nodes.value, ...copies])
    edges.value = [...edges.value, ...copyEdges]
    selection.value = new Set(copies.map((n) => n.id))
  }

  function copySelection() {
    const picked = nodes.value.filter((n) => selection.value.has(n.id))
    // 以复制那一刻的位置存下来，粘贴时再整体偏移
    const { copies, copyEdges } = cloneNodes(picked, edges.value, 0)
    clipboard = { nodes: copies, edges: copyEdges }
  }

  function paste() {
    if (!clipboard?.nodes.length) return
    commit()
    const { copies, copyEdges } = cloneNodes(clipboard.nodes, clipboard.edges, PASTE_OFFSET)
    nodes.value = fitGroups([...nodes.value, ...copies])
    edges.value = [...edges.value, ...copyEdges]
    selection.value = new Set(copies.map((n) => n.id))
    clipboard = { nodes: clone(copies), edges: clone(copyEdges) }
  }

  // ─── 连线 ───────────────────────────────────────────────────

  /** 从 from 指向 to；拒绝自连、重复、会形成环的连线（环会让"参考"关系无意义） */
  function connect(from: string, to: string): boolean {
    if (from === to || edges.value.some((e) => e.from === from && e.to === to)) return false
    if (reaches(to, from)) return false
    commit()
    edges.value = [...edges.value, { id: uid(), from, to }]
    return true
  }

  function reaches(start: string, target: string): boolean {
    const seen = new Set<string>()
    const stack = [start]
    while (stack.length) {
      const cur = stack.pop()!
      if (cur === target) return true
      if (seen.has(cur)) continue
      seen.add(cur)
      for (const e of edges.value) if (e.from === cur) stack.push(e.to)
    }
    return false
  }

  function removeEdge(id: string) {
    commit()
    edges.value = edges.value.filter((e) => e.id !== id)
  }

  /** 指向某节点的参考节点，按连线创建顺序；组引用会展开成组内全部内容 */
  const referencesOf = (id: string) => referencesFrom(nodes.value, edges.value, id)

  // ─── 选择 / 视口 ────────────────────────────────────────────

  function select(ids: Iterable<string>, additive = false) {
    selection.value = new Set(additive ? [...selection.value, ...ids] : ids)
  }

  function setViewport(next: Viewport, persist = true) {
    viewport.value = next
    if (persist) markDirty()
  }

  function setExampleId(id: string | null) {
    exampleId.value = id
  }

  function setTitle(next: string) {
    title.value = next
    markDirty()
  }

  return {
    projectId, title, exampleId, version, nodes, edges, viewport, selection, saveState,
    nodeMap, selectedNodes, canUndo, canRedo,
    load, save, flushSave, commit, undo, redo,
    addNode, updateNode, withMembers, moveNodes, resizeNode, removeNodes, createGroup, ungroup,
    duplicateNodes, copySelection, paste,
    connect, removeEdge, referencesOf, select, setViewport, setTitle, setExampleId,
  }
})
