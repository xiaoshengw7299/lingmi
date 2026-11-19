<template>
  <div class="editor">
    <header class="top">
      <button type="button" class="close-x" title="关闭画布，回到首页" @click="router.push({ name: 'video-canvas' })">
        <el-icon :size="15"><Close /></el-icon>
      </button>
      <div class="title-block">
        <h3
          v-if="!editingTitle"
          class="canvas-title"
          title="点击修改标题"
          @click="startEditTitle"
        >{{ store.title || '未命名画布' }}</h3>
        <el-input
          v-else
          ref="titleInputRef"
          v-model="titleDraft"
          class="canvas-title-input"
          maxlength="60"
          @keyup.enter="commitTitle"
          @keyup.esc="cancelEditTitle"
          @blur="commitTitle"
        />
        <StatusTag :status="saveStatus" :label="SAVE_LABEL[store.saveState]" />
      </div>
      <span class="spacer" />
      <div class="top-actions">
        <el-button :icon="RefreshLeft" text :disabled="!store.canUndo" aria-label="撤销" title="撤销 Ctrl+Z" @click="store.undo" />
        <el-button :icon="RefreshRight" text :disabled="!store.canRedo" aria-label="重做" title="重做 Ctrl+Shift+Z" @click="store.redo" />
        <el-button
          :icon="Share"
          size="small"
          :loading="sharing"
          :disabled="!store.nodes.length"
          :title="store.nodes.length
            ? (store.exampleId ? '基于当前画布最新内容更新已分享的作品' : '把当前画布分享到创作首页，别人可以预览并复制')
            : '画布里有内容后可分享'"
          @click="share"
        >{{ store.exampleId ? '重新分享' : '分享作品' }}</el-button>
        <el-button :icon="ChatDotRound" :type="agentOpen ? 'primary' : 'default'" size="small" @click="toggleAgent">画布助手</el-button>
      </div>
    </header>

    <div
      ref="stageRef"
      class="stage"
      tabindex="0"
      @pointerdown.capture="trackTouch"
      @pointerdown="onStagePointerDown"
      @dblclick="onStageDblClick"
      @wheel.prevent="onWheel"
      @dragover.prevent
      @drop.prevent="onDrop"
    >
      <div class="grid-bg" :style="gridStyle" />
      <div class="world" :style="worldStyle">
        <svg class="edges">
          <path
            v-for="edge in edgePaths"
            :key="edge.id"
            :d="edge.d"
            class="edge"
            :class="{ 'is-selected': selectedEdge === edge.id }"
          />
          <path
            v-for="edge in edgePaths"
            :key="`hit-${edge.id}`"
            :d="edge.d"
            class="edge-hit"
            @pointerdown.stop="selectEdge(edge.id)"
          />
          <path v-if="drag?.kind === 'connect'" :d="drag.d" class="edge is-draft" />
        </svg>
        <CanvasNodeCard
          v-for="node in store.nodes"
          :key="node.id"
          :node="node"
          :canvas-id="id"
          :before-share="prepareVideoShare"
          :selected="store.selection.has(node.id)"
          :touch-controls="compact"
          @drag-start="startMove(node, $event)"
          @connect-start="startConnect(node, $event)"
          @resize-start="startResize(node, $event)"
          @update="(patch) => store.updateNode(node.id, patch)"
        />
      </div>

      <div v-if="drag?.kind === 'box'" class="box" :style="boxStyle" />

      <div v-if="!store.nodes.length" class="empty">
        <el-icon :size="36"><MagicStick /></el-icon>
        <p>{{ compact ? '从下方添加节点或上传素材' : '双击画布添加节点，或把图片 / 视频 / 音频文件拖进来' }}</p>
      </div>

      <div v-if="menu" class="menu" :style="{ left: `${menu.sx}px`, top: `${menu.sy}px` }" @pointerdown.stop>
        <button v-for="type in CREATABLE_TYPES" :key="type" type="button" @click="addAt(type, menu.wx, menu.wy)">
          <el-icon><component :is="NODE_META[type].icon" /></el-icon>{{ NODE_META[type].label }}节点
        </button>
      </div>

      <div v-if="canGroup || selectedGroup || (compact && (store.selection.size || selectedEdge || linkFrom))" class="sel-bar" @pointerdown.stop>
        <el-button v-if="compact && single && !multiSelect && !linkFrom" size="small" @click="nodePanelOpen = true">编辑节点</el-button>
        <el-button v-if="compact && store.selection.size === 1 && !linkFrom" size="small" @click="startTapLink">连线</el-button>
        <span v-if="compact && linkFrom" class="link-hint">轻点目标节点</span>
        <el-button v-if="compact && linkFrom" size="small" @click="linkFrom = ''">取消连线</el-button>
        <el-button v-if="canGroup" size="small" :icon="Files" @click="store.createGroup(store.selection)">{{ compact ? '打组' : '打组 Ctrl+G' }}</el-button>
        <el-button v-if="selectedGroup" size="small" @click="store.ungroup(selectedGroup.id)">解散组</el-button>
        <el-button v-if="compact && store.selection.size && !linkFrom" size="small" @click="store.duplicateNodes(store.selection)">复制</el-button>
        <el-button v-if="compact && (store.selection.size || selectedEdge) && !linkFrom" size="small" type="danger" plain @click="removeSelection">删除</el-button>
      </div>

      <div v-if="!compact && single" class="panel-dock">
        <NodePanel :key="single.id" :node="single" @generate="generate(single)" />
      </div>
    </div>

    <aside class="tools" @pointerdown.stop>
      <el-tooltip v-for="type in CREATABLE_TYPES" :key="type" :content="`新建${NODE_META[type].label}节点`" placement="right">
        <button type="button" :aria-label="`新建${NODE_META[type].label}节点`" @click="addAtCenter(type)"><el-icon :size="18"><component :is="NODE_META[type].icon" /></el-icon></button>
      </el-tooltip>
      <el-tooltip content="从我的资产添加" placement="right">
        <button type="button" aria-label="从我的资产添加" @click="pickerVisible = true"><el-icon :size="18"><FolderOpened /></el-icon></button>
      </el-tooltip>
      <el-tooltip content="上传本地文件" placement="right">
        <button type="button" aria-label="上传本地文件" @click="fileInput?.click()"><el-icon :size="18"><Upload /></el-icon></button>
      </el-tooltip>
      <button v-if="compact" type="button" aria-label="多选节点" :aria-pressed="multiSelect" @click="multiSelect = !multiSelect"><el-icon :size="18"><Select /></el-icon></button>
    </aside>

    <div class="zoom" @pointerdown.stop>
      <el-button :icon="Minus" text size="small" aria-label="缩小画布" @click="zoomBy(1 / ZOOM_STEP)" />
      <span>{{ Math.round(store.viewport.zoom * 100) }}%</span>
      <el-button :icon="Plus" text size="small" aria-label="放大画布" @click="zoomBy(ZOOM_STEP)" />
      <el-button :icon="FullScreen" text size="small" aria-label="适应画布" title="适应画布" @click="fitView()" />
    </div>

    <div v-if="!compact && store.nodes.length" ref="miniRef" class="mini" @pointerdown.stop="onMiniPointer">
      <div v-for="rect in miniNodes" :key="rect.id" class="mini-node" :style="rect.style" />
      <div class="mini-view" :style="miniView" />
    </div>

    <el-drawer v-if="compact && single" v-model="nodePanelOpen" :title="single.title" direction="btt" size="auto" append-to-body destroy-on-close class="canvas-node-drawer">
      <NodePanel :key="single.id" :node="single" show-title @generate="generate(single)" />
    </el-drawer>
    <AgentPanel v-if="agentStarted" v-show="agentOpen" @close="agentOpen = false" />
    <input ref="fileInput" type="file" accept="image/*,video/*,audio/*" multiple hidden @change="onFiles" />
    <AssetPickerDialog v-model="pickerVisible" @confirm="addFromAssets" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { shareCanvas } from '@/api/canvas'
