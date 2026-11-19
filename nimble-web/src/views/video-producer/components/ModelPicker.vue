<template>
  <div class="model-picker" :class="{ 'is-block': layout === 'block' }">
    <div class="picker-row">
      <span v-if="layout !== 'block'" class="picker-label">模型</span>
      <el-select
        :model-value="effectiveModelId"
        :placeholder="models.length ? '请选择模型' : '加载中…'"
        :size="layout === 'block' ? 'default' : 'small'"
        popper-class="model-picker-dropdown"
        :disabled="disabled"
        @update:model-value="handleModelChange"
      >
        <el-option v-for="model in models" :key="model.id" :value="model.id" :label="model.name.replace('|', ' ')">
          <div class="model-option">
            <span class="model-option-name">
              {{ model.name.replace('|', ' ') }}
              <span v-if="model.isDefault" class="model-default-badge">默认</span>
              <span v-if="unitPrice(model.id)" class="model-price">{{ unitPrice(model.id) }}</span>
            </span>
            <span v-if="model.description && !hideDescription" class="model-option-desc">{{ model.description }}</span>
          </div>
        </el-option>
      </el-select>

      <el-popover
        v-if="hasSettings"
        placement="bottom-end"
        :width="268"
        trigger="hover"
        :show-after="120"
        :hide-after="240"
        :persistent="true"
        :teleported="true"
        popper-class="model-settings-popover"
      >
        <template #reference>
          <button type="button" class="settings-btn" :disabled="disabled" :title="settingsSummary">
            <el-icon :size="14"><Setting /></el-icon>
          </button>
        </template>
        <div class="settings-panel">
          <p class="settings-title">生成参数</p>
          <p class="settings-summary">{{ settingsSummary }}</p>

          <div v-if="ratioOptions.length" class="settings-row">
            <span class="settings-label">比例</span>
            <el-select
              :model-value="effectiveRatio"
              size="small"
              :disabled="disabled"
              :teleported="false"
              @update:model-value="handleRatio"
            >
              <el-option v-for="item in ratioOptions" :key="item" :value="item" :label="mediaRatioLabel(item)">
                <span>{{ mediaRatioLabel(item) }}</span>
                <span v-if="item === selectedModel?.defaultRatio" class="option-default">默认</span>
              </el-option>
            </el-select>
          </div>

          <div v-if="resolutionOptions.length" class="settings-row">
            <span class="settings-label">清晰度</span>
            <el-select
              :model-value="effectiveResolution"
              size="small"
              :disabled="disabled"
              :teleported="false"
              @update:model-value="handleResolution"
            >
              <el-option v-for="item in resolutionOptions" :key="item" :value="item" :label="mediaResolutionLabel(item)">
                <span>{{ mediaResolutionLabel(item) }}</span>
                <span v-if="resolutionHint(item)" class="option-hint">{{ resolutionHint(item) }}</span>
              </el-option>
            </el-select>
          </div>

          <div v-if="outputFormatOptions.length" class="settings-row">
            <span class="settings-label">格式</span>
            <el-select
              :model-value="effectiveOutputFormat"
              size="small"
              :disabled="disabled"
              :teleported="false"
              @update:model-value="handleOutputFormat"
            >
              <el-option
                v-for="item in outputFormatOptions"
                :key="item"
                :value="item"
                :label="mediaOutputFormatLabel(item)"
              >
                <span>{{ mediaOutputFormatLabel(item) }}</span>
                <span v-if="item === selectedModel?.defaultOutputFormat" class="option-default">官方默认</span>
              </el-option>
            </el-select>
          </div>

          <div v-if="promptOptimizeOptions.length" class="settings-row">
            <span class="settings-label">优化</span>
            <el-select
              :model-value="effectivePromptOptimize"
              size="small"
              :disabled="disabled"
              :teleported="false"
              @update:model-value="handlePromptOptimize"
            >
              <el-option
                v-for="item in promptOptimizeOptions"
                :key="item"
                :value="item"
                :label="mediaPromptOptimizeLabel(item)"
              >
                <span>{{ mediaPromptOptimizeLabel(item) }}</span>
                <span v-if="item === selectedModel?.defaultPromptOptimizeMode" class="option-default">官方默认</span>
              </el-option>
            </el-select>
          </div>

          <template v-if="selectedModel?.supportsLora">
            <div class="settings-row">
              <span class="settings-label">LoRA</span>
              <el-select
                :model-value="lora?.name"
                placeholder="不使用"
                size="small"
                clearable
                :disabled="disabled"
                :teleported="false"
                @update:model-value="handleLoraChange"
              >
                <el-option v-for="option in selectedModel.loras" :key="option.name" :value="option.name" :label="option.name">
                  <div class="model-option">
                    <span class="model-option-name">{{ option.name }}</span>
                    <span v-if="option.description" class="model-option-desc">{{ option.description }}</span>
                  </div>
                </el-option>
              </el-select>
            </div>
            <div v-if="lora" class="settings-row">
              <span class="settings-label">权重</span>
              <el-input-number
                :model-value="lora.weight"
                :min="0" :max="2" :step="0.1" :precision="2" :controls="false" size="small"
                :disabled="disabled"
                @change="handleWeightChange"
              />
            </div>
          </template>

          <p class="settings-tip">未改的项按该模型官方默认发送</p>
        </div>
      </el-popover>
    </div>
    <p v-if="layout === 'block' && selectedModel && !hideDescription" class="picker-caption">
      <strong>{{ selectedModel.name.replace('|', ' ') }}</strong>
      <span v-if="unitPrice(selectedModel.id)" class="model-price">{{ unitPrice(selectedModel.id) }}</span>
      <span v-if="selectedModel.description">{{ selectedModel.description }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Setting } from '@element-plus/icons-vue'
