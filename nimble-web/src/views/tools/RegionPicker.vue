<template>
  <el-dialog :model-value="true" :title="mode === 'mask' ? '涂抹要擦除的区域' : '框选区域'" width="min(860px, 96vw)" top="max(12px, 5dvh)" append-to-body :close-on-click-modal="false" @close="emit('close')">
    <div class="stage">
      <div class="frame">
        <img v-if="source.kind === 'image'" ref="mediaRef" :src="source.url" alt="" draggable="false" @load="onLoad" />
        <video v-else ref="mediaRef" :src="`${source.url}#t=0.5`" muted playsinline preload="auto" @loadedmetadata="onLoad" />

        <div v-if="mode === 'boxes'" class="layer draw" @pointerdown="startBox" @pointermove="moveBox" @pointerup="endBox" @pointercancel="cancelBox">
          <div v-for="(box, i) in boxes" :key="i" class="rect" :style="boxStyle(box)">
            <button type="button" class="rect-del" aria-label="删除" @pointerdown.stop @click="boxes.splice(i, 1)">×</button>
          </div>
          <div v-if="drawing" class="rect is-drawing" :style="boxStyle(drawing)" />
        </div>
        <canvas v-else ref="maskRef" class="layer paint" @pointerdown="startPaint" @pointermove="movePaint" @pointerup="endPaint" @pointercancel="endPaint" />
      </div>
    </div>

    <div class="controls">
      <template v-if="mode === 'boxes'">
        <span class="tip">在画面上拖动框选{{ maxItems > 1 ? `，最多 ${maxItems} 个区域` : '' }}。坐标按比例保存，与视频实际分辨率无关。</span>
        <el-button size="small" :disabled="!boxes.length" @click="boxes.splice(0)">清空</el-button>
      </template>
      <template v-else>
        <label>画笔 <el-slider v-model="brush" :min="8" :max="90" class="brush" /></label>
        <el-button size="small" :disabled="!painted" @click="clearMask">清除</el-button>
        <span class="tip">涂满要擦除的物体，涂得稍大一些效果更好</span>
      </template>
    </div>

    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" :disabled="!ready" @click="confirm">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

export interface Box {
  top_left_x: number
  top_left_y: number
  bottom_right_x: number
  bottom_right_y: number
}

const props = withDefaults(
  defineProps<{ mode: 'boxes' | 'mask'; source: { url: string; kind: 'image' | 'video' }; boxes?: Box[]; maxItems?: number }>(),
  { boxes: () => [], maxItems: 1 },
)
const emit = defineEmits<{ close: []; boxes: [Box[]]; mask: [Blob] }>()

const MIN_SIZE = 0.01
const PAINT = 'rgba(255, 48, 48, 1)'

const mediaRef = ref<HTMLImageElement | HTMLVideoElement>()
const maskRef = ref<HTMLCanvasElement>()
const boxes = ref<Box[]>(props.boxes.map((box) => ({ ...box })))
const drawing = ref<Box>()
const brush = ref(36)
const painted = ref(false)
const ready = ref(false)
let origin: { x: number; y: number } | undefined
let painting = false

function onLoad() {
  const canvas = maskRef.value
  const media = mediaRef.value
  if (!media) return
  ready.value = true
  if (!canvas) return
  // 遮罩分辨率必须和原图一致，画布按原图像素建，显示时由 CSS 缩放
  canvas.width = media instanceof HTMLImageElement ? media.naturalWidth : media.videoWidth
  canvas.height = media instanceof HTMLImageElement ? media.naturalHeight : media.videoHeight
}

const clamp = (n: number) => Math.min(1, Math.max(0, n))
function ratioPoint(e: PointerEvent) {
  const box = mediaRef.value!.getBoundingClientRect()
  return { x: clamp((e.clientX - box.left) / box.width), y: clamp((e.clientY - box.top) / box.height) }
}

const boxStyle = (box: Box) => ({
  left: `${box.top_left_x * 100}%`,
  top: `${box.top_left_y * 100}%`,
  width: `${(box.bottom_right_x - box.top_left_x) * 100}%`,
  height: `${(box.bottom_right_y - box.top_left_y) * 100}%`,
})

function startBox(e: PointerEvent) {
  if (!ready.value || !e.isPrimary || e.button !== 0) return
  if (boxes.value.length >= props.maxItems) {
    if (props.maxItems > 1) return void ElMessage.warning(`最多 ${props.maxItems} 个区域`)
  }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  origin = ratioPoint(e)
  drawing.value = { top_left_x: origin.x, top_left_y: origin.y, bottom_right_x: origin.x, bottom_right_y: origin.y }
}