import { ChatDotRound, Close, Files, Share, FolderOpened, FullScreen, MagicStick, Minus, Plus, RefreshLeft, RefreshRight, Select, Upload } from '@element-plus/icons-vue'
import AssetPickerDialog from '@/components/AssetPickerDialog.vue'
import type { UserAsset } from '@/api/asset'
import { uploadMedia } from '@/api/generation'
import { withMediaType } from '@/api/media-tools'
import AgentPanel from './AgentPanel.vue'
import CanvasNodeCard from './CanvasNodeCard.vue'
import StatusTag from '@/views/video-producer/components/StatusTag.vue'
import { curve } from './geometry'
import NodePanel from './NodePanel.vue'
import { useCanvasStore } from './store'
import { mediaSizeFor, useNodeGeneration } from './generate'
import { CREATABLE_TYPES, MAX_ZOOM, MIN_NODE, MIN_ZOOM, NODE_META, type CanvasNode, type NodeType } from './types'

const props = defineProps<{ id: string }>()
const router = useRouter()

const ZOOM_STEP = 1.2
const FIT_PADDING = 80
const MINI = { w: 180, h: 120, pad: 200 }
const SAVE_LABEL = { saved: '已保存', dirty: '未保存', saving: '保存中', error: '保存失败' } as const
const SAVE_STATUS = { saved: 'success', dirty: 'draft', saving: 'generating', error: 'failed' } as const

const store = useCanvasStore()
const viewportMedia = window.matchMedia('(max-width: 960px)')
const compact = ref(viewportMedia.matches)
const { generate, resumePending } = useNodeGeneration()
const saveStatus = computed(() => SAVE_STATUS[store.saveState])

const editingTitle = ref(false)
const titleDraft = ref('')
const titleInputRef = ref<{ focus?: () => void; input?: HTMLInputElement } | null>(null)
let titleIgnoreBlur = false

