<script lang="ts">
export type ToolOp = 'crop' | 'split' | 'upscale' | 'inpaint'
</script>

<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { runImageTool, type ProcessedImage } from '@/api/generation'
import { useNodeGeneration, heightForRatio } from './generate'
import { useCanvasStore } from './store'
import type { CanvasNode } from './types'

const props = defineProps<{ node: CanvasNode; op: ToolOp }>()
const emit = defineEmits<{ close: [] }>()

const TITLES: Record<ToolOp, string> = { crop: '裁剪图片', split: '拆分为多张', upscale: '放大图片', inpaint: '局部重绘' }
const NODE_GAP = 60
const MIN_CROP = 0.02
const MASK_COLOR = 'rgba(255, 48, 48, 0.78)'

const store = useCanvasStore()
const { generate } = useNodeGeneration()

const imgRef = ref<HTMLImageElement>()
const maskRef = ref<HTMLCanvasElement>()
const busy = ref(false)

// ─── 各工具的参数 ──────────────────────────────────────────

const rect = ref<{ x: number; y: number; w: number; h: number }>()
const split = reactive({ rows: 2, cols: 2 })
const factor = ref<2 | 4>(2)
const inpaint = reactive({ prompt: '', brush: 28, painted: false })

let rectOrigin: { x: number; y: number } | undefined
let painting = false

