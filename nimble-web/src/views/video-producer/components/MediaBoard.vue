<template>
  <section class="media-board" :class="{ 'is-locked': locked, 'is-readonly': readonly }">
    <p v-if="!items.length" class="board-empty-hint">{{ emptyText }}</p>

    <div
      v-if="items.length"
      ref="gridRef"
      class="board-grid"
      :class="{ 'is-sortable': canSort }"
    >
      <div
        v-for="item in items" :key="item.id"
        class="asset-card"
        :class="{ 'is-selected': isSelected(item), 'is-selecting': selectable, 'has-corner': showCorner }"
        :data-id="item.id"
      >
        <CardCorner
          v-if="showCorner"
          :sortable="canSort"
          :delete-disabled="locked || isPending(item)"
          :asset="assetSaveTarget(item)"
          @delete="$emit('delete', item)"
        />
        <div class="asset-preview" :class="{ 'is-audio': item.kind === 'audio' }" :style="previewStyle(item)">
          <el-image
            v-if="item.kind === 'image' && item.url"
            :key="`img-${item.url}`"
            :src="item.url"
            fit="contain"
            :preview-src-list="selectable ? undefined : previewSrcList(item)"
            preview-teleported
            :z-index="4000"
          />
          <video v-else-if="item.kind === 'video' && item.url" :key="`vid-${item.url}`" :src="item.url" controls playsinline preload="none" />
          <audio v-else-if="item.kind === 'audio' && item.url" :key="`aud-${item.url}`" :src="item.url" controls preload="none" />
          <p v-else-if="item.kind === 'text'" class="preview-text">{{ item.text?.trim() || '还没有正文' }}</p>
          <div v-else class="preview-placeholder">
            <el-icon :size="20"><component :is="KIND_ICON[item.kind]" /></el-icon>
          </div>
          <StatusTag v-if="item.status !== 'idle'" class="status-overlay" :status="item.status" :error="item.error" mini />
          <button
            v-if="selectable && item.kind === 'image' && item.source === 'generated'"
            type="button"
            class="select-hitbox"
            :disabled="!canSelect(item)"
            :title="canSelect(item) ? (isSelected(item) ? '取消选择' : '选择此项') : '请先填写特征提示词'"
            @click.stop="canSelect(item) && $emit('toggle-select', item.id)"
          >
            <span class="select-check" :class="{ checked: isSelected(item), disabled: !canSelect(item) }">
              <el-icon v-if="isSelected(item)" :size="12"><Check /></el-icon>
            </span>
          </button>
        </div>
        <p v-if="item.status === 'failed'" class="asset-error" :title="item.error || ''">
          {{ item.error || '参考图生成失败' }}
        </p>
        <div class="asset-fields">
          <div class="asset-heading">
            <span class="kind-badge" :class="`kind-badge--${item.kind}`">{{ ASSET_KIND_META[item.kind].label }}</span>
            <el-input
              v-model="item.name" size="small" class="asset-name" :placeholder="namePlaceholder"
              :disabled="readonly"
              @input="$emit('dirty', item.id)" @blur="$emit('update', item)"
            />
            <VideoShareButton v-if="shareProjectId && item.kind === 'video' && item.url" :source="readonly ? 'video-example' : 'project'" :id="shareProjectId" :video="item.url" :title="item.name" compact />
          </div>

          <!-- AI 生成的图片素材：可选模型、写提示词、出图 -->
          <template v-if="item.kind === 'image' && item.source === 'generated'">
            <ModelPicker
              :model-id="item.modelId"
              :lora="item.lora"
              :models="models"
              :ratio="item.ratio"
              :resolution="item.resolution"
              :output-format="item.outputFormat"
              :prompt-optimize-mode="item.promptOptimizeMode"
              :disabled="readonly || locked || isPending(item)"
              @update:model-id="(v) => handleModelId(item, v)"
              @update:lora="(v) => { item.lora = v; $emit('dirty', item.id) }"
              @update:ratio="(v) => { item.ratio = v; $emit('dirty', item.id) }"
              @update:resolution="(v) => { item.resolution = v; $emit('dirty', item.id) }"
              @update:output-format="(v) => { item.outputFormat = v; $emit('dirty', item.id) }"
              @update:prompt-optimize-mode="(v) => { item.promptOptimizeMode = v; $emit('dirty', item.id) }"
              @change="$emit('update', item)"
            />
            <PromptField
              v-model="item.prompt"
              :rows="2"
              :options="optionsFor(item)"
              :upload-fn="uploadFn"
              :placeholder="promptPlaceholder"
              :dialog-title="promptDialogTitle"
              :readonly="readonly"
              @update:model-value="$emit('dirty', item.id)"
              @blur="$emit('update', item)"
            />
            <el-button
              v-if="!readonly && !selectable"
              size="small" class="w-full"
              :loading="isPending(item)"
              :disabled="isPending(item) || !item.prompt.trim()"
              :title="item.prompt.trim() ? undefined : '请先填写特征提示词'"
              @click="$emit('generate', item.id)"
            >{{ item.url ? '重新生成参考图' : '生成参考图' }}</el-button>
          </template>

          <template v-else-if="item.kind === 'text'">
            <PromptField
              v-model="item.text"
              :rows="3"
              :options="optionsFor(item)"
              :placeholder="'正文。分镜里输入 @' + item.name + ' 即可引用'"
              dialog-title="编辑文本"
              dialog-tip="这段文字会在分镜提示词里通过 @名称 被引用"
              :readonly="readonly"
              @update:model-value="$emit('dirty', item.id)"
              @blur="$emit('update', item)"
            />
            <PromptField
              v-model="item.prompt"
              :rows="2"
              :options="optionsFor(item)"
              placeholder="让 AI 写什么；留空则只使用上面的手写正文"
              dialog-title="生成要求"
              dialog-tip="生成会覆盖当前正文。输入 @ 可引用其它素材"
              :readonly="readonly || locked || isPending(item)"
              @update:model-value="$emit('dirty', item.id)"
              @blur="$emit('update', item)"
            />
            <el-button
              v-if="!readonly && !selectable"
              size="small" class="w-full"
              :loading="isPending(item)"
              :disabled="isPending(item) || !item.prompt.trim()"
              :title="item.prompt.trim() ? undefined : '请先填写生成要求'"
              @click="$emit('generate', item.id)"
            >{{ item.text?.trim() ? '重新生成正文' : '生成正文' }}</el-button>
          </template>

          <!-- 上传素材：提示词只是备注，文件通过替换更新 -->
          <template v-else>
            <el-input
              v-model="item.prompt" size="small" type="textarea" :rows="2" resize="none"
              class="asset-note"
              :placeholder="uploadedNotePlaceholder(item)"
              :disabled="readonly"
              @input="$emit('dirty', item.id)" @blur="$emit('update', item)"
            />
            <p v-if="item.durationSec" class="asset-meta">时长 {{ item.durationSec.toFixed(1) }} 秒</p>
            <el-button
              v-if="replaceFn && !readonly && !selectable"
              size="small" class="w-full"
              :loading="replacingId === item.id"
              :disabled="locked || replacingId === item.id"
              @click="triggerReplace(item)"
            >替换{{ ASSET_KIND_META[item.kind].label }}</el-button>
          </template>
        </div>
      </div>
    </div>
    <input ref="replaceInput" type="file" :accept="replaceAccept" hidden @change="handleReplaceChange" />
  </section>