async function startEditTitle() {
  titleIgnoreBlur = false
  titleDraft.value = store.title
  editingTitle.value = true
  await nextTick()
  titleInputRef.value?.focus?.()
  titleInputRef.value?.input?.select()
}

function cancelEditTitle() {
  titleIgnoreBlur = true
  editingTitle.value = false
}

function commitTitle() {
  if (titleIgnoreBlur) {
    titleIgnoreBlur = false
    return
  }
  if (!editingTitle.value) return
  editingTitle.value = false
  const next = titleDraft.value.trim()
  if (!next || next === store.title) return
  store.setTitle(next)
}

const stageRef = ref<HTMLElement>()
const miniRef = ref<HTMLElement>()
const fileInput = ref<HTMLInputElement>()
const pickerVisible = ref(false)
const agentOpen = ref(false)
const agentStarted = ref(false)
function toggleAgent() {
  agentStarted.value = true
  agentOpen.value = !agentOpen.value
}
const nodePanelOpen = ref(false)
const multiSelect = ref(false)
const linkFrom = ref('')
const sharing = ref(false)

async function prepareVideoShare() {
  if (store.saveState === 'dirty') await store.save()
  if (store.saveState === 'saved') return true
  ElMessage.warning(store.saveState === 'error' ? '画布保存失败，请保存后再发布' : '画布正在保存，请稍后再试')
  return false
}

/** 分享前先落库，保证分享的是最新内容；再次分享会覆盖上一次 */
async function share() {
  if (!store.nodes.length || sharing.value) return
  const updating = !!store.exampleId
  sharing.value = true
  try {
    await store.save()
    const shared = await shareCanvas(props.id, store.title)
    store.setExampleId(shared.id)
    ElMessage.success(updating ? '作品已更新为当前最新画布内容' : '已分享到创作首页，别人可以预览后复制')
  } finally {
    sharing.value = false
  }
}
const selectedEdge = ref('')
const menu = ref<{ sx: number; sy: number; wx: number; wy: number }>()

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'move'; sx: number; sy: number; ids: Set<string>; origin: Map<string, { x: number; y: number }>; committed: boolean }
  | { kind: 'resize'; id: string; sx: number; sy: number; w: number; h: number; committed: boolean }
  | { kind: 'connect'; from: string; d: string }
const drag = shallowRef<Drag>()

/** 底部提示词面板只对单个内容节点显示；组没有可生成的内容 */
const single = computed(() => (store.selection.size === 1 && store.selectedNodes[0]?.type !== 'group' ? store.selectedNodes[0] : undefined))
watch(() => single.value?.id, (id) => {
  if (!id) nodePanelOpen.value = false
  if (!compact.value && id) nextTick(() => single.value && revealNode(single.value))
})
const canGroup = computed(() => store.selectedNodes.filter((n) => n.type !== 'group').length >= 2)
const selectedGroup = computed(() => (store.selection.size === 1 && store.selectedNodes[0]?.type === 'group' ? store.selectedNodes[0] : undefined))

/** 底部提示词面板占用的高度（含间距）：选中的节点要留在它上方，不能被盖住 */
const PANEL_RESERVE = 210
const REVEAL_MARGIN = 24

/** 选中节点后，如果它被底部面板盖住或超出视野，就平移（必要时缩小）画布，让它完整露在面板上方 */
function revealNode(node: CanvasNode) {
  const rect = stageRef.value?.getBoundingClientRect()
  if (!rect) return
  const { x, y, zoom } = store.viewport
  const availH = rect.height - PANEL_RESERVE - REVEAL_MARGIN * 2
  const top = y + node.y * zoom
  const bottom = y + (node.y + node.h) * zoom
  if (top >= REVEAL_MARGIN && bottom <= rect.height - PANEL_RESERVE && node.h * zoom <= availH) return
  const next = node.h * zoom > availH ? Math.max(MIN_ZOOM, availH / node.h) : zoom
  const centerX = x + (node.x + node.w / 2) * zoom // 水平位置保持不动，只在竖直方向把节点挪到面板上方
  store.setViewport({
    zoom: next,
    x: centerX - (node.x + node.w / 2) * next,
    y: REVEAL_MARGIN + availH / 2 - (node.y + node.h / 2) * next,
  })
}

// ─── 坐标 / 视口 ─────────────────────────────────────────────

const worldStyle = computed(() => ({ transform: `translate(${store.viewport.x}px, ${store.viewport.y}px) scale(${store.viewport.zoom})` }))
const gridStyle = computed(() => {
  const size = 32 * store.viewport.zoom
  return { backgroundSize: `${size}px ${size}px`, backgroundPosition: `${store.viewport.x}px ${store.viewport.y}px` }
})

