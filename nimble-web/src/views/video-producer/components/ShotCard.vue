<template>
  <div class="shot-card" :class="{ 'is-locked': isPending, 'is-readonly': readonly, 'is-selected': selectable && selected, 'has-corner': showCorner }">
    <CardCorner
      v-if="showCorner"
      :sortable="sortable"
      :sort-frozen="isPending"
      :delete-disabled="isPending"
      :asset="shotSaveTarget"
      @delete="$emit('delete')"
    />
    <div class="shot-media">
      <div class="media-viewer" :style="viewerStyle">
        <video v-if="shot.videoUrl" :key="shot.videoUrl" :src="shot.videoUrl" controls playsinline preload="none" />
        <div v-else class="media-placeholder">
          <el-icon :size="24"><VideoCamera /></el-icon>
          <span>{{ mediaPlaceholder }}</span>
        </div>

        <span class="shot-badge" :class="{ 'is-offset': selectable }">{{ shot.index + 1 }}</span>
        <StatusTag class="shot-status" :status="shot.videoStatus" :error="shot.videoError" :label="statusOverlayLabel" />
        <button
          v-if="selectable"
          type="button"
          class="select-hitbox"
          :title="selected ? '取消选择' : '选择此分镜'"
          @click.stop="$emit('toggle-select')"
        >
          <span class="select-check" :class="{ checked: selected }">
            <el-icon v-if="selected" :size="12"><Check /></el-icon>
          </span>
        </button>
      </div>

      <div v-if="shot.videoStatus === 'queued'" class="shot-notice">
        {{ continuous ? '等待按分镜顺序生成' : '任务已进入生成队列' }}
      </div>
      <div v-else-if="shot.videoStatus === 'generating'" class="shot-progress">
        <div class="shot-progress-track" :class="{ 'is-indeterminate': !hasProgress }">
          <div class="shot-progress-fill" :style="hasProgress ? { width: progressPercent + '%' } : undefined" />
        </div>
        <span class="shot-progress-text">{{ hasProgress ? `生成中 ${progressPercent}%` : '视频生成中…' }}</span>
      </div>
      <div v-else-if="shot.videoStatus === 'failed'" class="shot-error" :title="shot.videoError || ''">
        {{ shot.videoError || '视频生成失败' }}
      </div>
      <VideoShareButton v-if="shareProjectId && shot.videoUrl && !selectable" :source="readonly ? 'video-example' : 'project'" :id="shareProjectId" :video="shot.videoUrl" :title="shot.name" />

      <div v-if="!readonly && !selectable" class="media-actions">
        <el-button
          size="small" type="primary" class="action-btn"
          :loading="shot.videoStatus === 'generating'"
          :disabled="isPending"
          @click="$emit('generate-video')"
        >{{ shot.videoUrl ? '重新生成视频' : '生成视频' }}</el-button>
      </div>
      <div v-if="sortedTakes.length" class="take-row">
        <span class="shot-label">版本</span>
        <el-select
          :model-value="shot.activeTakeId ?? undefined"
          size="small"
          placeholder="选择历史结果"
          :disabled="!readonly && isPending"
          @change="handleTakeChange"
        >
          <el-option
            v-for="take in sortedTakes"
            :key="take.id"
            :value="take.id"
            :disabled="take.status !== 'success'"
            :label="takeLabel(take)"
          >
            <span>V{{ take.version }} · {{ statusLabel[take.status] }}</span>
            <span v-if="take.qcReport" class="take-qc" :class="`is-${take.qcReport.result}`">
              {{ qcLabel[take.qcReport.result] }}
            </span>
          </el-option>
        </el-select>
      </div>
    </div>

    <div class="shot-body">
      <el-input v-model="shot.name" size="small" maxlength="40" placeholder="分镜名称" :disabled="readonly" @input="$emit('dirty')" @blur="$emit('save')" />
      <div class="shot-params">
        <div class="shot-param">
          <span class="shot-label">时长</span>
          <el-input-number
            v-model="shot.durationSec" :min="durationMin" :max="durationMax" :step="1" :controls="false" size="small"
            :disabled="readonly"
            :title="`${durationMin}–${durationMax} 秒`"
            @change="$emit('save')"
          />
          <span class="shot-unit">秒</span>
        </div>
        <ModelPicker
          class="shot-model-picker"
          :model-id="shot.modelId"
          :lora="shot.lora"
          :models="models"
          :ratio="shot.ratio"
          :resolution="shot.resolution"
          :disabled="readonly || isPending"
          @update:model-id="handleModelId"
          @update:lora="(v) => { shot.lora = v; $emit('dirty') }"
          @update:ratio="handleRatio"
          @update:resolution="handleResolution"
          @change="$emit('save')"
        />
      </div>
      <PromptField
        v-model="shot.videoPrompt"
        :options="options"
        :upload-fn="uploadFn"
        placeholder="镜头运动/动作/台词旁白等。需要衔接上一镜时，可手动 @分镜名"
        dialog-title="编辑视频提示词"
        dialog-tip="用 @ 引用人物、场景、分镜或本地图片。需要衔接上一镜时再手动 @分镜名。"
        :readonly="readonly"
        @update:model-value="$emit('dirty')"
        @blur="$emit('save')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import VideoShareButton from '@/components/VideoShareButton.vue'