</template>

<script setup lang="ts">
import VideoShareButton from '@/components/VideoShareButton.vue'
import { computed, ref } from 'vue'
import { Picture, VideoCamera, Headset, Document, Check } from '@element-plus/icons-vue'
import StatusTag from './StatusTag.vue'
import PromptField from './PromptField.vue'
import ModelPicker from './ModelPicker.vue'
import CardCorner from './CardCorner.vue'
import type { MentionOption } from './MentionInput.vue'
import { useSortableList } from '../use-sortable-list'
import {
  ASSET_KIND_META, REFERENCE_CLIP_MAX_SEC, REFERENCE_CLIP_MIN_SEC,
  clampMediaOutputFormat, clampMediaPromptOptimize, clampMediaRatio, clampMediaResolution,
  cssAspectRatio,
  type AssetKind, type MediaAsset, type MediaModelOption,
} from '@/api/video'

const KIND_ICON: Record<AssetKind, unknown> = { image: Picture, video: VideoCamera, audio: Headset, text: Document }

const props = defineProps<{
  items: MediaAsset[]
  shareProjectId?: string
  namePlaceholder: string
  promptPlaceholder: string
  promptDialogTitle: string
  emptyText: string
  /** 可选的图片生成模型列表 */
  models: MediaModelOption[]
  /** 可 @ 引用的素材池，排除某一项自身（避免自我引用） */
  optionsFor: (self?: MediaAsset) => MentionOption[]
  uploadFn?: (file: File) => Promise<{ name: string }>
  /** 本地上传素材"替换文件"：保持名称/提示词/@ 引用不变，仅替换素材文件本身 */
  replaceFn?: (item: MediaAsset, file: File) => Promise<void>
  locked?: boolean
  readonly?: boolean
  /** 进入批量选择时，可勾选的 AI 图片素材显示选择框 */
  selectable?: boolean
  selectedIds?: string[]
}>()
const emit = defineEmits<{
  update: [item: MediaAsset]
  delete: [item: MediaAsset]
  dirty: [id: string]
  generate: [id: string]
  reorder: [ids: string[]]
  'toggle-select': [id: string]
}>()