function stagePoint(e: { clientX: number; clientY: number }) {
  const rect = stageRef.value!.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function toWorld(p: { x: number; y: number }) {
  const { x, y, zoom } = store.viewport
  return { x: (p.x - x) / zoom, y: (p.y - y) / zoom }
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

/** 以屏幕上某点为中心缩放，让鼠标下的内容保持不动 */
function zoomAt(point: { x: number; y: number }, factor: number) {
  const { x, y, zoom } = store.viewport
  const next = clampZoom(zoom * factor)
  const k = next / zoom
  store.setViewport({ x: point.x - (point.x - x) * k, y: point.y - (point.y - y) * k, zoom: next })
}

function zoomBy(factor: number) {
  const rect = stageRef.value!.getBoundingClientRect()
  zoomAt({ x: rect.width / 2, y: rect.height / 2 }, factor)
}

function onWheel(e: WheelEvent) {
  zoomAt(stagePoint(e), Math.exp(-e.deltaY * 0.0015))
}

function fitView(persist = true) {
  const nodes = store.nodes
  const rect = stageRef.value!.getBoundingClientRect()
  if (!nodes.length) return store.setViewport({ x: rect.width / 2, y: rect.height / 2, zoom: 1 }, persist)
  const minX = Math.min(...nodes.map((n) => n.x))
  const minY = Math.min(...nodes.map((n) => n.y))
  const maxX = Math.max(...nodes.map((n) => n.x + n.w))
  const maxY = Math.max(...nodes.map((n) => n.y + n.h))
  const padding = compact.value ? 24 : FIT_PADDING
  const zoom = clampZoom(Math.min((rect.width - padding * 2) / (maxX - minX), (rect.height - padding * 2) / (maxY - minY), 1))
  store.setViewport({
    zoom,
    x: (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom,
    y: (rect.height - (maxY - minY) * zoom) / 2 - minY * zoom,
  }, persist)
}

function hasVisibleNode() {
  const stage = stageRef.value
  if (!stage) return false
  const { x, y, zoom } = store.viewport
  return store.nodes.some((node) => {
    if (node.type === 'group') return false
    const left = x + node.x * zoom
    const top = y + node.y * zoom
    return left < stage.clientWidth - 24 && top < stage.clientHeight - 24 &&
      left + node.w * zoom > 24 && top + node.h * zoom > 24
  })
}

// ─── 连线几何 ───────────────────────────────────────────────

const edgePaths = computed(() =>
  store.edges.flatMap((e) => {
    const a = store.nodeMap.get(e.from)
    const b = store.nodeMap.get(e.to)
    return a && b ? [{ id: e.id, d: curve(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2) }] : []
  }),
)

function selectEdge(id: string) {
  store.select([])
  linkFrom.value = ''
  selectedEdge.value = id
}

// ─── 指针交互 ───────────────────────────────────────────────

const touches = new Map<number, { x: number; y: number }>()
let activePointer: number | undefined
let latestMove: PointerEvent | undefined
let frame = 0
let pinch: { distance: number; zoom: number; anchor: { x: number; y: number } } | undefined

function trackTouch(e: PointerEvent) {
  if (e.pointerType !== 'touch' || (e.target as Element).closest('.sel-bar, .panel-dock, .menu, button, input, textarea, video, audio')) return
  touches.set(e.pointerId, stagePoint(e))
  startListening()
  if (touches.size === 2) {
    const { point, distance } = touchGeometry()
    pinch = { distance, zoom: store.viewport.zoom, anchor: toWorld(point) }
    drag.value = undefined
    activePointer = undefined
    latestMove = undefined
  }
}

function touchGeometry() {
  const [a, b] = touches.values()
  return {
    point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
  }
}

function startListening() {
  window.addEventListener('pointermove', queueMove, { passive: true })
  window.addEventListener('pointerup', finishPointer)
  window.addEventListener('pointercancel', finishPointer)
  window.addEventListener('blur', cancelGesture)
}

function listen(e: PointerEvent) {
  activePointer = e.pointerId
  startListening()
}

function queueMove(e: PointerEvent) {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, stagePoint(e))
  if (e.pointerId === activePointer) latestMove = e
  if (!frame && (latestMove || pinch && touches.size >= 2)) frame = requestAnimationFrame(applyMove)
}

function applyMove() {
  frame = 0
  if (pinch && touches.size >= 2) {
    const { point, distance } = touchGeometry()
    const zoom = clampZoom(pinch.zoom * distance / pinch.distance)
    store.setViewport({ zoom, x: point.x - pinch.anchor.x * zoom, y: point.y - pinch.anchor.y * zoom })
  } else if (latestMove) {
    onMove(latestMove)
  }
  latestMove = undefined
}

function cancelGesture() {
  window.removeEventListener('pointermove', queueMove)
  window.removeEventListener('pointerup', finishPointer)
  window.removeEventListener('pointercancel', finishPointer)
  window.removeEventListener('blur', cancelGesture)
  cancelAnimationFrame(frame)
  frame = 0
  latestMove = undefined
  activePointer = undefined
  drag.value = undefined
  pinch = undefined
  touches.clear()
}

function finishPointer(e: PointerEvent) {
  if (touches.has(e.pointerId)) {
    if (pinch && frame) {
      cancelAnimationFrame(frame)
      applyMove()
    }
    touches.delete(e.pointerId)
  }
  if (e.pointerId === activePointer && e.type === 'pointerup') {
    if (frame) {
      cancelAnimationFrame(frame)
      applyMove()
    }
    onUp(e)
  }
  if (!touches.size && (activePointer === undefined || activePointer === e.pointerId)) cancelGesture()
}

function startTapLink() {
  linkFrom.value = store.selectedNodes[0]?.id ?? ''
  multiSelect.value = false
}

function removeSelection() {
  if (selectedEdge.value) store.removeEdge(selectedEdge.value)
  else store.removeNodes(store.selection)
  selectedEdge.value = ''
}

function onStagePointerDown(e: PointerEvent) {
  if (pinch || (e.button !== 0 && e.button !== 1)) return
  menu.value = undefined
  selectedEdge.value = ''
  stageRef.value?.focus({ preventScroll: true })
  const p = stagePoint(e)
  if (e.ctrlKey || e.shiftKey || e.metaKey) {
    drag.value = { kind: 'box', x0: p.x, y0: p.y, x1: p.x, y1: p.y }
  } else {
    drag.value = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: store.viewport.x, vy: store.viewport.y, moved: false }
  }
  listen(e)
}

function startMove(node: CanvasNode, e: PointerEvent) {
  e.stopPropagation()
  if (pinch || e.button !== 0) return
  menu.value = undefined
  selectedEdge.value = ''
  if (linkFrom.value) {
    const from = linkFrom.value
    if (from !== node.id && connectNodes(from, node.id)) {
      linkFrom.value = ''
      store.select([node.id])
    }
    return
  }
  if (multiSelect.value || e.shiftKey || e.ctrlKey || e.metaKey) {
    const next = new Set(store.selection)
    if (!next.delete(node.id)) next.add(node.id)
    store.select(next)
    if (multiSelect.value) return
  } else if (!store.selection.has(node.id)) {
    store.select([node.id])
  }
  // 组带着成员一起移动；组的外框由成员重新算出，所以真正移动的是成员
  const ids = store.withMembers(store.selection)
  const origin = new Map([...ids].flatMap((id) => {
    const item = store.nodeMap.get(id)
    return item ? [[id, { x: item.x, y: item.y }] as const] : []
  }))
  drag.value = { kind: 'move', sx: e.clientX, sy: e.clientY, ids, origin, committed: false }
  listen(e)
}

function startResize(node: CanvasNode, e: PointerEvent) {
  if (pinch || e.button !== 0 || linkFrom.value) return
  drag.value = { kind: 'resize', id: node.id, sx: e.clientX, sy: e.clientY, w: node.w, h: node.h, committed: false }
  listen(e)
}

function startConnect(node: CanvasNode, e: PointerEvent) {
  if (pinch || e.button !== 0) return
  drag.value = { kind: 'connect', from: node.id, d: '' }
  updateConnect(e)
  listen(e)
}

function updateConnect(e: PointerEvent) {
  const d = drag.value
  const from = d?.kind === 'connect' ? store.nodeMap.get(d.from) : undefined
  if (d?.kind !== 'connect' || !from) return
  const end = toWorld(stagePoint(e))
  drag.value = { ...d, d: curve(from.x + from.w, from.y + from.h / 2, end.x, end.y) }
}

function onMove(e: PointerEvent) {
  const d = drag.value
  if (!d) return
  const zoom = store.viewport.zoom
  if (d.kind === 'pan') {
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    d.moved ||= Math.abs(dx) + Math.abs(dy) > 3
    if (!d.moved) return
    store.setViewport({ ...store.viewport, x: d.vx + dx, y: d.vy + dy })
  } else if (d.kind === 'box') {
    const p = stagePoint(e)
    drag.value = { ...d, x1: p.x, y1: p.y }
  } else if (d.kind === 'move') {
    if (!d.committed) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return
      store.commit()
      d.committed = true
    }
    store.moveNodes(d.ids, (e.clientX - d.sx) / zoom, (e.clientY - d.sy) / zoom, d.origin)
  } else if (d.kind === 'resize') {
    if (!d.committed) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return
      store.commit()
      d.committed = true
    }
    store.resizeNode(d.id, Math.max(MIN_NODE.w, d.w + (e.clientX - d.sx) / zoom), Math.max(MIN_NODE.h, d.h + (e.clientY - d.sy) / zoom))
  } else if (d.kind === 'connect') {
    updateConnect(e)
  }
}