function moveBox(e: PointerEvent) {
  if (!origin || !e.isPrimary) return
  const p = ratioPoint(e)
  drawing.value = { top_left_x: Math.min(origin.x, p.x), top_left_y: Math.min(origin.y, p.y), bottom_right_x: Math.max(origin.x, p.x), bottom_right_y: Math.max(origin.y, p.y) }
}

function endBox(e: PointerEvent) {
  if (!e.isPrimary) return
  moveBox(e)
  const box = drawing.value
  if (box && box.bottom_right_x - box.top_left_x > MIN_SIZE && box.bottom_right_y - box.top_left_y > MIN_SIZE) {
    if (props.maxItems === 1) boxes.value = [box]
    else boxes.value.push(box)
  }
  cancelBox(e)
}

function cancelBox(e: PointerEvent) {
  if (!e.isPrimary) return
  drawing.value = undefined
  origin = undefined
}

function paintAt(e: PointerEvent, first: boolean) {
  const canvas = maskRef.value!
  const ctx = canvas.getContext('2d')!
  const rect = canvas.getBoundingClientRect()
  const scale = canvas.width / rect.width
  const x = (e.clientX - rect.left) * scale
  const y = (e.clientY - rect.top) * scale
  ctx.strokeStyle = ctx.fillStyle = PAINT
  ctx.lineWidth = brush.value * scale
  ctx.lineCap = ctx.lineJoin = 'round'
  if (first) {
    ctx.beginPath()
    ctx.arc(x, y, (brush.value * scale) / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(x, y)
    return
  }
  ctx.lineTo(x, y)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x, y)
  painted.value = true
}

function startPaint(e: PointerEvent) {
  if (!ready.value || !e.isPrimary || e.button !== 0) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  painting = true
  painted.value = true
  paintAt(e, true)
}
const movePaint = (e: PointerEvent) => painting && e.isPrimary && paintAt(e, false)
function endPaint(e: PointerEvent) {
  if (e.isPrimary) painting = false
}

function clearMask() {
  const canvas = maskRef.value!
  canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
  painted.value = false
}

/** 黑底白笔的遮罩图：白色是要擦除的区域 */
function exportMask(): Promise<Blob> {
  const source = maskRef.value!
  const white = document.createElement('canvas')
  white.width = source.width
  white.height = source.height
  const w = white.getContext('2d')!
  w.drawImage(source, 0, 0)
  w.globalCompositeOperation = 'source-in'
  w.fillStyle = '#fff'
  w.fillRect(0, 0, white.width, white.height)
  const out = document.createElement('canvas')
  out.width = source.width
  out.height = source.height
  const o = out.getContext('2d')!
  o.fillStyle = '#000'
  o.fillRect(0, 0, out.width, out.height)
  o.drawImage(white, 0, 0)
  return new Promise((resolve, reject) => out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('遮罩导出失败'))), 'image/png'))
}

async function confirm() {
  if (props.mode === 'boxes') {
    emit('boxes', boxes.value)
    return
  }
  if (!painted.value) return void ElMessage.warning('请先在图片上涂抹要擦除的区域')
  emit('mask', await exportMask())
}
</script>

<style scoped>
.stage { display: flex; justify-content: center; padding: 12px; border-radius: var(--radius-md); background: #0f1512; }
.frame { position: relative; display: inline-block; min-width: 0; line-height: 0; }
.frame img, .frame video { max-width: 100%; max-height: min(58vh, 58dvh); display: block; user-select: none; }
.layer { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
.paint { opacity: 0.6; }
.rect { position: absolute; border: 2px solid var(--color-primary-light); background: color-mix(in srgb, var(--color-primary) 22%, transparent); }
.rect.is-drawing { border-style: dashed; }
.rect-del {
  position: absolute; top: -10px; right: -10px; width: 20px; height: 20px; border: 0; border-radius: 50%;
  background: var(--color-error); color: #fff; font-size: 14px; line-height: 20px; cursor: pointer;
}
.controls { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin-top: 14px; }
.controls label { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--color-text-secondary); }
.brush { width: 180px; }
.tip { flex: 1; font-size: 12.5px; color: var(--color-text-tertiary); }
@media (max-width: 640px) {
  .stage { padding: 4px; }
  .rect-del { top: 0; right: 0; width: 32px; height: 32px; }
  .controls { gap: 8px; }
  .tip { flex-basis: 100%; }
  .brush { width: min(180px, 42vw); }
}
</style>