const gridRef = ref<HTMLElement>()
const replaceInput = ref<HTMLInputElement>()
const replacingItem = ref<MediaAsset>()
const replacingId = ref<string>()
const canSort = computed(() => !props.readonly && !props.locked && !props.selectable && props.items.length > 1)
const showCorner = computed(() => !props.readonly && !props.selectable)
/** 稳定 preview-src-list 引用，避免父组件重渲染时每次新建数组导致预览层反复重建闪烁 */
const previewSrcCache = new Map<string, string[]>()
const selectedIdSet = computed(() => new Set(props.selectedIds ?? []))
const isPending = (item: MediaAsset) => item.status === 'queued' || item.status === 'generating'
const canSelect = (item: MediaAsset) =>
  item.kind === 'image' && item.source === 'generated' && !!item.prompt.trim()
const isSelected = (item: MediaAsset) => selectedIdSet.value.has(item.id)
/** 替换文件必须同类型，直接把 accept 限定为该素材的类型 */
const replaceAccept = computed(() =>
  replacingItem.value ? ASSET_KIND_META[replacingItem.value.kind].accept : '',
)

useSortableList(gridRef, {
  disabled: computed(() => !canSort.value),
  onReorder: (ids) => emit('reorder', ids),
})

function uploadedNotePlaceholder(item: MediaAsset): string {
  return item.kind === 'image'
    ? '备注这张图的用途，便于后续辨认'
    : `备注用途，如「品牌固定片尾曲」（单段 ${REFERENCE_CLIP_MIN_SEC}–${REFERENCE_CLIP_MAX_SEC} 秒）`
}

/** 竖屏预览高度。默认比例是 9:16，框高固定后，有没有图片都不会把下面的输入框顶开 */
const IMAGE_PORTRAIT_HEIGHT = 240

function assetSaveTarget(item: MediaAsset) {
  if (item.kind === 'text' || !item.url || item.status !== 'success') return null
  return { kind: item.kind, name: item.name, url: item.url, meta: { prompt: item.prompt, from: 'workbench' } }
}

function previewStyle(item: MediaAsset) {
  if (item.kind !== 'image') return { aspectRatio: '16 / 9', width: '100%' }
  const ratio = clampMediaRatio(item.ratio, props.models, item.modelId)
  const [w, h] = ratio.split(':').map(Number)
  if (h > w) {
    return { width: `${Math.round(IMAGE_PORTRAIT_HEIGHT * w / h)}px`, height: `${IMAGE_PORTRAIT_HEIGHT}px` }
  }
  return { aspectRatio: cssAspectRatio(ratio), width: '100%' }
}

function handleModelId(item: MediaAsset, modelId: string) {
  item.modelId = modelId
  item.ratio = clampMediaRatio(item.ratio, props.models, modelId)
  item.resolution = clampMediaResolution(item.resolution, props.models, modelId)
  item.outputFormat = clampMediaOutputFormat(item.outputFormat, props.models, modelId)
  item.promptOptimizeMode = clampMediaPromptOptimize(item.promptOptimizeMode, props.models, modelId)
  emit('dirty', item.id)
}

function previewSrcList(item: MediaAsset): string[] {
  if (!item.url) return []
  const cached = previewSrcCache.get(item.id)
  if (cached && cached[0] === item.url) return cached
  const next = [item.url]
  previewSrcCache.set(item.id, next)
  return next
}

function triggerReplace(item: MediaAsset) {
  if (props.locked || !props.replaceFn) return
  replacingItem.value = item
  replaceInput.value?.click()
}

