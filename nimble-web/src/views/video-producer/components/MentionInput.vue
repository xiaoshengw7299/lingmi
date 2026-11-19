<template>
  <div ref="rootRef" class="mention-input">
    <div class="mention-editor" @mousemove="onEditorMouseMove" @mouseleave="onEditorMouseLeave">
      <!-- 高亮层在 textarea 下面，光标和选区才能露出来。@提及 的悬浮预览改由鼠标位置探测，
           不依赖高亮标签自己接到 hover。 -->
      <div ref="highlightRef" class="mention-highlight" aria-hidden="true">
        <template v-for="(seg, i) in segments" :key="i">
          <mark v-if="seg.isMention" class="mention-chip" :data-mention-at="seg.start">{{ seg.text }}</mark>
          <template v-else>{{ seg.text }}</template>
        </template>
        <br v-if="textValue.endsWith('\n')" />
      </div>
      <textarea
        ref="textareaRef"
        class="mention-textarea"
        :value="textValue"
        :placeholder="placeholder"
        :rows="rows"
        :readonly="readonly"
        @input="handleInput"
        @keydown="handleKeydown"
        @keyup="handleKeyup"
        @compositionend="handleCompositionEnd"
        @blur="handleBlur"
        @click="syncCaret"
        @scroll="syncScroll"
      />
    </div>

    <!-- Teleport 到 body，避免父级 overflow:hidden（如 ShotCard）裁切弹层 -->
    <Teleport to="body">
      <div
        v-if="showPicker"
        ref="pickerRef"
        class="mention-picker"
        :style="pickerStyle"
        @mousedown.prevent
        @pointerdown="pickerPress = true"
        @pointerup="releasePicker"
        @pointercancel="releasePicker"
      >
        <div v-for="group in visibleGroups" :key="group.type" class="picker-group">
          <div class="picker-group-title">{{ group.title }}</div>
          <div
            v-for="opt in group.items"
            :key="`${opt.type}:${opt.name}`"
            class="picker-item"
            :class="{ active: highlightIndex === indexOf(opt) }"
            @click="selectOption(opt)"
          >
            <span class="picker-dot" :class="`picker-dot--${opt.type}`" />
            <span class="picker-name">{{ opt.name }}</span>
            <span v-if="opt.durationSec" class="picker-meta">{{ opt.durationSec.toFixed(1) }}s</span>
            <span v-else-if="opt.type === 'text'" class="picker-meta">{{ opt.text?.trim() ? '文本' : '待填写' }}</span>
            <span v-else-if="!opt.url" class="picker-meta">待生成</span>
          </div>
        </div>
        <div v-if="uploadFn" class="picker-item picker-upload" @click="handlePickLocalFile">
          <el-icon :size="14"><Plus /></el-icon>
          <span>{{ uploadLabel }}</span>
        </div>
        <div v-if="!hasPickerContent" class="picker-empty">暂无可引用项，请先添加素材或上传文件</div>
      </div>
    </Teleport>

    <input ref="fileInputRef" type="file" :accept="ASSET_UPLOAD_ACCEPT" multiple class="hidden-file-input" @change="onFileChosen" />

    <Teleport to="body">
      <div
        v-if="hoverSeg"
        :key="hoverSeg.start"
        class="mention-hover-tip"
        :class="{ 'is-enterable': hoverSeg.kind === 'audio', 'is-below': hoverBelow }"
        :style="hoverStyle"
        @mouseenter="onTipEnter"
        @mouseleave="onTipLeave"
      >
        <img v-if="hoverSeg.url && hoverSeg.kind === 'image'" :src="hoverSeg.url" class="mention-tooltip-media" />
        <video v-else-if="hoverSeg.url && hoverSeg.kind === 'audio'" :src="hoverSeg.url" class="mention-tooltip-audio" controls />
        <video v-else-if="hoverSeg.url" :src="hoverSeg.url" class="mention-tooltip-media" muted autoplay loop playsinline />
        <span v-else-if="hoverSeg.text_" class="mention-tooltip-text">{{ hoverSeg.text_ }}</span>
        <span v-else>暂无可预览媒体</span>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onBeforeUnmount } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ASSET_UPLOAD_ACCEPT } from '@/api/video'
import { scanMentions } from '@/utils/mentions'

/** 素材库三类素材 + 分镜视频；决定分组归属与预览方式，不靠扩展名猜测 */
export type MentionOptionType = 'image' | 'video' | 'audio' | 'shot' | 'text'