import { computed } from 'vue'
import { VideoCamera, Check } from '@element-plus/icons-vue'
import StatusTag from './StatusTag.vue'
import PromptField from './PromptField.vue'
import ModelPicker from './ModelPicker.vue'
import CardCorner from './CardCorner.vue'
import type { MentionOption } from './MentionInput.vue'
import {
  clampMediaDuration,
  clampMediaRatio,
  clampMediaResolution,
  cssAspectRatio,
  mediaDurationRange,
  resolveMediaModel,
  type MediaModelOption,
  type MediaStatus,
  type QcResult,
  type Shot,
  type VideoTake,
} from '@/api/video'

const props = defineProps<{
  shot: Shot
  shareProjectId?: string
  options: MentionOption[]
  models: MediaModelOption[]
  continuous?: boolean
  locked?: boolean
  readonly?: boolean
  sortable?: boolean
  selectable?: boolean
  selected?: boolean
  uploadFn?: (file: File) => Promise<{ name: string }>
}>()
const emit = defineEmits<{
  save: []
  dirty: []
  'generate-video': []
  'select-take': [takeId: string]
  delete: []
  'toggle-select': []
}>()

const isPending = computed(
  () => props.locked || props.shot.videoStatus === 'queued' || props.shot.videoStatus === 'generating',
)
const showCorner = computed(() => !props.readonly && !props.selectable)
const shotSaveTarget = computed(() => {
  if (!props.shot.videoUrl || props.shot.videoStatus !== 'success') return null
  return {
    kind: 'video' as const,
    name: props.shot.name,
    url: props.shot.videoUrl,
    meta: { prompt: props.shot.videoPrompt, from: 'workbench' },
  }
})
const durationMin = computed(() => mediaDurationRange(props.models, props.shot.modelId).min)
const durationMax = computed(() => mediaDurationRange(props.models, props.shot.modelId).max)
const SHOT_PORTRAIT_HEIGHT = 380

const viewerStyle = computed(() => {
  const ratio = clampMediaRatio(props.shot.ratio, props.models, props.shot.modelId)
  const [w, h] = ratio.split(':').map(Number)
  if (h > w) {
    return { width: `${Math.round(SHOT_PORTRAIT_HEIGHT * w / h)}px`, height: `${SHOT_PORTRAIT_HEIGHT}px` }
  }
  return { aspectRatio: cssAspectRatio(ratio), width: '100%' }
})
const hasProgress = computed(() => typeof props.shot.videoProgress === 'number' && props.shot.videoProgress > 0)
const progressPercent = computed(() => Math.round((props.shot.videoProgress ?? 0) * 100))
const statusOverlayLabel = computed(() =>
  props.shot.videoStatus === 'generating' && hasProgress.value ? `生成中 ${progressPercent.value}%` : undefined,
)
const sortedTakes = computed(() => [...(props.shot.takes ?? [])].sort((a, b) => b.version - a.version))
const mediaPlaceholder = computed(() => {
  if (props.shot.videoStatus === 'queued') return '视频排队中…'
  if (props.shot.videoStatus === 'generating') {
    return hasProgress.value ? `视频生成中 ${progressPercent.value}%` : '视频生成中…'
  }
  return '尚未生成分镜视频'
})

const statusLabel: Record<MediaStatus, string> = {
  idle: '待生成',
  queued: '排队中',
  generating: '生成中',
  success: '已完成',
  failed: '失败',
}
const qcLabel: Record<QcResult, string> = { passed: 'QC 通过', warning: 'QC 警告', failed: 'QC 失败' }

function takeLabel(take: VideoTake) {
  const qc = take.qcReport ? ` · ${qcLabel[take.qcReport.result]}` : ''
  return `V${take.version} · ${statusLabel[take.status]}${qc}`
}

function handleModelId(modelId: string) {
  const nextModel = resolveMediaModel(props.models, modelId)
  props.shot.modelId = modelId
  props.shot.durationSec = clampMediaDuration(props.shot.durationSec, props.models, modelId)
  props.shot.ratio = clampMediaRatio(props.shot.ratio, props.models, modelId)
  props.shot.resolution = clampMediaResolution(props.shot.resolution, props.models, modelId)
  const match = [...(props.shot.takes ?? [])]
    .filter((take) => take.status === 'success' && take.videoUrl)
    .sort((a, b) => b.version - a.version)
    .find((take) => resolveMediaModel(props.models, take.modelId).id === nextModel.id)
  if (match) {
    props.shot.activeTakeId = match.id
    props.shot.videoUrl = match.videoUrl ?? null
    props.shot.videoStatus = match.status
    props.shot.videoError = match.error ?? null
    props.shot.videoProgress = match.progress ?? null
    props.shot.videoTaskId = null
  }
  emit('dirty')
}

