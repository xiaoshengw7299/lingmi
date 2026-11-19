<template>
  <div class="file-slot">
    <div class="slot-label">
      <span>{{ input.label }}</span>
      <em v-if="input.optional">可选</em>
      <small v-if="max > 1">{{ files.length }} / {{ max }}</small>
    </div>

    <div
      v-if="!adding && files.length < max"
      class="drop"
      :class="{ 'is-over': over }"
      role="button"
      tabindex="0"
      @click="picker?.click()"
      @keydown.enter.prevent="picker?.click()"
      @keydown.space.prevent="picker?.click()"
      @dragover.prevent="over = true"
      @dragleave="over = false"
      @drop.prevent="onDrop"
    >
      <el-icon :size="26"><UploadFilled /></el-icon>
      <div>
        <strong>点击或拖入{{ kindText }}</strong>
        <p>{{ input.hint }}{{ max > 1 ? ` · 可多选，按顺序排列` : '' }}</p>
      </div>
    </div>
    <input ref="picker" type="file" class="hidden-input" :accept="accept" :multiple="max > 1" @change="onPick" />

    <ul v-if="files.length || pending.length" class="file-list">
      <li v-for="(file, i) in files" :key="file.fileId">
        <div class="file-preview">
          <img v-if="file.kind === 'image' && file.previewUrl" :src="file.previewUrl" alt="" />
          <video v-else-if="file.kind === 'video' && file.previewUrl" :src="`${file.previewUrl}#t=0.5`" muted playsinline preload="metadata" />
          <el-icon v-else :size="18"><component :is="ICON[file.kind]" /></el-icon>
        </div>
        <div class="file-meta">
          <b :title="file.name">{{ max > 1 ? `${i + 1}. ` : '' }}{{ file.name }}</b>
          <span>{{ metaText(file) }}</span>
        </div>
        <el-button text :icon="Close" aria-label="移除" @click="remove(i)" />
      </li>
      <li v-for="item in pending" :key="item.id" class="is-pending">
        <div class="file-preview"><el-icon class="is-loading" :size="18"><Loading /></el-icon></div>
        <div class="file-meta">
          <b>{{ item.name }}</b>
          <el-progress :percentage="item.percent" :stroke-width="4" :show-text="false" />
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Close, Loading, UploadFilled } from '@element-plus/icons-vue'
import { clock, kindOf, probeMedia, uploadToMediaKit, withMediaType, type InputFile, type InputKind, type ToolInput } from '@/api/media-tools'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ input: ToolInput; modelValue: InputFile[] }>()
const emit = defineEmits<{ 'update:modelValue': [InputFile[]]; busy: [boolean] }>()

const KIND_TEXT: Record<InputKind, string> = { video: '视频', audio: '音频', image: '图片', subtitle: '字幕文件' }
const KIND_ACCEPT: Record<InputKind, string> = { video: 'video/*', audio: 'audio/*', image: 'image/*', subtitle: '.srt,.ass' }
const ICON: Record<InputKind, string> = { video: 'VideoCamera', audio: 'Headset', image: 'Picture', subtitle: 'Document' }

const auth = useAuthStore()
const picker = ref<HTMLInputElement>()
const over = ref(false)
const adding = ref(false)
const pending = reactive<Array<{ id: number; name: string; percent: number }>>([])
let nextUploadId = 0
let disposed = false

const files = computed(() => props.modelValue ?? [])
const max = computed(() => props.input.max ?? 1)
const kindText = computed(() => props.input.kinds.map((k) => KIND_TEXT[k]).join('或'))
const accept = computed(() => props.input.accept ?? props.input.kinds.map((k) => KIND_ACCEPT[k]).join(','))

function metaText(file: InputFile) {
  return [file.durationSec ? clock(file.durationSec) : '', file.width ? `${file.width}×${file.height}` : ''].filter(Boolean).join(' · ') || KIND_TEXT[file.kind]
}

function onPick(e: Event) {
  const target = e.target as HTMLInputElement
  void add([...(target.files ?? [])])
  target.value = ''
}

function onDrop(e: DragEvent) {
  over.value = false
  void add([...(e.dataTransfer?.files ?? [])])
}