const rectStyle = computed(() => {
  const r = rect.value
  return r ? { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` } : {}
})

/** 指针位置换算成相对图片的 0–1 比例 */
function ratioPoint(e: PointerEvent) {
  const box = imgRef.value!.getBoundingClientRect()
  return { x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)) }
}

function startRect(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  rectOrigin = ratioPoint(e)
  rect.value = { ...rectOrigin, w: 0, h: 0 }
}

function moveRect(e: PointerEvent) {
  if (!rectOrigin) return
  const p = ratioPoint(e)
  rect.value = { x: Math.min(rectOrigin.x, p.x), y: Math.min(rectOrigin.y, p.y), w: Math.abs(p.x - rectOrigin.x), h: Math.abs(p.y - rectOrigin.y) }
}

const endRect = () => (rectOrigin = undefined)

function onImageLoad() {
  const canvas = maskRef.value
  const img = imgRef.value
  if (!canvas || !img) return
  // 画布像素尺寸 = 图片显示尺寸，笔迹所见即所得；后端会按原图尺寸缩放标注图
  canvas.width = img.clientWidth
  canvas.height = img.clientHeight
}

function paintAt(e: PointerEvent, first: boolean) {
  const canvas = maskRef.value!
  const ctx = canvas.getContext('2d')!
  const box = canvas.getBoundingClientRect()
  const x = ((e.clientX - box.left) / box.width) * canvas.width
  const y = ((e.clientY - box.top) / box.height) * canvas.height
  ctx.strokeStyle = ctx.fillStyle = MASK_COLOR
  ctx.lineWidth = inpaint.brush
  ctx.lineCap = ctx.lineJoin = 'round'
  if (first) {
    ctx.beginPath()
    ctx.arc(x, y, inpaint.brush / 2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.lineTo(x, y)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x, y)
  inpaint.painted = true
}

function startPaint(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  painting = true
  maskRef.value!.getContext('2d')!.beginPath()
  paintAt(e, true)
}

const movePaint = (e: PointerEvent) => painting && paintAt(e, false)
const endPaint = () => (painting = false)

function clearMask() {
  const canvas = maskRef.value!
  canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
  inpaint.painted = false
}

// ─── 执行 ───────────────────────────────────────────────────

const naturalSize = () => ({ w: imgRef.value!.naturalWidth, h: imgRef.value!.naturalHeight })

/** 在源节点右侧排放结果节点，宽度沿用源节点，高度按真实宽高比算 */
function placeNode(out: ProcessedImage, index: number, title: string, aspect: { w: number; h: number }, extra: Partial<CanvasNode> = {}) {
  const w = props.node.w
  return store.addNode(
    'image',
    { x: props.node.x + props.node.w + NODE_GAP + (index % 4) * (w + 24), y: props.node.y + Math.floor(index / 4) * (heightForRatio(w, `${aspect.w}:${aspect.h}`) + 24) },
    { title, url: out.url, thumb: out.thumbUrl ?? undefined, w, h: heightForRatio(w, `${aspect.w}:${aspect.h}`), ...extra },
  )
}

async function confirm() {
  const url = props.node.url!
  busy.value = true
  try {
    const { w: nw, h: nh } = naturalSize()
    if (props.op === 'crop') {
      const r = rect.value
      if (!r || r.w < MIN_CROP || r.h < MIN_CROP) return void ElMessage.warning('请在图片上拖出要保留的区域')
      const [out] = await runImageTool({ op: 'crop', url, rect: r })
      placeNode(out, 0, `${props.node.title}-裁剪`, { w: r.w * nw, h: r.h * nh })
    } else if (props.op === 'split') {
      const outs = await runImageTool({ op: 'split', url, rows: split.rows, cols: split.cols })
      const cell = { w: nw / split.cols, h: nh / split.rows }
      const ids = outs.map((out, i) => placeNode(out, i, `${props.node.title}-${i + 1}`, cell).id)
      store.createGroup(ids)
    } else if (props.op === 'upscale') {
      const [out] = await runImageTool({ op: 'upscale', url, factor: factor.value })
      placeNode(out, 0, `${props.node.title}-${factor.value}x`, { w: nw * factor.value, h: nh * factor.value })
    } else {
      if (!inpaint.painted) return void ElMessage.warning('请先在图片上涂抹要修改的区域')
      if (!inpaint.prompt.trim()) return void ElMessage.warning('请描述要把标注区域改成什么')
      const [marked] = await runImageTool({ op: 'mark', url, mask: maskRef.value!.toDataURL('image/png') })
      // 标注图作为参考节点放在画布上，重绘结果是另一个连着它的图片节点：整个过程可见、可改、可重来
      const ref = placeNode(marked, 0, '标注图', { w: nw, h: nh })
      const target = placeNode(marked, 1, `${props.node.title}-重绘`, { w: nw, h: nh }, {
        url: undefined,
        thumb: undefined,
        modelId: props.node.modelId,
        ratio: props.node.ratio,
        resolution: props.node.resolution,
        prompt: `${inpaint.prompt.trim()}。只修改参考图里红色标注的区域，其余部分保持完全不变，输出图中不要保留红色标注。`,
      })
      store.connect(ref.id, target.id)
      void generate(target)
    }
    emit('close')
  } finally {
    busy.value = false
  }
}

nextTick(onImageLoad)
</script>

<template>
  <el-dialog :model-value="true" :title="TITLES[op]" width="min(760px, calc(100vw - 20px))" top="max(8px, 6dvh)" append-to-body destroy-on-close :close-on-click-modal="false" @close="emit('close')">
    <div class="stage">
      <div class="frame">
        <img ref="imgRef" :src="node.url" draggable="false" @load="onImageLoad" />

        <div v-if="op === 'crop'" class="layer crop" @pointerdown="startRect" @pointermove="moveRect" @pointerup="endRect" @pointercancel="endRect">
          <div v-if="rect" class="rect" :style="rectStyle" />
        </div>

        <div v-else-if="op === 'split'" class="layer grid" :style="{ gridTemplateColumns: `repeat(${split.cols}, 1fr)`, gridTemplateRows: `repeat(${split.rows}, 1fr)` }">
          <i v-for="n in split.rows * split.cols" :key="n" />
        </div>

        <canvas v-else-if="op === 'inpaint'" ref="maskRef" class="layer paint" @pointerdown="startPaint" @pointermove="movePaint" @pointerup="endPaint" @pointercancel="endPaint" />
      </div>
    </div>

    <div class="controls">
      <template v-if="op === 'crop'"><span class="tip">在图片上拖动框选要保留的区域，结果会作为新图片节点放在右侧。</span></template>
      <template v-else-if="op === 'split'">
        <label>行 <el-input-number v-model="split.rows" :min="1" :max="6" size="small" /></label>
        <label>列 <el-input-number v-model="split.cols" :min="1" :max="6" size="small" /></label>
        <span class="tip">按网格均分，结果自动打成一个组。</span>
      </template>
      <template v-else-if="op === 'upscale'">
        <el-radio-group v-model="factor" size="small">
          <el-radio-button :value="2">2 倍</el-radio-button>
          <el-radio-button :value="4">4 倍</el-radio-button>
        </el-radio-group>
        <span class="tip">等比放大（不依赖模型，不扣费）。</span>
      </template>
      <template v-else>
        <div class="inpaint-row">
          <label>画笔 <el-slider v-model="inpaint.brush" :min="8" :max="80" class="brush" /></label>
          <el-button size="small" @click="clearMask">清除标注</el-button>
        </div>
        <el-input v-model="inpaint.prompt" type="textarea" :rows="2" maxlength="500" placeholder="把标注区域改成……（例如：换成一只戴墨镜的柴犬）" />
        <span class="tip">用画笔涂出要修改的区域；生成一次会按所选图片模型计费。</span>
      </template>
    </div>

    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" :loading="busy" @click="confirm">{{ op === 'inpaint' ? '开始重绘' : '确定' }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.stage { display: flex; justify-content: center; padding: 12px; border-radius: var(--radius-md); background: var(--color-bg-secondary); }
.frame { position: relative; display: inline-block; min-width: 0; line-height: 0; }
.frame img { max-width: 100%; max-height: 52vh; display: block; user-select: none; }
.layer { position: absolute; inset: 0; width: 100%; height: 100%; }
.crop { cursor: crosshair; touch-action: none; }
.rect { position: absolute; border: 2px solid var(--color-primary-light); background: color-mix(in srgb, var(--color-primary) 18%, transparent); box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45); }
.grid { display: grid; pointer-events: none; }
.grid i { border: 1px dashed rgba(255, 255, 255, 0.85); box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.5) inset; }
.paint { cursor: crosshair; touch-action: none; }
.controls { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin-top: 14px; }
.controls label { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--color-text-secondary); }
.inpaint-row { display: flex; align-items: center; gap: 16px; width: 100%; }
.brush { width: 160px; }
.tip { font-size: 12.5px; color: var(--color-text-tertiary); }
@media (max-width: 640px) {
  .stage { padding: 4px; }
  .frame img { max-height: 40dvh; }
  .inpaint-row { flex-wrap: wrap; gap: 8px; }
  .brush { width: min(160px, 42vw); }
}
</style>
