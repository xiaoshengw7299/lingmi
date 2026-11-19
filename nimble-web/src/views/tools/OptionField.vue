<template>
  <div class="option-field" :class="`is-${option.type}`">
    <div class="field-label">
      <span>{{ option.label }}<i v-if="option.required" class="req">*</i></span>
      <HelpTip v-if="option.help" :tip="option.help" />
      <span v-if="option.type === 'slider'" class="slider-value">{{ sliderText }}</span>
    </div>

    <el-radio-group v-if="option.type === 'select' && segmented" :model-value="scalar" class="segmented" @update:model-value="set">
      <el-radio-button v-for="choice in option.choices" :key="String(choice.value)" :value="choice.value">{{ choice.label }}</el-radio-button>
    </el-radio-group>
    <el-select v-else-if="option.type === 'select'" :model-value="scalar" filterable class="full" @update:model-value="set">
      <el-option v-for="choice in option.choices" :key="String(choice.value)" :value="choice.value" :label="choice.label" />
    </el-select>

    <el-switch v-else-if="option.type === 'switch'" :model-value="Boolean(modelValue)" @update:model-value="set" />

    <span v-else-if="option.type === 'number'" class="number-row">
      <el-input-number :model-value="Number(modelValue)" :min="option.min" :max="option.max" :step="option.step ?? 1" class="number" @update:model-value="set" />
      <em v-if="option.unit">{{ option.unit }}</em>
    </span>

    <el-slider v-else-if="option.type === 'slider'" :model-value="Number(modelValue)" :min="option.min" :max="option.max" :step="option.step" class="slider" @update:model-value="set" />

    <template v-else-if="option.type === 'text' || option.type === 'textarea'">
      <el-input
        :model-value="String(modelValue ?? '')"
        :type="option.type"
        :autosize="{ minRows: 3, maxRows: 8 }"
        :maxlength="option.maxLength"
        :show-word-limit="!!option.maxLength && option.type === 'textarea'"
        :placeholder="option.placeholder"
        @update:model-value="set"
      />
      <div v-if="option.presets?.length" class="presets">
        <button v-for="preset in option.presets" :key="preset" type="button" class="preset" @click="set(preset)">{{ preset }}</button>
      </div>
    </template>

    <div v-else-if="option.type === 'tags'" class="tags">
      <span v-for="(value, i) in list" :key="i" class="tag-item">
        <el-input-number :model-value="Number(value)" :min="option.min" :max="option.max" size="small" :controls="false" @update:model-value="(v: number | undefined) => setAt(i, v)" />
        <em>{{ option.unit }}</em>
        <button v-if="list.length > 1" type="button" aria-label="删除" @click="removeAt(i)">×</button>
      </span>
      <el-button v-if="list.length < (option.maxItems ?? 5)" size="small" :icon="Plus" @click="set([...list, list.at(-1) ?? option.min ?? 1])">添加</el-button>
    </div>

    <div v-else-if="option.type === 'pairs'" class="pairs">
      <div v-for="(pair, i) in pairs" :key="i" class="pair-item">
        <div class="pair-row">
          <el-input :model-value="pair.from" placeholder="录音里的原话" :maxlength="option.maxLength" @update:model-value="(v: string) => setPair(i, 'from', v)" />
          <el-icon class="pair-arrow"><Right /></el-icon>
          <el-input :model-value="pair.to" placeholder="新的说法" :maxlength="option.maxLength" @update:model-value="(v: string) => setPair(i, 'to', v)" />
          <el-button text :icon="Delete" :disabled="pairs.length === 1" aria-label="删除" @click="removeAt(i)" />
        </div>
        <div class="pair-range">
          <span>位置（可选）</span>
          <el-input-number :model-value="pair.start" :min="0" :controls="false" size="small" placeholder="起" @update:model-value="(v: number | undefined) => setPair(i, 'start', v)" />
          <em>–</em>
          <el-input-number :model-value="pair.end" :min="0" :controls="false" size="small" placeholder="止" @update:model-value="(v: number | undefined) => setPair(i, 'end', v)" />
          <em>秒</em>
        </div>
      </div>
      <el-button v-if="pairs.length < (option.maxItems ?? 10)" size="small" :icon="Plus" @click="set([...pairs, { from: '', to: '' }])">再改一处</el-button>
    </div>

    <template v-else-if="option.type === 'record'">
      <el-select :model-value="scalar || undefined" :loading="recordsLoading" placeholder="选择一条记录" class="full" @update:model-value="set">
        <el-option v-for="task in records" :key="task.id" :value="task.id" :label="recordLabel(task)" />
      </el-select>
      <p v-if="!recordsLoading && !records.length" class="field-hint">
        还没有可用的记录，<router-link :to="recordLink" class="link">先去生成一个</router-link>
      </p>
    </template>

    <div v-else-if="option.type === 'boxes' || option.type === 'mask'" class="region">
      <el-button :disabled="!source" @click="picking = true">
        {{ option.type === 'mask' ? (modelValue ? '重新涂抹' : '开始涂抹') : list.length ? `已框选 ${list.length} 个区域` : '框选区域' }}
      </el-button>
      <el-button v-if="option.type === 'mask' ? modelValue : list.length" text @click="set(option.type === 'mask' ? '' : [])">清除</el-button>
      <span v-if="maskUploading" class="field-hint">遮罩上传中…</span>
      <span v-else-if="!source" class="field-hint">先上传文件</span>
      <span v-else-if="option.type === 'mask' && modelValue" class="field-hint ok">已涂抹</span>
      <RegionPicker
        v-if="picking && source"
        :mode="option.type === 'mask' ? 'mask' : 'boxes'"
        :source="source"
        :boxes="list as Box[]"
        :max-items="option.maxItems"
        @close="picking = false"
        @boxes="onBoxes"
        @mask="onMask"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete, Plus, Right } from '@element-plus/icons-vue'