async function handleReplaceChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const item = replacingItem.value
  if (!file || !item || !props.replaceFn) return
  replacingId.value = item.id
  try {
    await props.replaceFn(item, file)
  } finally {
    replacingId.value = undefined
    replacingItem.value = undefined
  }
}
</script>

<style scoped>
.media-board { display: flex; flex-direction: column; gap: 14px; }
.media-board.is-locked .asset-fields,
.media-board.is-locked :deep(.card-corner) { pointer-events: none; opacity: .65; }
.board-empty-hint { margin: 0; font-size: 12.5px; color: var(--color-text-tertiary); }

.board-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(190px, 100%), 1fr)); gap: 14px; }

.asset-card {
  position: relative; display: flex; flex-direction: column; gap: 10px; height: 100%;
  padding: 12px; border: 1px solid var(--color-border); border-radius: 14px;
  background: var(--color-card); transition: box-shadow .18s, border-color .18s;
}
.asset-card.has-corner { padding-top: 36px; }
.asset-card:hover { box-shadow: 0 8px 20px rgba(31, 35, 60, .08); border-color: var(--color-border); }
.asset-card.is-selecting { cursor: default; }
.asset-card.is-selected { border-color: var(--color-primary); box-shadow: 0 8px 20px color-mix(in srgb, var(--color-primary) 16%, transparent); }
.asset-card.is-sortable-ghost { opacity: .4; }
.asset-card.is-sortable-chosen { box-shadow: 0 12px 28px color-mix(in srgb, var(--color-primary) 16%, transparent); border-color: var(--color-border); }

.asset-preview { position: relative; flex-shrink: 0; border-radius: 10px; overflow: hidden; background: var(--color-bg-secondary); margin: 0 auto; }
.asset-preview :deep(.el-image),
.asset-preview:not(.is-audio) > video,
.asset-preview:not(.is-audio) > .preview-placeholder,
.asset-preview > .preview-text { position: absolute; inset: 0; width: 100%; height: 100%; }
.asset-preview video { object-fit: contain; background: #14151d; }
/* 音频没有画面，控件居中铺在卡片位上即可 */
.asset-preview.is-audio { display: flex; align-items: center; justify-content: center; padding: 0 10px; }
.asset-preview audio { width: 100%; }
.preview-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--color-text-tertiary); }
.preview-text {
  margin: 0; padding: 8px 10px; overflow: hidden; box-sizing: border-box;
  font-size: 12px; line-height: 1.6; color: var(--color-text-secondary); white-space: pre-wrap;
}
.status-overlay { position: absolute; top: 6px; right: 6px; background: rgba(255, 255, 255, .92); border-radius: 20px; }
.select-hitbox {
  position: absolute; inset: 0; border: 0; padding: 0; background: transparent; cursor: pointer; z-index: 2;
}
.select-hitbox:disabled { cursor: not-allowed; }
.select-check {
  position: absolute; top: 8px; left: 8px; width: 22px; height: 22px; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, .92); border: 1.5px solid var(--color-border); color: #fff;
  box-shadow: 0 1px 4px rgba(23, 24, 43, .12);
}
.select-check.checked { background: var(--color-primary); border-color: var(--color-primary); }
.select-check.disabled { opacity: .45; }

.asset-fields { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; }
.asset-fields :deep(.mention-textarea),
.asset-note :deep(textarea) {
  height: 62px !important; min-height: 62px !important; max-height: 62px !important; resize: none !important;
}
.w-full { width: 100%; flex-shrink: 0; }
.asset-heading { display: flex; align-items: center; gap: 6px; }
.asset-heading .asset-name { flex: 1; min-width: 0; }
.asset-name :deep(.el-input__wrapper) { font-weight: 600; }
.kind-badge {
  flex-shrink: 0; padding: 2px 6px; border-radius: 6px; font-size: 11px; font-weight: 700; line-height: 1.5;
}
.kind-badge--image { background: var(--color-info-soft); color: var(--color-primary); }
.kind-badge--video { background: var(--color-warning-soft); color: var(--color-warning); }
.kind-badge--audio { background: var(--color-success-soft); color: var(--color-success); }
.asset-meta { margin: 0; font-size: 11.5px; color: var(--color-text-tertiary); }
.asset-error {
  margin: 0; padding: 7px 8px; border-radius: 8px; background: var(--color-error-soft); color: var(--color-error);
  font-size: 12px; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
  overflow: hidden; word-break: break-word;
}
</style>