function onUp(e: PointerEvent) {
  const d = drag.value
  drag.value = undefined
  if (!d) return
  if (d.kind === 'pan' && !d.moved) {
    if (!linkFrom.value) store.select([])
  } else if (d.kind === 'box') selectInBox(d, e.shiftKey || e.ctrlKey || e.metaKey)
  else if (d.kind === 'connect') {
    const targetId = (document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node-id]') as HTMLElement | null)?.dataset.nodeId
    if (targetId) connectNodes(d.from, targetId)
  }
}

function connectNodes(from: string, to: string) {
  if (store.connect(from, to)) return true
  ElMessage.warning('无法连接：重复连线或会形成循环')
  return false
}
function selectInBox(box: { x0: number; y0: number; x1: number; y1: number }, additive: boolean) {
  const a = toWorld({ x: Math.min(box.x0, box.x1), y: Math.min(box.y0, box.y1) })
  const b = toWorld({ x: Math.max(box.x0, box.x1), y: Math.max(box.y0, box.y1) })
  const hit = store.nodes.filter((n) => n.type !== 'group' && n.x < b.x && n.x + n.w > a.x && n.y < b.y && n.y + n.h > a.y).map((n) => n.id)
  store.select(hit, additive)
}

const boxStyle = computed(() => {
  const d = drag.value
  if (d?.kind !== 'box') return {}
  return { left: `${Math.min(d.x0, d.x1)}px`, top: `${Math.min(d.y0, d.y1)}px`, width: `${Math.abs(d.x1 - d.x0)}px`, height: `${Math.abs(d.y1 - d.y0)}px` }
})