import HelpTip from '@/components/HelpTip/index.vue'
import { listToolTasks, uploadToMediaKit, type ToolOption, type ToolTask } from '@/api/media-tools'
import { useAuthStore } from '@/stores/auth'
import { dateTime } from '@/utils/format'
import RegionPicker, { type Box } from './RegionPicker.vue'
import { GENERAL_TOOL_MENU } from './menu'

const props = defineProps<{ option: ToolOption; modelValue: unknown; source?: { url: string; kind: 'image' | 'video' } | null }>()
const emit = defineEmits<{ 'update:modelValue': [unknown]; busy: [boolean] }>()

const auth = useAuthStore()
const picking = ref(false)
const maskUploading = ref(false)
const records = ref<ToolTask[]>([])
const recordsLoading = ref(false)

const set = (value: unknown) => emit('update:modelValue', value)
const scalar = computed(() => props.modelValue as string | number | undefined)
const list = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : []) as unknown[])
const pairs = computed(() => list.value as Array<{ from: string; to: string; start?: number; end?: number }>)

/** 选项少且短时用分段按钮，一眼能看全 */
const segmented = computed(() => (props.option.choices?.length ?? 0) <= 3 && props.option.choices?.every((c) => c.label.length <= 12))

const sliderText = computed(() => {
  const value = Number(props.modelValue)
  if ((props.option.max ?? 0) <= 1 && props.option.key.startsWith('expand_')) return `${Math.round(value * 100)}%`
  return String(value)
})

function setAt(index: number, value: number | undefined) {
  const next = [...list.value]
  next[index] = value ?? props.option.min ?? 1
  set(next)
}

function setPair(index: number, field: 'from' | 'to' | 'start' | 'end', value: string | number | undefined) {
  set(pairs.value.map((pair, i) => (i === index ? { ...pair, [field]: value } : pair)))
}

function removeAt(index: number) {
  set(list.value.filter((_, i) => i !== index))
}