import { usePricingStore } from '@/stores/pricing'
import { price } from '@/utils/format'
import {
  clampMediaOutputFormat,
  clampMediaPromptOptimize,
  clampMediaRatio,
  clampMediaResolution,
  mediaOutputFormatLabel,
  mediaOutputFormatOptions,
  mediaPromptOptimizeLabel,
  mediaPromptOptimizeOptions,
  mediaRatioLabel,
  mediaRatioOptions,
  mediaResolutionHint,
  mediaResolutionLabel,
  mediaResolutionOptions,
  resolveMediaModel,
  type LoraSelection,
  type MediaModelOption,
} from '@/api/video'

const props = withDefaults(defineProps<{
  modelId?: string | null
  lora?: LoraSelection | null
  models: MediaModelOption[]
  ratio?: string | null
  resolution?: string | null
  outputFormat?: string | null
  promptOptimizeMode?: string | null
  disabled?: boolean
  layout?: 'inline' | 'block'
  /** 发布页已经选了模型，底下不再重复一段模型描述 */
  hideDescription?: boolean
}>(), {
  layout: 'inline',
  hideDescription: false,
})
const emit = defineEmits<{
  'update:modelId': [string]
  'update:lora': [LoraSelection | null]
  'update:ratio': [string]
  'update:resolution': [string | undefined]
  'update:outputFormat': [string | undefined]
  'update:promptOptimizeMode': [string | undefined]
  change: []
}>()

// 模型旁边直接标出单价，选之前就知道大概花多少；价目表拉不到时静默不显示
const pricing = usePricingStore()
onMounted(() => void pricing.load().catch(() => undefined))
function unitPrice(modelId: string) {
  const row = pricing.byId.get(modelId)
  return row?.price != null ? `¥${price(row.price)}/${row.unit}` : ''
}

const defaultModelId = computed(() => props.models.find((model) => model.isDefault)?.id)
const effectiveModelId = computed(() => props.modelId || defaultModelId.value)
const selectedModel = computed(() => resolveMediaModel(props.models, props.modelId))

const ratioOptions = computed(() => mediaRatioOptions(props.models, props.modelId))
const resolutionOptions = computed(() => mediaResolutionOptions(props.models, props.modelId))
const outputFormatOptions = computed(() => mediaOutputFormatOptions(props.models, props.modelId))
const promptOptimizeOptions = computed(() => mediaPromptOptimizeOptions(props.models, props.modelId))
const hasSettings = computed(() =>
  ratioOptions.value.length
    + resolutionOptions.value.length
    + outputFormatOptions.value.length
    + promptOptimizeOptions.value.length
    + (selectedModel.value?.supportsLora ? 1 : 0)
  > 0,
)

const effectiveRatio = computed(() => clampMediaRatio(props.ratio, props.models, props.modelId))
const effectiveResolution = computed(() => clampMediaResolution(props.resolution, props.models, props.modelId))
const effectiveOutputFormat = computed(() => clampMediaOutputFormat(props.outputFormat, props.models, props.modelId))
const effectivePromptOptimize = computed(() => clampMediaPromptOptimize(props.promptOptimizeMode, props.models, props.modelId))

const settingsSummary = computed(() => {
  const parts: string[] = []
  if (effectiveRatio.value) parts.push(mediaRatioLabel(effectiveRatio.value))
  if (effectiveResolution.value) parts.push(mediaResolutionLabel(effectiveResolution.value))
  if (effectiveOutputFormat.value) parts.push(mediaOutputFormatLabel(effectiveOutputFormat.value))
  if (props.lora?.name) parts.push(props.lora.name)
  return parts.join(' · ') || '生成参数'
})

function resolutionHint(value: string) {
  return mediaResolutionHint(value, value === selectedModel.value?.defaultResolution)
}

function asString(value: string | number | boolean | undefined) {
  return typeof value === 'string' ? value : undefined
}