function handleRatio(value: string) {
  props.shot.ratio = value
  emit('dirty')
}

function handleResolution(value: string | undefined) {
  props.shot.resolution = value
  emit('dirty')
}

function handleTakeChange(value: string | number | boolean | undefined) {
  if (typeof value === 'string') emit('select-take', value)
}
</script>

<style scoped>
.shot-card {
  position: relative; display: flex; flex-direction: column; border: 1px solid var(--color-border); border-radius: 16px; overflow: hidden;
  background: var(--color-card); transition: box-shadow .18s, border-color .18s, transform .18s;
}
.shot-card:hover { box-shadow: 0 10px 26px rgba(31, 35, 60, .09); border-color: var(--color-border); transform: translateY(-2px); }
.shot-card.is-selected { border-color: var(--color-primary); box-shadow: 0 10px 26px color-mix(in srgb, var(--color-primary) 16%, transparent); }
.shot-card.is-locked .shot-body { pointer-events: none; opacity: .65; }

.shot-media { padding: 12px 12px 0; display: flex; flex-direction: column; gap: 10px; }
.shot-card.has-corner .shot-media { padding-top: 36px; }
.media-viewer {
  position: relative; flex-shrink: 0; border-radius: 12px; overflow: hidden; margin: 0 auto;
  background: linear-gradient(135deg, #1d1f2b, #14151d);
}
.media-viewer video,
.media-placeholder { position: absolute; inset: 0; width: 100%; height: 100%; }
.media-viewer video { object-fit: contain; display: block; background: #000; }
.media-placeholder {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; color: rgba(255, 255, 255, .38); font-size: 12px;
}

.shot-badge {
  position: absolute; top: 8px; left: 8px; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 7px;
  background: rgba(0, 0, 0, .45); color: #fff; font-size: 12px; font-weight: 700; display: flex;
  align-items: center; justify-content: center; backdrop-filter: blur(2px);
}
.shot-badge.is-offset { left: 38px; }
.shot-status { position: absolute; top: 8px; right: 8px; }
.select-hitbox {
  position: absolute; inset: 0; border: 0; padding: 0; background: transparent; cursor: pointer; z-index: 2;
}
.select-check {
  position: absolute; top: 8px; left: 8px; width: 22px; height: 22px; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, .92); border: 1.5px solid rgba(255, 255, 255, .7); color: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, .2);
}
.select-check.checked { background: var(--color-primary); border-color: var(--color-primary); }

.media-actions { padding-bottom: 12px; }
.action-btn { width: 100%; }
.shot-notice {
  padding: 7px 10px; border-radius: 8px; background: var(--color-primary-soft); color: var(--color-primary); font-size: 12px;
}
.shot-progress {
  display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-radius: 8px; background: var(--color-warning-soft);
}
.shot-progress-track {
  height: 5px; border-radius: 4px; background: var(--color-warning-soft); overflow: hidden;
}
.shot-progress-fill {
  height: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--color-warning), var(--color-warning));
  transition: width .35s ease;
}
.shot-progress-track.is-indeterminate .shot-progress-fill {
  width: 36%; animation: shot-progress-slide 1.2s ease-in-out infinite;
}
.shot-progress-text { font-size: 12px; color: var(--color-warning); font-weight: 600; }
@keyframes shot-progress-slide {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(320%); }
}
.shot-error {
  margin: 0; padding: 8px 10px; border-radius: 8px; background: var(--color-error-soft); color: var(--color-error);
  font-size: 12px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
  overflow: hidden; word-break: break-word;
}
.take-row { display: flex; align-items: center; gap: 8px; padding-bottom: 12px; }
.take-row :deep(.el-select) { flex: 1; min-width: 0; }
.take-qc { float: right; margin-left: 12px; font-size: 11px; }
.take-qc.is-passed { color: var(--color-success); }
.take-qc.is-warning { color: var(--color-warning); }
.take-qc.is-failed { color: var(--color-error); }

.shot-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--color-border); }
.shot-params { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.shot-model-picker { flex: 1; min-width: 160px; }
.shot-param { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.shot-label { font-size: 12px; color: var(--color-text-tertiary); font-weight: 500; flex-shrink: 0; }
.shot-param :deep(.el-input-number) { width: 64px; }
.shot-param :deep(.el-input__inner) { text-align: center; }
.shot-unit { font-size: 12px; color: var(--color-text-tertiary); }
@media (max-width: 640px) {
  .shot-model-picker { flex-basis: 100%; min-width: 0; }
  .action-btn { min-height: 38px; }
}
</style>