function onBoxes(boxes: Box[]) {
  picking.value = false
  set(boxes)
}

async function onMask(blob: Blob) {
  picking.value = false
  maskUploading.value = true
  emit('busy', true)
  try {
    set(await uploadToMediaKit(new File([blob], 'mask.png', { type: 'image/png' })))
  } catch {
    ElMessage.error('遮罩上传失败，请重试')
  } finally {
    maskUploading.value = false
    emit('busy', false)
  }
}

const recordLink = computed(() => {
  const tool = props.option.recordTool ?? ''
  return GENERAL_TOOL_MENU.some((item) => item.id === tool) ? `/general-tools/${tool}` : `/video-tools/${tool}`
})
const recordLabel = (task: ToolTask) => `${task.inputs[0]?.name ?? '记录'}${task.inputs.length > 1 ? ` 等 ${task.inputs.length} 个` : ''} · ${dateTime(task.createdAt)}`

onMounted(async () => {
  if (props.option.type !== 'record' || !props.option.recordTool || !auth.isLoggedIn) return
  recordsLoading.value = true
  try {
    records.value = (await listToolTasks(props.option.recordTool, 1, { succeeded: true, pageSize: 50 })).items
  } catch {
    records.value = []
  } finally {
    recordsLoading.value = false
  }
})
</script>

<style scoped>
.option-field { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.field-label { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--color-text-secondary); }
.req { margin-left: 2px; font-style: normal; color: var(--color-error); }
.slider-value { margin-left: auto; font-weight: 700; color: var(--color-primary); font-variant-numeric: tabular-nums; }
.full { width: 100%; }
.number-row { display: inline-flex; align-items: center; gap: 8px; }
.number-row em { font-style: normal; font-size: 13px; color: var(--color-text-tertiary); }
.number { width: 160px; }
.slider { padding: 0 8px; }
.segmented { display: flex; }
.segmented :deep(.el-radio-button) { flex: 1; }
.segmented :deep(.el-radio-button__inner) { width: 100%; }
.presets { display: flex; flex-wrap: wrap; gap: 6px; }
.preset {
  padding: 3px 10px; border-radius: 999px; border: 1px solid var(--color-border); background: var(--color-card);
  font-size: 12px; color: var(--color-text-secondary); cursor: pointer;
}
.preset:hover { border-color: var(--color-primary-line); color: var(--color-primary); }
.tags { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.tag-item { display: inline-flex; align-items: center; gap: 4px; padding: 3px 6px; border-radius: 10px; background: var(--color-bg-secondary); }
.tag-item :deep(.el-input-number) { width: 72px; }
.tag-item em { font-style: normal; font-size: 12px; color: var(--color-text-tertiary); }
.tag-item button { border: 0; background: none; color: var(--color-text-tertiary); cursor: pointer; font-size: 15px; }
.pairs { display: flex; flex-direction: column; gap: 8px; }
.pair-item { display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 12px; background: var(--color-bg-secondary); }
.pair-row { display: flex; align-items: center; gap: 8px; }
.pair-range { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-tertiary); }
.pair-range :deep(.el-input-number) { width: 64px; }
.pair-range em { font-style: normal; }
.pair-arrow { flex-shrink: 0; color: var(--color-text-tertiary); }
.region { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.field-hint { font-size: 12px; color: var(--color-text-tertiary); }
.field-hint.ok { color: var(--color-success); }
.link { color: var(--color-primary); font-weight: 600; }
@media (max-width: 640px) {
  .segmented :deep(.el-radio-button) { min-width: 0; }
  .segmented :deep(.el-radio-button__inner) { padding-inline: 6px; white-space: normal; }
  .pair-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; }
  .pair-row .el-input { grid-column: 1; }
  .pair-row .pair-arrow { display: none; }
  .pair-row .el-button { grid-column: 2; grid-row: 1 / 3; }
  .pair-range { flex-wrap: wrap; }
  .preset { min-height: 34px; }
}
</style>