export interface MentionOption {
  name: string
  type: MentionOptionType
  /** 预览地址；尚未生成成功时为空（仍可引用，供顺序生成先写好 @） */
  url?: string
  /** 视频/音频时长（秒） */
  durationSec?: number
  /** 文本引用（无限画布的文本节点）：悬浮时直接显示这段文字 */
  text?: string
}

const GROUP_TITLES: Record<MentionOptionType, string> = {
  image: '图片素材',
  video: '视频素材',
  audio: '音频素材',
  shot: '分镜视频',
  text: '文本',
}

const props = withDefaults(defineProps<{
  modelValue?: string
  options: MentionOption[]
  placeholder?: string
  rows?: number
  readonly?: boolean
  /** 本地上传的处理函数（由父组件绑定 projectId/shotId），返回新增引用的名称 */
  uploadFn?: (file: File) => Promise<{ name: string }>
}>(), {
  modelValue: '',
  rows: 3,
  readonly: false,
})
const emit = defineEmits<{ 'update:modelValue': [value: string]; blur: [] }>()

const textValue = computed(() => props.modelValue ?? '')

const rootRef = ref<HTMLElement>()
const textareaRef = ref<HTMLTextAreaElement>()
const highlightRef = ref<HTMLDivElement>()
const pickerRef = ref<HTMLElement>()
const fileInputRef = ref<HTMLInputElement>()
const uploading = ref(false)
const uploadIndex = ref(0)
const uploadTotal = ref(0)
const uploadLabel = computed(() => {
  if (!uploading.value) return '上传本地素材'
  if (uploadTotal.value > 1) return `上传中 ${uploadIndex.value}/${uploadTotal.value}…`
  return '上传中…'
})
const showPicker = ref(false)
const query = ref('')
const mentionStart = ref(0)
const highlightIndex = ref(0)
const pickerStyle = ref<Record<string, string>>({})
const composing = ref(false)
let blurTimer: ReturnType<typeof setTimeout> | undefined
let pickerPress = false

function updatePickerPosition() {
  const el = rootRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const viewport = window.visualViewport
  const leftEdge = viewport?.offsetLeft ?? 0
  const topEdge = viewport?.offsetTop ?? 0
  const screenWidth = viewport?.width ?? window.innerWidth
  const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight)
  const width = Math.min(260, Math.max(rect.width, 200), screenWidth - 16)
  const left = Math.min(rect.left, leftEdge + screenWidth - width - 8)
  const spaceBelow = bottomEdge - rect.bottom - 12
  const spaceAbove = rect.top - topEdge - 12
  const placeAbove = spaceBelow < 240 && spaceAbove > spaceBelow
  const height = Math.max(40, Math.min(280, placeAbove ? spaceAbove : spaceBelow))
  const pickerHeight = Math.min(height, pickerRef.value?.scrollHeight ?? height)
  pickerStyle.value = {
    position: 'fixed',
    top: placeAbove ? `${Math.max(topEdge + 8, rect.top - pickerHeight - 4)}px` : `${rect.bottom + 4}px`,
    left: `${Math.max(leftEdge + 8, left)}px`,
    width: `${width}px`,
    maxHeight: `${height}px`,
    zIndex: '5000',
  }
}

watch(showPicker, (open) => {
  if (!open) return
  nextTick(updatePickerPosition)
  window.addEventListener('scroll', updatePickerPosition, true)
  window.addEventListener('resize', updatePickerPosition)
  window.visualViewport?.addEventListener('resize', updatePickerPosition)
  window.visualViewport?.addEventListener('scroll', updatePickerPosition)
})

onBeforeUnmount(() => {
  if (blurTimer) clearTimeout(blurTimer)
  clearShowTimer()
  clearHideTimer()
  closePicker()
  window.removeEventListener('scroll', hideHoverOnScroll, true)
})

const visibleGroups = computed(() =>
  (Object.keys(GROUP_TITLES) as MentionOptionType[])
    .map((type) => ({
      type,
      title: GROUP_TITLES[type],
      items: filterByQuery(props.options.filter((o) => o.type === type)),
    }))
    .filter((group) => group.items.length),
)
const flatFiltered = computed(() => visibleGroups.value.flatMap((group) => group.items))
const hasPickerContent = computed(() => flatFiltered.value.length > 0 || !!props.uploadFn)
const indexOf = (opt: MentionOption) => flatFiltered.value.indexOf(opt)

