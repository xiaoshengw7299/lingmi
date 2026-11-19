<template>
  <div class="tool-home">
    <section class="panel form-panel">
      <header class="form-head">
        <div class="form-title">
          <div class="hero-icon"><el-icon :size="22"><component :is="tool.icon" /></el-icon></div>
          <div>
            <h1>{{ tool.name }}</h1>
            <p>{{ tool.summary }}</p>
          </div>
        </div>
      </header>
        <div v-if="tool.modes.length > 1" class="mode-chip-row">
          <button
            v-for="item in tool.modes"
            :key="item.id"
            type="button"
            class="mode-chip"
            :class="{ 'is-active': item.id === modeId }"
            :disabled="submitting"
            @click="modeId = item.id"
          >
            <strong>{{ item.label }}</strong>
            <span>{{ item.desc }} · ¥{{ price(item.price.price) }}/{{ item.price.unit }}</span>
          </button>
        </div>

        <FileSlot v-for="input in mode.inputs" :key="`${mode.id}-${input.key}`" v-model="files[input.key]" :input="input" @busy="trackBusy" />

        <OptionField
          v-for="option in basicOptions"
          :key="`${mode.id}-${option.key}`"
          v-model="values[option.key]"
          :option="option"
          :source="source"
          @busy="trackBusy"
        />

        <template v-if="advancedOptions.length">
          <button type="button" class="text-toggle" @click="showAdvanced = !showAdvanced">
            <el-icon class="toggle-arrow" :class="{ 'is-open': showAdvanced }"><ArrowDown /></el-icon>
            {{ showAdvanced ? '收起更多设置' : '更多设置' }}
          </button>
          <div v-show="showAdvanced" class="text-toggle-body">
            <OptionField v-for="option in advancedOptions" :key="`${mode.id}-${option.key}`" v-model="values[option.key]" :option="option" :source="source" @busy="trackBusy" />
          </div>
        </template>

        <div class="submit-bar">
          <div class="cost">
            <span class="cost-label">预计费用</span>
            <b class="lm-money">{{ cents == null ? '—' : `¥ ${yuan(cents)}` }}</b>
            <small>{{ cents == null ? '上传文件后显示' : mode.price.basis }}</small>
          </div>
          <el-button type="primary" class="generate-btn submit" :loading="submitting" :disabled="!ready" @click="submit">
            {{ busy ? '文件上传中…' : '开始处理' }}
          </el-button>
        </div>
    </section>

    <section class="panel guide">
      <ToolShowcase :tool-id="tool.id" :showcase="tool.showcase" />
      <div class="guide-copy">
        <div>
          <h3>功能介绍</h3>
          <p class="intro">{{ tool.intro }}</p>
          <div class="hero-chips">
            <span v-for="item in tool.highlights" :key="item"><el-icon><CircleCheckFilled /></el-icon>{{ item }}</span>
          </div>
        </div>
        <div>
          <h3>适用场景</h3>
          <ul class="scenarios">
            <li v-for="item in tool.scenarios" :key="item.title">
              <el-icon><Promotion /></el-icon>
              <div><b>{{ item.title }}</b><span>{{ item.desc }}</span></div>
            </li>
          </ul>
        </div>
        <div class="guide-notes">
          <div>
            <h3>使用须知</h3>
            <ul class="tips">
              <li v-for="item in tool.tips" :key="item">{{ item }}</li>
            </ul>
          </div>
          <div>
            <h3>计价</h3>
            <div class="price-list">
              <div v-for="item in tool.modes" :key="item.id" class="price-item">
                <span>{{ tool.modes.length > 1 ? item.label : '单价' }}</span>
                <b class="lm-money">¥ {{ price(item.price.price) }}<small> / {{ item.price.unit }}</small></b>
              </div>
              <p class="price-note">{{ mode.price.basis }}。失败自动退款；实际用量超出预估时按实际补扣。</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, toRaw, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowDown, CircleCheckFilled, Promotion } from '@element-plus/icons-vue'
