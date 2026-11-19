<template>
  <div class="panel" @pointerdown.stop @wheel.stop>
    <el-input v-if="showTitle" v-model="titleDraft" maxlength="60" aria-label="节点名称" @blur="rename" />
    <div v-if="refs.length" class="refs">
      <span class="refs-label">参考</span>
      <el-tag v-for="r in refs" :key="r.id" size="small" closable effect="plain" @close="removeRef(r.id)">
        @{{ names.get(r.id) }}
      </el-tag>
      <span class="refs-tip">在提示词里输入 @ 可引用</span>
    </div>

    <PromptField
      v-model="prompt"
      :options="mentionOptions"
      :rows="3"
      :placeholder="placeholder"
      dialog-title="编辑提示词"
      dialog-tip="连线后输入 @，可引用图片、视频、音频或文本"
      @blur="commitPrompt"
    />

    <div class="bar">
      <!-- 与通用创作同一个选择器：下拉里直接标出单价，齿轮里是比例 / 清晰度 / 格式 / LoRA -->
      <ModelPicker
        v-if="showRatio && models.length"
        class="w-model"
        :models="models"
        :model-id="node.modelId"
        :lora="node.lora"
        :ratio="node.ratio"
        :resolution="node.resolution"
        :output-format="node.outputFormat"
        :prompt-optimize-mode="node.promptOptimizeMode"
        @update:model-id="(id) => changeModel(id)"
        @update:lora="(v) => patch({ lora: v })"
        @update:ratio="onRatio"
        @update:resolution="(v) => patch({ resolution: v })"
        @update:output-format="(v) => patch({ outputFormat: v })"
        @update:prompt-optimize-mode="(v) => patch({ promptOptimizeMode: v })"
      />
      <el-input-number v-if="node.type === 'video' && current" :model-value="node.durationSec" size="small" :min="current.minDuration" :max="current.maxDuration" class="w-num" @change="(v: number | undefined) => patch({ durationSec: v })" />
      <el-checkbox v-if="node.type === 'video' && current?.supportsGenerateAudio" :model-value="node.generateAudio" size="small" @change="(v) => patch({ generateAudio: !!v })">配音</el-checkbox>

      <span class="spacer" />

      <template v-if="node.type === 'image' && node.url">
        <el-tooltip v-for="tool in IMAGE_TOOLS" :key="tool.op" :content="tool.label" placement="top">
          <el-button size="small" circle :icon="tool.icon" @click="toolOp = tool.op" />
        </el-tooltip>
      </template>
      <el-tooltip content="从我的资产选择" placement="top">
        <el-button size="small" circle :icon="FolderOpened" @click="pickerVisible = true" />
      </el-tooltip>
      <el-tooltip v-if="node.type !== 'text'" content="上传本地文件" placement="top">
        <el-button size="small" circle :icon="Upload" :loading="uploading" @click="fileInput?.click()" />
      </el-tooltip>
      <SaveToAssetButton
        v-if="node.type === 'text' ? node.text : node.url"
        :kind="kind === 'text' ? 'prompt' : kind"
        :name="node.title"
        :url="node.url"
        :content="node.text"
        :meta="{ prompt: node.prompt, from: 'canvas' }"
      />
      <el-button type="primary" size="small" :loading="node.status === 'generating'" @click="generate">
        {{ node.url || node.text ? '重新生成' : '生成' }}
      </el-button>
    </div>

    <input ref="fileInput" type="file" hidden :accept="`${node.type}/*`" @change="onFile" />
    <AssetPickerDialog v-model="pickerVisible" :kinds="node.type === 'text' ? ['prompt'] : [kind as 'image']" :multiple="false" @confirm="onPick" />
    <ImageToolsDialog v-if="toolOp" :node="node" :op="toolOp" @close="toolOp = undefined" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Crop, FolderOpened, Grid, MagicStick, Upload, ZoomIn } from '@element-plus/icons-vue'
import AssetPickerDialog from '@/components/AssetPickerDialog.vue'
import SaveToAssetButton from '@/components/SaveToAssetButton.vue'
import PromptField from '@/views/video-producer/components/PromptField.vue'
import type { MentionOption } from '@/views/video-producer/components/MentionInput.vue'
import ImageToolsDialog, { type ToolOp } from './ImageToolsDialog.vue'
import type { UserAsset } from '@/api/asset'
import { uploadMedia } from '@/api/generation'
import { withMediaType } from '@/api/media-tools'
import type { MediaModelOption } from '@/api/video'
import { defaultModel, fitToModel, loadGenerationModels } from '@/utils/model-params'
import { useCanvasStore } from './store'
import ModelPicker from '@/views/video-producer/components/ModelPicker.vue'
import { heightForRatio, mediaSizeFor, referenceNames } from './generate'
import type { CanvasNode, MediaNodeType } from './types'

const IMAGE_TOOLS = [
  { op: 'crop', label: '裁剪', icon: Crop },
  { op: 'split', label: '拆分为多张', icon: Grid },
  { op: 'upscale', label: '放大', icon: ZoomIn },
  { op: 'inpaint', label: '局部重绘', icon: MagicStick },
] as const