// ─── 新建节点 / 导入 ────────────────────────────────────────

function onStageDblClick(e: MouseEvent) {
  if (compact.value || (e.target as HTMLElement).closest('[data-node-id], .panel-dock, .menu')) return
  const p = stagePoint(e)
  const w = toWorld(p)
  menu.value = { sx: p.x, sy: p.y, wx: w.x, wy: w.y }
}

function addAt(type: NodeType, wx: number, wy: number, patch: Partial<CanvasNode> = {}) {
  menu.value = undefined
  const w = patch.w ?? NODE_META[type].w
  const h = patch.h ?? NODE_META[type].h
  return store.addNode(type, { x: wx - w / 2, y: wy - h / 2 }, patch)
}

function addAtCenter(type: NodeType) {
  const rect = stageRef.value!.getBoundingClientRect()
  const c = toWorld({ x: rect.width / 2, y: rect.height / 2 })
  // 视图中心已经有节点时依次错开，连点几次工具栏不会叠成一个
  const at = { ...c }
  while (store.nodes.some((n) => n.type !== 'group' && Math.abs(n.x + n.w / 2 - at.x) < 30 && Math.abs(n.y + n.h / 2 - at.y) < 30)) {
    at.x += 48
    at.y += 48
  }
  addAt(type, at.x, at.y)
}

/** 一批素材在视图中心横向铺开：按各自的真实宽度排，大小不一也不会互相压住 */
function layoutRow(widths: number[]) {
  const rect = stageRef.value!.getBoundingClientRect()
  const c = toWorld({ x: rect.width / 2, y: rect.height / 2 })
  const gap = 24
  let x = c.x - (widths.reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1)) / 2
  return widths.map((w) => {
    const wx = x + w / 2
    x += w + gap
    return { wx, wy: c.y }
  })
}

interface MediaItem { type: NodeType; patch: Partial<CanvasNode>; preview?: string }

/** 把一批图片 / 视频 / 音频 / 提示词放上画布：先量好每个成品的真实比例，再按尺寸排版 */
async function placeItems(items: MediaItem[], at?: { x: number; y: number }) {
  const sizes = await Promise.all(items.map((it) => (it.preview ? mediaSizeFor(it.type, it.preview) : undefined)))
  const patches = items.map((it, i) => ({ ...it.patch, ...sizes[i] }))
  const spots = at
    ? patches.map((_, i) => ({ wx: at.x + i * 40, wy: at.y + i * 40 }))
    : layoutRow(patches.map((p, i) => p.w ?? NODE_META[items[i].type].w))
  items.forEach((it, i) => addAt(it.type, spots[i].wx, spots[i].wy, patches[i]))
}

function addFromAssets(assets: UserAsset[]) {
  void placeItems(
    assets.map((asset) => {
      if (asset.kind === 'prompt') return { type: 'text', patch: { text: asset.content ?? '', title: asset.name } }
      return { type: asset.kind, patch: { url: asset.url ?? undefined, title: asset.name }, preview: asset.url ?? undefined }
    }),
  )
}

async function importFiles(files: File[], at?: { x: number; y: number }) {
  const media = files.map(withMediaType).filter((f) => /^(image|video|audio)\//.test(f.type))
  if (!media.length) return
  const loading = ElMessage({ message: '上传中…', type: 'info', duration: 0 })
  try {
    const items: MediaItem[] = []
    for (const file of media) {
      const uploaded = await uploadMedia(file)
      items.push({
        type: uploaded.kind,
        patch: { url: uploaded.url, thumb: uploaded.thumbUrl ?? undefined, title: file.name.replace(/\.[^.]+$/, '').slice(0, 40) },
        preview: uploaded.thumbUrl ?? uploaded.url,
      })
    }
    await placeItems(items, at)
  } finally {
    loading.close()
  }
}
function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  void importFiles(files)
}

function onDrop(e: DragEvent) {
  const w = toWorld(stagePoint(e))
  void importFiles([...(e.dataTransfer?.files ?? [])], w)
}

function onPaste(e: ClipboardEvent) {
  if (isTyping(e.target)) return
  const files = [...(e.clipboardData?.files ?? [])]
  if (files.length) void importFiles(files)
  else store.paste()
}