import { createToolTask, quoteTool, type InputFile, type ToolDef, type ToolOption, type ToolTask } from '@/api/media-tools'
import { price, yuan } from '@/utils/format'
import FileSlot from './FileSlot.vue'
import OptionField from './OptionField.vue'
import ToolShowcase from './ToolShowcase.vue'

const props = defineProps<{ tool: ToolDef }>()
const emit = defineEmits<{ created: [ToolTask] }>()

const QUOTE_DELAY_MS = 350
const route = useRoute()

const modeId = ref(props.tool.modes[0].id)
const mode = computed(() => props.tool.modes.find((item) => item.id === modeId.value) ?? props.tool.modes[0])
const files = reactive<Record<string, InputFile[]>>({})
const values = reactive<Record<string, unknown>>({})
const showAdvanced = ref(false)
const busyCount = ref(0)
const submitting = ref(false)
const cents = ref<number | null>(null)

const busy = computed(() => busyCount.value > 0)
const trackBusy = (on: boolean) => (busyCount.value = Math.max(0, busyCount.value + (on ? 1 : -1)))

const visible = (option: ToolOption) => Object.entries(option.when ?? {}).every(([key, allowed]) => allowed.includes(values[key]))
const shown = computed(() => mode.value.options.filter(visible))
const basicOptions = computed(() => shown.value.filter((option) => !option.advanced))
const advancedOptions = computed(() => shown.value.filter((option) => option.advanced))

/** 框选 / 涂抹用第一个图片或视频输入当底图 */
const source = computed(() => {
  for (const input of mode.value.inputs) {
    const file = files[input.key]?.[0]
    if (file?.previewUrl && (file.kind === 'image' || file.kind === 'video')) return { url: file.previewUrl, kind: file.kind }
  }
  return null
})

const isEmpty = (value: unknown) => value == null || value === '' || (Array.isArray(value) && value.length === 0)
const inputsReady = computed(() => !busy.value && mode.value.inputs.every((input) => input.optional || files[input.key]?.length))
const ready = computed(() => inputsReady.value && shown.value.every((option) => !option.required || !isEmpty(values[option.key])))

function emptyValue(option: ToolOption): unknown {
  // 目录来自响应式 props，默认值是 Proxy，structuredClone 复制不了，先取原始对象
  if (option.default !== undefined) return structuredClone(toRaw(option.default))
  if (option.type === 'pairs') return [{ from: '', to: '' }]
  if (option.type === 'tags' || option.type === 'boxes') return []
  if (option.type === 'switch') return false
  return option.type === 'record' && typeof route.query[option.key] === 'string' ? route.query[option.key] : ''
}

/** 切换版本：参数回到默认值，同名输入的文件保留 */
watch(
  mode,
  (next) => {
    for (const key of Object.keys(values)) delete values[key]
    for (const option of next.options) values[option.key] = emptyValue(option)
    for (const key of Object.keys(files)) {
      if (!next.inputs.some((input) => input.key === key)) {
        clearFiles(key)
        delete files[key]
      }
    }
    for (const input of next.inputs) files[input.key] ??= []
  },
  { immediate: true },
)

const params = () => ({ tool: props.tool.id, mode: mode.value.id, inputs: { ...files }, values: { ...values } })

function clearFiles(key: string) {
  for (const file of files[key] ?? []) {
    if (file.previewUrl) URL.revokeObjectURL(file.previewUrl)
  }
  files[key] = []
}

let quoteTimer: number | undefined
let quoteSeq = 0
watch(
  [mode, files, values],
  () => {
    window.clearTimeout(quoteTimer)
    const seq = ++quoteSeq
    if (!inputsReady.value) {
      cents.value = null
      return
    }
    quoteTimer = window.setTimeout(async () => {
      const quote = await quoteTool(params()).catch(() => ({ cents: null }))
      if (seq === quoteSeq) cents.value = quote.cents
    }, QUOTE_DELAY_MS)
  },
  { deep: true, immediate: true },
)
onBeforeUnmount(() => {
  window.clearTimeout(quoteTimer)
  ++quoteSeq
  Object.keys(files).forEach(clearFiles)
})