async function add(list: File[]) {
  if (!list.length || adding.value || !auth.ensureLoggedIn()) return
  const room = max.value - files.value.length
  if (list.length > room) ElMessage.warning(`${props.input.label}最多 ${max.value} 个，多出来的已忽略`)
  const accepted = list.slice(0, Math.max(0, room))
  adding.value = true
  emit('busy', true)
  try {
    // 并行上传，按选择顺序落位，剧集类输入的顺序就是集数
    const uploaded = (await Promise.all(accepted.map((file) => upload(withMediaType(file))))).filter((item): item is InputFile => !!item)
    if (disposed) uploaded.forEach(revokePreview)
    else emit('update:modelValue', [...files.value, ...uploaded])
  } finally {
    adding.value = false
    if (!disposed) emit('busy', false)
  }
}

async function upload(file: File): Promise<InputFile | null> {
  const kind = kindOf(file)
  if (!kind || !props.input.kinds.includes(kind)) {
    ElMessage.warning(`${file.name} 不是${kindText.value}`)
    return null
  }
  const previewUrl = URL.createObjectURL(file)
  const item = reactive({ id: ++nextUploadId, name: file.name, percent: 0 })
  pending.push(item)
  try {
    const meta = await probeMedia(previewUrl, kind)
    const limit = props.input.maxDurationSec
    if (disposed) {
      URL.revokeObjectURL(previewUrl)
      return null
    }
    if (limit && meta.durationSec && meta.durationSec > limit + 1) {
      URL.revokeObjectURL(previewUrl)
      ElMessage.warning(`${file.name} 时长 ${clock(meta.durationSec)}，超过上限 ${clock(limit)}`)
      return null
    }
    const fileId = await uploadToMediaKit(file, (percent) => (item.percent = percent))
    return { fileId, name: file.name, kind, previewUrl, ...meta }
  } catch {
    URL.revokeObjectURL(previewUrl)
    ElMessage.error(`${file.name} 上传失败，请重试`)
    return null
  } finally {
    pending.splice(pending.indexOf(item), 1)
  }
}

function remove(index: number) {
  const next = [...files.value]
  const [removed] = next.splice(index, 1)
  if (removed) revokePreview(removed)
  emit('update:modelValue', next)
}

function revokePreview(file: InputFile) {
  if (file.previewUrl) URL.revokeObjectURL(file.previewUrl)
}

onBeforeUnmount(() => {
  disposed = true
  if (adding.value) emit('busy', false)
})
</script>

<style scoped>
.file-slot { margin-bottom: 16px; }
.slot-label { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 13px; font-weight: 650; color: var(--color-text-primary); }
.slot-label em { font-style: normal; font-size: 11px; font-weight: 500; padding: 1px 6px; border-radius: 999px; background: var(--color-bg-secondary); color: var(--color-text-tertiary); }
.slot-label small { margin-left: auto; font-size: 12px; font-weight: 500; color: var(--color-text-tertiary); }

.drop {
  display: flex; align-items: center; gap: 14px; padding: 18px 16px; border-radius: 14px; cursor: pointer;
  border: 1.5px dashed color-mix(in srgb, var(--color-primary) 35%, transparent);
  background: color-mix(in srgb, var(--color-primary) 4%, transparent); color: var(--color-primary); transition: var(--transition);
}
.drop:hover, .drop.is-over { border-color: var(--color-primary); background: var(--color-primary-soft); }
.drop strong { display: block; font-size: 13.5px; color: var(--color-text-primary); }
.drop p { margin-top: 2px; font-size: 12px; color: var(--color-text-tertiary); }

.file-list { list-style: none; margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.file-list li { display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 8px; border-radius: 12px; background: var(--color-bg-secondary); }
.file-preview { width: 52px; height: 36px; flex-shrink: 0; display: grid; place-items: center; overflow: hidden; border-radius: 8px; background: var(--color-card); color: var(--color-text-tertiary); }
.file-preview img, .file-preview video { width: 100%; height: 100%; object-fit: cover; }
.file-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.file-meta b { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-meta span { font-size: 12px; color: var(--color-text-tertiary); }
.is-pending .file-meta b { color: var(--color-text-secondary); }
</style>