const props = defineProps<{ node: CanvasNode; showTitle?: boolean }>()
const emit = defineEmits<{ generate: [] }>()

const store = useCanvasStore()
const allModels = ref<Awaited<ReturnType<typeof loadGenerationModels>>>()
const titleDraft = ref(props.node.title)
const prompt = ref(props.node.prompt)
const pickerVisible = ref(false)
function rename() {
  const title = titleDraft.value.trim()
  if (title && title !== props.node.title) store.updateNode(props.node.id, { title })
  titleDraft.value = title || props.node.title
}
const uploading = ref(false)
const fileInput = ref<HTMLInputElement>()
const toolOp = ref<ToolOp>()

loadGenerationModels().then((m) => (allModels.value = m)).catch(() => undefined)

const kind = computed(() => props.node.type as MediaNodeType)
const refs = computed(() => store.referencesOf(props.node.id))
const names = computed(() => referenceNames(refs.value))
const mentionOptions = computed<MentionOption[]>(() =>
  refs.value.map((r) => ({
    name: names.value.get(r.id)!,
    type: r.type as MentionOption['type'],
    url: r.thumb || r.url,
    text: r.text,
  })),
)
const models = computed<MediaModelOption[]>(() => (kind.value === 'text' ? [] : (allModels.value?.[kind.value] ?? [])) as MediaModelOption[])
const current = computed(() => models.value.find((m) => m.id === props.node.modelId))
const showRatio = computed(() => kind.value === 'image' || kind.value === 'video')
const placeholder = computed(() => ({
  image: '描述想要的画面；连线的图片会作为参考图，输入 @ 可指定引用哪一张',
  video: '描述镜头与动作；连线的图片 / 视频 / 音频会作为参考，输入 @ 可指定引用',
  audio: '输入要朗读的文字',
  text: '让 AI 写点什么；连线的文本节点会作为上下文，输入 @ 可引用',
})[kind.value])

watch(() => props.node.id, () => (prompt.value = props.node.prompt))
watch(() => props.node.prompt, (v) => (prompt.value = v))
watch(() => props.node.title, (value) => { titleDraft.value = value })

// 首次选中且还没选模型时，套用默认模型与其默认参数
watch([models, () => props.node.id], () => {
  if (props.node.modelId || !models.value.length) return
  changeModel(defaultModel(models.value)!.id, false)
}, { immediate: true })

/** record=false 用于自动套用默认值：不产生撤销记录 */
function patch(next: Partial<CanvasNode>, record = true) {
  store.updateNode(props.node.id, next, record)
}

function commitPrompt() {
  if (prompt.value !== props.node.prompt) patch({ prompt: prompt.value })
}

/** 点生成前先把还在输入框里的提示词写进节点，否则键盘操作或未失焦时会拿到旧提示词 */
function generate() {
  commitPrompt()
  emit('generate')
}

function changeModel(id: string, record = true) {
  const model = models.value.find((m) => m.id === id)
  const fitted = fitToModel(model, props.node)
  // 已经有成品（上传的、生成过的）时节点尺寸跟着成品走，不能被模型的默认比例改掉
  const next: Partial<CanvasNode> = { modelId: id, ...fitted }
  if (showRatio.value && !props.node.url) next.h = heightForRatio(props.node.w, fitted.ratio)
  patch(next, record)
}

function onRatio(ratio: string) {
  patch({ ratio, ...(props.node.url ? {} : { h: heightForRatio(props.node.w, ratio) }) })
}

function removeRef(fromId: string) {
  const edge = store.edges.find((e) => e.from === fromId && e.to === props.node.id)
  if (edge) store.removeEdge(edge.id)
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  try {
    const uploaded = await uploadMedia(withMediaType(file))
    patch({
      url: uploaded.url,
      thumb: uploaded.thumbUrl ?? undefined,
      title: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || props.node.title,
      ...(await mediaSizeFor(kind.value, uploaded.thumbUrl ?? uploaded.url)),
    })
  } finally {
    uploading.value = false
  }
}

async function onPick([asset]: UserAsset[]) {
  if (!asset) return
  if (props.node.type === 'text') return patch({ text: asset.content ?? '', title: asset.name })
  patch({ url: asset.url ?? undefined, thumb: undefined, title: asset.name, ...(asset.url ? await mediaSizeFor(kind.value, asset.url) : {}) })
}
</script>

<style scoped>
.panel { width: min(760px, calc(100% - 32px)); padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-card); box-shadow: var(--shadow-lg); }
.refs { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.refs-label { font-size: 12px; font-weight: 700; color: var(--color-text-tertiary); }
.refs-tip { margin-left: auto; font-size: 11.5px; color: var(--color-text-tertiary); }
.bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.spacer { flex: 1; }
.w-model { width: 270px; }
.w-num { width: 100px; }
@media (max-width: 960px) {
  .panel { width: 100%; padding: 6px; border: 0; box-shadow: none; }
  .w-model { width: 100%; }
  .bar .el-button { min-height: 36px; margin: 0; }
  .refs-tip { margin-left: 0; }
  .panel :deep(.el-input__inner) { font-size: 16px; }
}
</style>