async function submit() {
  if (submitting.value || !ready.value) return
  submitting.value = true
  try {
    const task = await createToolTask(params())
    ElMessage.success(mode.value.sync ? '已提交，稍等几秒出结果' : '已提交，可在生成记录中查看处理进度')
    for (const input of mode.value.inputs) clearFiles(input.key)
    emit('created', task)
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.tool-home { display: flex; flex-direction: column; gap: 16px; }

.form-panel { padding: 22px; }
.form-head { display: flex; align-items: center; gap: 16px; margin-bottom: 18px; }
.form-title { display: flex; align-items: center; gap: 14px; min-width: 0; }
.form-title h1 { font-size: 20px; font-weight: 800; letter-spacing: 0.02em; }
.form-title p { margin-top: 2px; font-size: 13.5px; color: var(--color-text-secondary); }
.hero-icon {
  flex-shrink: 0; width: 46px; height: 46px; display: grid; place-items: center; border-radius: 14px; color: #fff;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-light));
  box-shadow: 0 8px 18px color-mix(in srgb, var(--color-primary) 28%, transparent);
}
.submit-bar { display: flex; align-items: center; gap: 16px; margin-top: 6px; padding-top: 16px; border-top: 1px solid var(--color-divider); }
.cost { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.cost-label { font-size: 12px; color: var(--color-text-tertiary); }
.cost b { font-size: 22px; color: var(--color-primary); }
.cost small { font-size: 12px; color: var(--color-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.submit { width: 200px; margin-top: 0; }

.guide { padding: 22px; display: flex; flex-direction: column; gap: 8px; }
.guide-copy { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(240px, 0.85fr); gap: 18px 28px; }
.guide-notes { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(240px, 0.85fr); gap: 18px 28px; }
.guide h3 { margin-bottom: 8px; font-size: 14px; font-weight: 700; }
.intro { font-size: 13px; line-height: 1.75; color: var(--color-text-secondary); }
.hero-chips { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 10px; }
.hero-chips span { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--color-text-secondary); }
.hero-chips .el-icon { color: var(--color-primary); }
.scenarios { list-style: none; display: flex; flex-direction: column; gap: 8px; }
.scenarios li { display: flex; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--color-bg-secondary); }
.scenarios .el-icon { flex-shrink: 0; margin-top: 3px; color: var(--color-accent); }
.scenarios b { display: block; font-size: 13px; }
.scenarios span { display: block; margin-top: 2px; font-size: 12.5px; line-height: 1.6; color: var(--color-text-secondary); }
.tips { padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; line-height: 1.6; color: var(--color-text-secondary); }
.price-list { display: flex; flex-direction: column; gap: 6px; }
.price-item { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; color: var(--color-text-secondary); }
.price-item b { font-size: 16px; color: var(--color-primary); }
.price-item small { font-size: 12px; font-weight: 500; color: var(--color-text-tertiary); }
.price-note { margin-top: 4px; font-size: 12px; line-height: 1.6; color: var(--color-text-tertiary); }
.guide :deep(.showcase) { margin-bottom: 8px; padding-bottom: 16px; border-bottom: 1px solid var(--color-divider); }

@media (max-width: 900px) {
  .guide-copy, .guide-notes { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .form-panel, .guide { padding: 14px; }
  .mode-chip-row { grid-template-columns: repeat(auto-fit, minmax(min(148px, 100%), 1fr)); }
  .form-panel :deep(.el-input__inner), .form-panel :deep(.el-textarea__inner) { font-size: 16px; }
  .submit-bar { flex-direction: column; align-items: stretch; }
  .submit { width: 100%; }
}
</style>