// ─── 键盘 ───────────────────────────────────────────────────

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

function onKeydown(e: KeyboardEvent) {
  if (isTyping(e.target) || pickerVisible.value || nodePanelOpen.value || agentOpen.value) return
  const mod = e.ctrlKey || e.metaKey
  const key = e.key.toLowerCase()
  if (key === 'delete' || key === 'backspace') {
    removeSelection()
  } else if (mod && key === 'z') {
    e.preventDefault()
    if (e.shiftKey) store.redo()
    else store.undo()
  } else if (mod && key === 'y') {
    e.preventDefault()
    store.redo()
  } else if (mod && key === 'c') store.copySelection()
  else if (mod && key === 'd') {
    e.preventDefault()
    store.duplicateNodes(store.selection)
  } else if (mod && key === 'g') {
    e.preventDefault()
    if (e.shiftKey && selectedGroup.value) store.ungroup(selectedGroup.value.id)
    else store.createGroup(store.selection)
  } else if (mod && key === 'a') {
    e.preventDefault()
    store.select(store.nodes.map((n) => n.id))
  } else if (key === 'escape') {
    menu.value = undefined
    linkFrom.value = ''
    store.select([])
  }
}

// ─── 小地图 ─────────────────────────────────────────────────

const bounds = computed(() => {
  const xs = store.nodes.flatMap((n) => [n.x, n.x + n.w])
  const ys = store.nodes.flatMap((n) => [n.y, n.y + n.h])
  const rect = stageRef.value?.getBoundingClientRect()
  const { x, y, zoom } = store.viewport
  // 把当前视口也算进去，视口框才不会跑出小地图
  const view = rect ? [(-x) / zoom, (-y) / zoom, (rect.width - x) / zoom, (rect.height - y) / zoom] : [0, 0, 0, 0]
  const minX = Math.min(...xs, view[0]) - MINI.pad
  const minY = Math.min(...ys, view[1]) - MINI.pad
  const maxX = Math.max(...xs, view[2]) + MINI.pad
  const maxY = Math.max(...ys, view[3]) + MINI.pad
  return { minX, minY, k: Math.min(MINI.w / (maxX - minX), MINI.h / (maxY - minY)), view }
})

const miniNodes = computed(() =>
  store.nodes.map((n) => {
    const { minX, minY, k } = bounds.value
    return { id: n.id, style: { left: `${(n.x - minX) * k}px`, top: `${(n.y - minY) * k}px`, width: `${n.w * k}px`, height: `${n.h * k}px` } }
  }),
)

const miniView = computed(() => {
  const { minX, minY, k, view } = bounds.value
  return { left: `${(view[0] - minX) * k}px`, top: `${(view[1] - minY) * k}px`, width: `${(view[2] - view[0]) * k}px`, height: `${(view[3] - view[1]) * k}px` }
})

/** 点击小地图：把视口中心移到点击处 */
function onMiniPointer(e: PointerEvent) {
  const mini = miniRef.value!.getBoundingClientRect()
  const { minX, minY, k } = bounds.value
  const wx = (e.clientX - mini.left) / k + minX
  const wy = (e.clientY - mini.top) / k + minY
  const rect = stageRef.value!.getBoundingClientRect()
  const { zoom } = store.viewport
  store.setViewport({ zoom, x: rect.width / 2 - wx * zoom, y: rect.height / 2 - wy * zoom })
}

// ─── 生命周期 ───────────────────────────────────────────────

function onViewportChange(event: MediaQueryListEvent) {
  compact.value = event.matches
  nodePanelOpen.value = false
  multiSelect.value = false
  linkFrom.value = ''
  cancelGesture()
}

onMounted(async () => {
  viewportMedia.addEventListener('change', onViewportChange)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('paste', onPaste)
  await store.load(props.id)
  if (!stageRef.value || store.projectId !== props.id) return
  if (!store.nodes.length || (compact.value && !hasVisibleNode())) fitView(false)
  resumePending()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('paste', onPaste)
  viewportMedia.removeEventListener('change', onViewportChange)
  cancelGesture()
  store.flushSave()
})
</script>