function handleModelChange(modelId: string | number | boolean | undefined) {
  if (typeof modelId !== 'string') return
  emit('update:modelId', modelId)
  const next = props.models.find((model) => model.id === modelId)
  if (!next?.supportsLora && props.lora) emit('update:lora', null)
  emit('change')
}

function handleLoraChange(name: string | number | boolean | undefined) {
  if (typeof name !== 'string') {
    emit('update:lora', null)
  } else {
    const option = selectedModel.value?.loras.find((item) => item.name === name)
    emit('update:lora', { name, weight: option?.defaultWeight ?? 1 })
  }
  emit('change')
}

function handleWeightChange(weight: number | undefined) {
  if (!props.lora || weight === undefined) return
  emit('update:lora', { ...props.lora, weight })
  emit('change')
}

function handleRatio(value: string | number | boolean | undefined) {
  const next = asString(value)
  if (!next) return
  emit('update:ratio', next)
  emit('change')
}

function handleResolution(value: string | number | boolean | undefined) {
  emit('update:resolution', asString(value))
  emit('change')
}

function handleOutputFormat(value: string | number | boolean | undefined) {
  emit('update:outputFormat', asString(value))
  emit('change')
}

function handlePromptOptimize(value: string | number | boolean | undefined) {
  emit('update:promptOptimizeMode', asString(value))
  emit('change')
}
</script>

<style scoped>
.model-picker { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.picker-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.picker-row :deep(.el-select) { flex: 1; min-width: 0; width: 100%; }
.picker-label { flex-shrink: 0; font-size: 12px; color: var(--color-text-tertiary); font-weight: 500; }

.model-picker.is-block .picker-row :deep(.el-select__wrapper) {
  min-height: 40px;
  padding: 4px 12px;
}
.model-picker.is-block .picker-row :deep(.el-select__selected-item),
.model-picker.is-block .picker-row :deep(.el-select__placeholder) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.picker-caption {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.picker-caption strong { font-size: 12.5px; color: var(--color-text-primary); font-weight: 600; }
.picker-caption span { font-size: 12px; color: var(--color-text-tertiary); line-height: 1.45; }

.settings-btn {
  flex-shrink: 0; width: 28px; height: 28px; border: 1px solid var(--color-border); border-radius: 8px;
  background: var(--color-bg-secondary); color: var(--color-text-tertiary); display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background .15s, color .15s, border-color .15s;
}
.settings-btn:hover:not(:disabled), .settings-btn:focus-visible {
  background: var(--color-primary-soft); color: var(--color-primary); border-color: var(--color-border);
}
.settings-btn:disabled { opacity: .45; cursor: not-allowed; }

.settings-panel { display: flex; flex-direction: column; gap: 10px; }
.settings-title { margin: 0; font-size: 13px; font-weight: 700; color: var(--color-text-primary); }
.settings-summary { margin: -4px 0 0; font-size: 11.5px; color: var(--color-text-tertiary); line-height: 1.4; }
.settings-row { display: flex; align-items: center; gap: 8px; }
.settings-row :deep(.el-select) { flex: 1; min-width: 0; }
.settings-row :deep(.el-input-number) { width: 88px; }
.settings-label { width: 42px; flex-shrink: 0; font-size: 12px; color: var(--color-text-tertiary); font-weight: 500; }
.settings-tip { margin: 0; font-size: 11px; color: var(--color-text-tertiary); line-height: 1.4; }

.model-option { display: flex; flex-direction: column; gap: 1px; padding: 2px 0; line-height: 1.4; }
.model-option-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.model-option-desc { font-size: 11.5px; color: var(--color-text-tertiary); white-space: normal; }
.model-default-badge {
  margin-left: 6px; font-size: 10.5px; font-weight: 600; color: var(--color-primary); background: var(--color-primary-soft);
  border-radius: 6px; padding: 1px 6px;
}
/* 单价标签：金色和价目表里的"省"保持一个语义 */
.model-price {
  margin-left: 6px; font-size: 10.5px; font-weight: 700; color: var(--color-warning); background: var(--color-accent-soft);
  border-radius: 6px; padding: 1px 6px; white-space: nowrap;
}
</style>

<style>
.model-picker-dropdown .el-select-dropdown__item {
  height: auto;
  min-height: 34px;
  line-height: 1.4;
  padding: 7px 12px;
}
.model-settings-popover {
  padding: 12px !important;
  overflow: visible !important;
}
.model-settings-popover .el-select-dropdown__item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.option-default, .option-hint {
  font-size: 10.5px; font-weight: 600; color: var(--color-primary); background: var(--color-primary-soft);
  border-radius: 6px; padding: 1px 6px;
}
.option-hint { font-weight: 500; color: var(--color-text-tertiary); background: var(--color-bg-secondary); }
</style>