function filterByQuery(list: MentionOption[]) {
  if (!query.value) return list
  return list.filter((o) => o.name.toLowerCase().includes(query.value.toLowerCase()))
}

// ─── 文本高亮分段：已知名称按最长前缀匹配，后面没有空格也能标出来 ──
interface Segment {
  text: string
  isMention: boolean
  kind?: MentionOptionType
  url?: string
  text_?: string
  start: number
  end: number
}
const segments = computed<Segment[]>(() => {
  const text = textValue.value
  const byName = new Map(props.options.map((o) => [o.name, o]))
  const hits = scanMentions(text, props.options.map((o) => o.name)).filter((hit) => hit.known && byName.has(hit.name))
  const result: Segment[] = []
  let lastIndex = 0
  for (const hit of hits) {
    if (hit.start > lastIndex) {
      result.push({ text: text.slice(lastIndex, hit.start), isMention: false, start: lastIndex, end: hit.start })
    }
    const opt = byName.get(hit.name)!
    result.push({
      text: text.slice(hit.start, hit.end),
      isMention: true,
      kind: opt.type,
      url: opt.url,
      text_: opt.text,
      start: hit.start,
      end: hit.end,
    })
    lastIndex = hit.end
  }
  if (lastIndex < text.length || !result.length) {
    result.push({ text: text.slice(lastIndex), isMention: false, start: lastIndex, end: text.length })
  }
  return result
})

const hoverStart = ref<number | null>(null)
const hoverBelow = ref(false)
const hoverStyle = ref<Record<string, string>>({})
const tipHovering = ref(false)
const hoverSeg = computed(() => segments.value.find((seg) => seg.isMention && seg.start === hoverStart.value) ?? null)
let showTimer: ReturnType<typeof setTimeout> | undefined
let hideTimer: ReturnType<typeof setTimeout> | undefined
let pendingStart: number | null = null
let suppressLeave = false

function clearShowTimer() {
  if (!showTimer) return
  clearTimeout(showTimer)
  showTimer = undefined
}

function clearHideTimer() {
  if (!hideTimer) return
  clearTimeout(hideTimer)
  hideTimer = undefined
}

function hideHoverNow() {
  clearShowTimer()
  clearHideTimer()
  hoverStart.value = null
  pendingStart = null
  tipHovering.value = false
}

function hideHoverOnScroll() {
  if (hoverStart.value == null && pendingStart == null) return
  hideHoverNow()
}

window.addEventListener('scroll', hideHoverOnScroll, true)

function scheduleHide() {
  if (suppressLeave || tipHovering.value) return
  clearShowTimer()
  pendingStart = null
  if (hideTimer) return
  const delay = hoverSeg.value?.kind === 'audio' ? 220 : 60
  hideTimer = setTimeout(hideHoverNow, delay)
}

function placeHoverTip(chip: HTMLElement, x: number, y: number) {
  const rects = [...chip.getClientRects()]
  const rect = rects.find((item) => x >= item.left - 2 && x <= item.right + 2 && y >= item.top - 2 && y <= item.bottom + 2) ?? rects[0]
  if (!rect) return
  const center = Math.min(window.innerWidth - 24, Math.max(24, rect.left + rect.width / 2))
  const below = rect.top < 150
  hoverBelow.value = below
  hoverStyle.value = {
    left: `${center}px`,
    top: `${below ? rect.bottom : rect.top}px`,
  }
}

function chipFromPoint(x: number, y: number): HTMLElement | null {
  const hl = highlightRef.value
  if (!hl) return null
  const direct = findChip(document.elementsFromPoint(x, y), hl)
  if (direct) return direct
  const ta = textareaRef.value
  if (!ta) return null
  // 输入框盖在高亮层上面，短暂让开，才能根据光标落点找到下面的 @ 标签
  suppressLeave = true
  const prevTa = ta.style.pointerEvents
  const prevHl = hl.style.pointerEvents
  ta.style.pointerEvents = 'none'
  hl.style.pointerEvents = 'auto'
  const probed = chipFromCaret(x, y, hl) ?? findChip(document.elementsFromPoint(x, y), hl)
  ta.style.pointerEvents = prevTa
  hl.style.pointerEvents = prevHl
  setTimeout(() => { suppressLeave = false }, 0)
  return probed
}