<style scoped>
.editor { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--color-background); overflow: hidden; }
.editor button { touch-action: manipulation; }
.top { display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 12px; flex-shrink: 0; border-bottom: 1px solid var(--color-divider); background: var(--color-card); }
.close-x {
  width: 30px; height: 30px; display: grid; place-items: center; flex-shrink: 0;
  border: 1px solid var(--color-border); border-radius: 9px; background: var(--color-bg-secondary);
  color: var(--color-text-secondary); cursor: pointer;
}
.close-x:hover { color: #e44d4d; border-color: #f3c1c1; background: #fff5f5; }
.title-block { display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 420px; }
.canvas-title {
  margin: 0; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 15px; font-weight: 800; color: var(--color-text-primary); cursor: text;
  border-radius: 6px; padding: 2px 6px;
}
.canvas-title:hover { background: color-mix(in srgb, var(--color-primary) 8%, transparent); }
.canvas-title-input { width: 220px; }
.canvas-title-input :deep(.el-input__wrapper) {
  padding: 2px 8px; box-shadow: 0 0 0 1px #c4b5fd inset; background: var(--color-card); font-weight: 800;
}
.canvas-title-input :deep(.el-input__inner) { font-weight: 800; color: var(--color-text-primary); }
.spacer { flex: 1; }
.stage { position: relative; flex: 1; min-height: 0; overflow: hidden; outline: none; cursor: grab; touch-action: none; }
.stage:active { cursor: grabbing; }
.grid-bg { position: absolute; inset: 0; pointer-events: none; background-image: radial-gradient(circle, var(--color-border) 1.2px, transparent 1.2px); }
.world { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-origin: 0 0; }
.edges { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
.edge { fill: none; stroke: var(--color-primary-light); stroke-width: 2; }
.edge.is-selected { stroke: var(--color-warning); stroke-width: 3; }
.edge.is-draft { stroke-dasharray: 6 4; }
.edge-hit { fill: none; stroke: transparent; stroke-width: 14; pointer-events: stroke; cursor: pointer; }
.box { position: absolute; border: 1px dashed var(--color-primary); background: var(--color-primary-soft); opacity: 0.6; pointer-events: none; }
.empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--color-text-tertiary); font-size: 13px; pointer-events: none; }
.menu { position: absolute; z-index: 20; display: flex; flex-direction: column; min-width: 140px; padding: 6px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); box-shadow: var(--shadow-lg); }
.menu button { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--color-text-primary); font-size: 13px; cursor: pointer; }
.menu button:hover { background: var(--color-bg-secondary); }
.sel-bar { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); display: flex; gap: 8px; padding: 6px; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-card); box-shadow: var(--shadow-md); z-index: 10; }
.panel-dock { position: absolute; left: 0; right: 0; bottom: 16px; display: flex; justify-content: center; z-index: 10; pointer-events: none; }
.panel-dock > * { pointer-events: auto; }
.tools { position: absolute; left: 14px; top: 64px; display: flex; flex-direction: column; gap: 6px; padding: 6px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); box-shadow: var(--shadow-md); z-index: 10; }
.tools button { width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--color-text-secondary); cursor: pointer; }
.tools button:hover { background: var(--color-primary-soft); color: var(--color-primary-dark); }
.zoom { position: absolute; right: 14px; top: 56px; display: flex; align-items: center; gap: 2px; padding: 2px 6px; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-card); box-shadow: var(--shadow-sm); font-size: 12px; z-index: 10; }
.mini { position: absolute; right: 14px; top: 100px; width: 180px; height: 120px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-card); box-shadow: var(--shadow-sm); overflow: hidden; z-index: 10; cursor: pointer; }
.mini-node { position: absolute; background: var(--color-primary-light); opacity: 0.55; border-radius: 1px; }
.mini-view { position: absolute; border: 1.5px solid var(--color-warning); background: color-mix(in srgb, var(--color-warning) 12%, transparent); }
.top-actions { display: flex; align-items: center; gap: 10px; }
.top-actions .el-button + .el-button { margin-left: 0; }
.link-hint { font-size: 12px; white-space: nowrap; }
@media (max-width: 960px) {
  .top { height: auto; padding: 5px 8px; gap: 4px 6px; flex-wrap: wrap; }
  .close-x { width: 34px; height: 34px; }
  .title-block { flex: 1; max-width: none; }
  .canvas-title-input { flex: 1; min-width: 0; }
  .spacer { display: none; }
  .top-actions { flex: 0 0 100%; gap: 5px; }
  .top-actions .el-button { min-height: 34px; padding-inline: 7px; }
  .tools, .zoom { position: static; border: 0; border-top: 1px solid var(--color-divider); border-radius: 0; box-shadow: none; }
  .tools { flex: none; flex-direction: row; justify-content: center; gap: 0; padding: 2px 0; }
  .tools button { width: 42px; height: 40px; }
  .tools button[aria-pressed='true'] { color: var(--color-primary); background: var(--color-primary-soft); }
  .zoom { flex: none; justify-content: center; gap: 4px; padding: 0 4px env(safe-area-inset-bottom); }
  .zoom .el-button { min-height: 34px; min-width: 40px; margin: 0; }
  .sel-bar { top: auto; bottom: 6px; width: max-content; max-width: calc(100% - 12px); justify-content: center; align-items: center; flex-wrap: wrap; gap: 4px; border-radius: 12px; padding: 4px; }
  .sel-bar .el-button { min-height: 34px; margin: 0; padding-inline: 7px; }
}
</style>

<style>
.canvas-node-drawer.el-drawer { max-height: 78dvh; }
.canvas-node-drawer .el-drawer__header { margin-bottom: 0; padding: 12px 12px 6px; }
.canvas-node-drawer .el-drawer__body { padding: 6px 10px max(10px, env(safe-area-inset-bottom)); }
</style>