function chipFromCaret(x: number, y: number, root: HTMLElement): HTMLElement | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const pos = doc.caretPositionFromPoint?.(x, y)
  const range = pos ? null : doc.caretRangeFromPoint?.(x, y)
  let node: Node | null = pos?.offsetNode ?? range?.startContainer ?? null
  const offset = pos?.offset ?? range?.startOffset ?? 0
  if (node instanceof Element) {
    node = node.childNodes[offset] ?? node.childNodes[offset - 1] ?? node
  }
  if (!node || !root.contains(node)) return null
  const el = node instanceof Element ? node : node.parentElement
  const chip = el?.closest('.mention-chip')
  return chip instanceof HTMLElement ? chip : null
}

function findChip(stack: Element[], root: HTMLElement): HTMLElement | null {
  for (const el of stack) {
    if (!(el instanceof HTMLElement)) continue
    const chip = el.closest('.mention-chip')
    if (chip instanceof HTMLElement && root.contains(chip)) return chip
  }
  return null
}

function onEditorMouseMove(e: MouseEvent) {
  const target = e.target instanceof Element ? e.target.closest('.mention-chip') : null
  const chip = target instanceof HTMLElement && highlightRef.value?.contains(target)
    ? target
    : chipFromPoint(e.clientX, e.clientY)
  if (!chip) {
    scheduleHide()
    return
  }
  const start = Number(chip.dataset.mentionAt)
  const seg = segments.value.find((item) => item.isMention && item.start === start)
  if (!seg) {
    scheduleHide()
    return
  }
  clearHideTimer()
  placeHoverTip(chip, e.clientX, e.clientY)
  if (hoverStart.value === seg.start || pendingStart === seg.start) return
  pendingStart = seg.start
  clearShowTimer()
  if (hoverStart.value != null) {
    hoverStart.value = seg.start
    return
  }
  showTimer = setTimeout(() => {
    hoverStart.value = seg.start
    showTimer = undefined
  }, 150)
}

function onEditorMouseLeave() {
  if (suppressLeave) return
  scheduleHide()
}

function onTipEnter() {
  tipHovering.value = true
  clearHideTimer()
}

function onTipLeave() {
  tipHovering.value = false
  scheduleHide()
}

function syncScroll(e: Event) {
  const el = e.target as HTMLTextAreaElement
  if (highlightRef.value) {
    highlightRef.value.scrollTop = el.scrollTop
    highlightRef.value.scrollLeft = el.scrollLeft
  }
  hideHoverOnScroll()
}

// ─── 输入 & @ 触发检测 ──────────────────────────────────────
function handleInput(e: Event) {
  const el = e.target as HTMLTextAreaElement
  emit('update:modelValue', el.value)
  if (!composing.value) updatePickerFromCaret(el)
  nextTick(() => syncScroll(e))
}

function handleKeyup(e: KeyboardEvent) {
  if (composing.value) return
  if (e.key === '@' || e.key === '＠' || e.key.length === 1) {
    updatePickerFromCaret(e.target as HTMLTextAreaElement)
  }
}

function handleCompositionEnd(e: CompositionEvent) {
  composing.value = false
  const el = e.target as HTMLTextAreaElement
  emit('update:modelValue', el.value)
  updatePickerFromCaret(el)
}

function syncCaret(e: Event) {
  if (!composing.value) updatePickerFromCaret(e.target as HTMLTextAreaElement)
}

/** 以最后一个 @/＠ 为准触发选择器，避免复杂正则在中文输入法下失效 */
function updatePickerFromCaret(el: HTMLTextAreaElement) {
  const caret = el.selectionStart ?? el.value.length
  const uptoCaret = el.value.slice(0, caret)
  const at = Math.max(uptoCaret.lastIndexOf('@'), uptoCaret.lastIndexOf('＠'))
  if (at < 0) {
    closePicker()
    return
  }
  const queryText = uptoCaret.slice(at + 1)
  // 查询段一旦出现空白或再次 @，说明已离开 mention 输入态
  if (/[\s@＠]/.test(queryText)) {
    closePicker()
    return
  }
  mentionStart.value = at
  query.value = queryText
  showPicker.value = true
  highlightIndex.value = 0
  nextTick(updatePickerPosition)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.isComposing || e.key === 'Process') {
    composing.value = true
    return
  }
  if (e.key === '@' || e.key === '＠') {
    // 等字符写入后再打开；keydown 阶段 value 可能尚未包含 @
    nextTick(() => {
      const el = textareaRef.value
      if (el) updatePickerFromCaret(el)
    })
  }
  if (!showPicker.value) return
  const total = flatFiltered.value.length + (props.uploadFn ? 1 : 0)
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    highlightIndex.value = (highlightIndex.value + 1) % Math.max(total, 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    highlightIndex.value = (highlightIndex.value - 1 + total) % Math.max(total, 1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const opt = flatFiltered.value[highlightIndex.value]
    if (opt) selectOption(opt)
    else if (props.uploadFn) handlePickLocalFile()
  } else if (e.key === 'Escape') {
    closePicker()
  }
}

function closePicker() {
  showPicker.value = false
  pickerPress = false
  window.removeEventListener('scroll', updatePickerPosition, true)
  window.removeEventListener('resize', updatePickerPosition)
  window.visualViewport?.removeEventListener('resize', updatePickerPosition)
  window.visualViewport?.removeEventListener('scroll', updatePickerPosition)
}

function releasePicker() {
  pickerPress = false
  if (document.activeElement !== textareaRef.value) {
    if (blurTimer) clearTimeout(blurTimer)
    blurTimer = setTimeout(closePicker, 180)
  }
}

function handleBlur() {
  composing.value = false
  // 延迟关闭，保证 mousedown 选中弹层选项时不会先于 click 触发的逻辑被 blur 打断
  if (blurTimer) clearTimeout(blurTimer)
  blurTimer = setTimeout(() => { if (!pickerPress) closePicker() }, 180)
  emit('blur')
}

// ─── 插入 @提及 ──────────────────────────────────────────────
function selectOption(opt: MentionOption) {
  insertMentionText(opt.name)
}

function insertMentionText(name: string | string[]) {
  const names = (Array.isArray(name) ? name : [name]).filter(Boolean)
  if (!names.length) return
  const text = textValue.value
  const caret = mentionStart.value + 1 + query.value.length
  const before = text.slice(0, mentionStart.value)
  const after = text.slice(caret)
  const inserted = names.map((item) => `@${item}`).join(' ') + ' '
  emit('update:modelValue', before + inserted + after)
  closePicker()
  nextTick(() => {
    const el = textareaRef.value
    if (!el) return
    const pos = before.length + inserted.length
    el.focus()
    el.setSelectionRange(pos, pos)
  })
}

// ─── 本地上传 ────────────────────────────────────────────────
function handlePickLocalFile() {
  fileInputRef.value?.click()
}

async function onFileChosen(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (!files.length || !props.uploadFn) return
  uploading.value = true
  uploadTotal.value = files.length
  uploadIndex.value = 0
  const names: string[] = []
  try {
    for (const file of files) {
      uploadIndex.value += 1
      try {
        const ref = await props.uploadFn(file)
        names.push(ref.name)
      } catch {
        // 具体的格式/大小/时长超限原因由 request 拦截器统一提示
      }
    }
    insertMentionText(names)
    if (!names.length) closePicker()
  } finally {
    uploading.value = false
    uploadTotal.value = 0
    uploadIndex.value = 0
  }
}
</script>

<style scoped>
.mention-input { position: relative; }
.mention-editor { position: relative; }

/* 高亮层是 textarea 的镜像：可见文字在上层，光标在下层。两边盒模型/字体/换行必须逐像素一致，
   否则光标会和文字错位。@提及 只能改颜色/背景，不能改字重、padding，也不能变成 inline-block。 */
.mention-highlight, .mention-textarea {
  box-sizing: border-box; width: 100%; min-width: 0; margin: 0; padding: 9px 30px 9px 11px;
  border: 1px solid transparent; border-radius: 8px;
  font-family: inherit; font-size: 13px; font-weight: 400; font-style: normal;
  font-kerning: none; line-height: 21px; letter-spacing: 0; text-indent: 0;
  white-space: pre-wrap; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word;
  scrollbar-gutter: stable;
}
.mention-editor { background: var(--color-card); border-radius: 8px; }
.mention-highlight {
  position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none;
  color: var(--color-text-primary); background: transparent;
}
.mention-chip {
  display: inline; margin: 0; padding: 0; border: 0; border-radius: 3px;
  background: var(--color-info-soft); color: var(--color-primary); font: inherit; line-height: inherit; vertical-align: baseline;
  pointer-events: auto; cursor: default;
  box-decoration-break: clone; -webkit-box-decoration-break: clone;
}
.mention-tooltip-media { display: block; width: 160px; max-height: 120px; object-fit: contain; border-radius: 6px; background: #111; }
/* 音频用原生控件播放，需保持可交互（tooltip 对音频项设为 enterable） */
.mention-tooltip-audio { display: block; width: 200px; height: 40px; }
.mention-textarea {
  display: block; position: relative; z-index: 1; resize: vertical; outline: none;
  color: transparent; background: transparent; caret-color: #303133; border-color: var(--color-border);
  overflow-x: hidden; overflow-y: auto; transition: border-color .2s;
}
.mention-textarea::selection { background: rgba(99, 102, 241, .28); }
.mention-textarea:focus { border-color: var(--color-primary-light); }
.mention-textarea::placeholder { color: var(--color-text-tertiary); }
.hidden-file-input { display: none; }
@media (max-width: 960px) {
  .mention-editor .mention-textarea, .mention-editor .mention-highlight { font-size: 16px; }
}
</style>

<!-- Teleport 到 body 后不受 scoped 影响，弹层样式挂在 .mention-picker 下避免全局污染 -->
<style>
.mention-picker {
  max-height: 280px; overflow-y: auto;
  background: var(--color-card); border: 1px solid var(--color-border); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.12); padding: 6px;
}
.mention-picker .picker-group + .picker-group { margin-top: 4px; border-top: 1px solid var(--color-border); padding-top: 4px; }
.mention-picker .picker-group-title { font-size: 11px; color: var(--color-text-tertiary); padding: 4px 8px 2px; }
.mention-picker .picker-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; color: var(--color-text-primary); }
.mention-picker .picker-item:hover,
.mention-picker .picker-item.active { background: var(--color-info-soft); }
.mention-picker .picker-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.mention-picker .picker-dot--image { background: var(--color-primary); }
.mention-picker .picker-dot--video { background: var(--color-warning); }
.mention-picker .picker-dot--audio { background: var(--color-primary-light); }
.mention-picker .picker-dot--shot { background: var(--color-primary); }
.mention-picker .picker-dot--text { background: var(--color-text-tertiary); }
.mention-tooltip-text { display: block; max-width: 260px; max-height: 160px; overflow: hidden; white-space: pre-wrap; line-height: 1.6; }
.mention-picker .picker-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mention-picker .picker-meta { font-size: 11px; color: var(--color-text-tertiary); flex-shrink: 0; }
.mention-picker .picker-upload { color: var(--color-primary-light); border-top: 1px solid var(--color-border); margin-top: 4px; padding-top: 8px; }
.mention-picker .picker-empty { padding: 10px 8px; font-size: 12px; color: var(--color-text-tertiary); text-align: center; }
@media (max-width: 960px) {
  .mention-picker .picker-item { min-height: 36px; }
}
.mention-hover-tip {
  position: fixed; z-index: 8000; transform: translate(-50%, calc(-100% - 8px));
  max-width: min(280px, calc(100vw - 24px)); padding: 8px; border-radius: 8px;
  background: #303133; color: #fff; box-shadow: 0 6px 16px rgba(0, 0, 0, .18); pointer-events: none;
}
.mention-hover-tip.is-below { transform: translate(-50%, 8px); }
.mention-hover-tip::before {
  content: ''; position: absolute; left: 50%; bottom: -5px; transform: translateX(-50%);
  border: 5px solid transparent; border-top-color: #303133; border-bottom: 0;
}
.mention-hover-tip.is-below::before { top: -5px; bottom: auto; border-top: 0; border-bottom-color: #303133; }
.mention-hover-tip.is-enterable { pointer-events: auto; }
.mention-hover-tip.is-enterable::after { content: ''; position: absolute; left: 0; right: 0; height: 14px; }
.mention-hover-tip.is-enterable:not(.is-below)::after { top: 100%; }
.mention-hover-tip.is-enterable.is-below::after { bottom: 100%; }
.mention-tooltip-media { display: block; width: 160px; max-height: 120px; object-fit: contain; border-radius: 6px; background: #111; }
.mention-tooltip-audio { display: block; width: 200px; height: 40px; }
.mention-tooltip-text { display: block; max-width: 260px; max-height: 160px; overflow: hidden; white-space: pre-wrap; line-height: 1.6; }
</style>
