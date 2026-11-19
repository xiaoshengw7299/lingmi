<template>
  <el-dialog v-model="visible" title="发布提示词" width="min(1080px, 94vw)" append-to-body destroy-on-close @open="init">
    <div class="layout">
      <el-form label-position="top" class="form" @submit.prevent>
        <el-form-item label="标题"><el-input v-model="form.title" maxlength="60" placeholder="例如：赛博朋克雨夜街头" /></el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="form.type" @change="onTypeChange">
            <el-radio-button value="image">图片</el-radio-button>
            <el-radio-button value="video">视频</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="模型">
          <ModelPicker
            layout="block"
            hide-description
            :models="models"
            :model-id="form.modelId"
            :ratio="form.ratio"
            :resolution="form.resolution"
            @update:model-id="(id) => { form.modelId = id; onModelChange() }"
            @update:ratio="(v) => (form.ratio = v)"
            @update:resolution="(v) => (form.resolution = v ?? '')"
          />
        </el-form-item>
        <el-form-item v-if="form.type === 'video' && current" label="时长（秒）">
          <el-input-number v-model="form.durationSec" :min="current.minDuration" :max="current.maxDuration" />
        </el-form-item>

        <el-form-item>
          <template #label>
            参考素材<span class="opt">（可选）上传别人复现时要用的图片 / 视频 / 音频，在提示词里输入 @ 引用</span>
          </template>
          <div class="refs">
            <div v-for="(ref, i) in refs" :key="ref.url" class="ref">
              <el-image v-if="ref.kind === 'image'" :src="ref.thumb || ref.url" fit="cover" class="ref-media" />
              <video v-else-if="ref.kind === 'video'" :src="ref.url" muted playsinline preload="metadata" class="ref-media" />
              <div v-else class="ref-media ref-audio"><el-icon><Headset /></el-icon></div>
              <el-input v-model="ref.name" size="small" maxlength="20" @change="ref.name = cleanName(ref.name, i)" />
              <el-button class="ref-del" :icon="Close" circle size="small" @click="refs.splice(i, 1)" />
            </div>
            <el-dropdown v-if="refs.length < MAX_REFS" trigger="click" @command="(c: string) => (c === 'upload' ? fileInput?.click() : (pickerVisible = true))">
              <button type="button" class="ref ref-add" :disabled="uploading">
                <el-icon v-if="uploading" class="is-loading"><Loading /></el-icon>
                <el-icon v-else><Plus /></el-icon>
                <span>添加参考</span>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="upload" :icon="Upload">上传本地文件</el-dropdown-item>
                  <el-dropdown-item command="assets" :icon="FolderOpened">从我的资产选择</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
          <input ref="fileInput" type="file" accept="image/*,video/*,audio/*" multiple hidden @change="onFiles" />
        </el-form-item>

        <el-form-item label="提示词" class="prompt-item">
          <MentionInput v-model="form.content" class="prompt-input" :options="mentionOptions" :rows="8" placeholder="描述画面主体、风格、镜头、光线……有参考素材时输入 @ 引用" />
        </el-form-item>
      </el-form>

      <div class="result">
        <div class="stage">
          <el-image v-if="task?.url && form.type === 'image'" :src="task.url" fit="contain" />
          <video v-else-if="task?.url" :src="task.url" controls playsinline />
          <div v-else-if="generating" class="hint"><el-icon class="is-loading" :size="24"><Loading /></el-icon><span>生成中，视频可能需要几分钟…</span></div>
          <div v-else-if="generateError" class="hint is-error"><el-icon :size="26"><WarningFilled /></el-icon><span>{{ generateError }}</span></div>
          <div v-else class="hint"><el-icon :size="26"><Picture /></el-icon><span>先生成一次，满意后再发布，让大家看到效果</span></div>
        </div>
        <p v-if="problem" class="problem">{{ problem }}</p>
        <VideoShareButton v-if="task?.url && form.type === 'video'" source="generation" :id="task.id" :video="task.url" :title="form.title" />
        <el-button type="primary" :loading="generating" :disabled="!!problem || !canGenerate" @click="generate">{{ task ? '重新生成' : '生成示例' }}</el-button>
      </div>
    </div>

    <AssetPickerDialog v-model="pickerVisible" :kinds="['image', 'video', 'audio']" @confirm="addFromAssets" />

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="!task?.url || !form.title.trim()" :loading="publishing" @click="publish">发布到提示词库</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Close, FolderOpened, Headset, Loading, Picture, Plus, Upload, WarningFilled } from '@element-plus/icons-vue'
import AssetPickerDialog from '@/components/AssetPickerDialog.vue'
import VideoShareButton from '@/components/VideoShareButton.vue'
import MentionInput, { type MentionOption } from '@/views/video-producer/components/MentionInput.vue'
import ModelPicker from '@/views/video-producer/components/ModelPicker.vue'
import type { UserAsset } from '@/api/asset'
import { runGeneration, uploadMedia, type GenerationModels, type GenerationTask } from '@/api/generation'
import type { MediaModelOption } from '@/api/video'
import { createPrompt, type PromptItem, type PromptType } from '@/api/prompt'
import { defaultModel, fitToModel, loadGenerationModels } from '@/utils/model-params'
import { compileReferences, MENTION_FORBIDDEN, type RefKind } from '@/utils/references'

interface Ref {
  name: string
  kind: 'image' | 'video' | 'audio'
  url: string
  thumb?: string
}

const MAX_REFS = 9
const KIND_LABEL = { image: '图片', video: '视频', audio: '音频' } as const

const emit = defineEmits<{ published: [prompt: PromptItem] }>()
const visible = defineModel<boolean>({ default: false })

const form = reactive({ title: '', content: '', type: 'image' as PromptType, modelId: '', ratio: '', resolution: '', durationSec: 5 })
const refs = ref<Ref[]>([])
const allModels = ref<GenerationModels>()
const task = ref<GenerationTask>()
const generateError = ref('')
const generating = ref(false)
const publishing = ref(false)
const uploading = ref(false)
const pickerVisible = ref(false)
const fileInput = ref<HTMLInputElement>()

const models = computed<MediaModelOption[]>(() => allModels.value?.[form.type] ?? [])
const current = computed(() => models.value.find((m) => m.id === form.modelId))
const canGenerate = computed(() => !!form.content.trim() && !!form.modelId)
const mentionOptions = computed<MentionOption[]>(() => refs.value.map((r) => ({ name: r.name, type: r.kind, url: r.thumb || r.url })))

/** 参考素材数量超过所选模型的上限时直接提示，别等生成失败才知道 */
const problem = computed(() => {
  const m = current.value
  if (!m) return ''
  const count = (kind: Ref['kind']) => refs.value.filter((r) => r.kind === kind).length
  const limits = [['image', m.maxReferenceImages], ['video', m.maxReferenceVideos], ['audio', m.maxReferenceAudios]] as const
  for (const [kind, max] of limits) {
    if (count(kind) > max) return max ? `${m.name}最多支持 ${max} 个参考${KIND_LABEL[kind]}` : `${m.name}不支持参考${KIND_LABEL[kind]}，请换模型或移除`
  }
  return ''
})

async function init() {
  Object.assign(form, { title: '', content: '', type: 'image', durationSec: 5 })
  refs.value = []
  task.value = undefined
  generateError.value = ''
  allModels.value ??= await loadGenerationModels()
  onTypeChange()
}

/** 切换类型或模型时，把参数收敛到该模型支持的取值 */
function onTypeChange() {
  task.value = undefined
  generateError.value = ''
  form.modelId = defaultModel(models.value)?.id ?? ''
  onModelChange()
}

function onModelChange() {
  const fitted = fitToModel(current.value, form)
  form.ratio = fitted.ratio ?? ''
  form.resolution = fitted.resolution ?? ''
  form.durationSec = fitted.durationSec ?? form.durationSec
}

// ─── 参考素材 ──────────────────────────────────────────────

/** 名称只能是不含空格标点的短词，且互不重复，@ 才不会指错 */
function cleanName(raw: string, selfIndex = -1, fallback = '参考') {
  const base = raw.replace(MENTION_FORBIDDEN, '').slice(0, 20) || fallback
  let name = base
  for (let n = 2; refs.value.some((r, i) => i !== selfIndex && r.name === name); n++) name = `${base}${n}`
  return name
}

function addRef(kind: Ref['kind'], url: string, title: string, thumb?: string) {
  if (refs.value.length >= MAX_REFS) return
  refs.value.push({ kind, url, thumb, name: cleanName(title, -1, KIND_LABEL[kind]) })
}

async function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (!files.length) return
  uploading.value = true
  try {
    for (const file of files) {
      const up = await uploadMedia(file)
      addRef(up.kind, up.url, file.name.replace(/\.[^.]+$/, ''), up.thumbUrl ?? undefined)
    }
  } finally {
    uploading.value = false
  }
}

function addFromAssets(assets: UserAsset[]) {
  for (const a of assets) if (a.url && a.kind !== 'prompt') addRef(a.kind, a.url, a.name)
}

// ─── 生成 / 发布 ───────────────────────────────────────────

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const message = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (typeof message === 'string' && message.trim()) return message
    if (Array.isArray(message) && message.length) return message.map(String).join('；')
  }
  if (error instanceof Error && error.message.trim()) return error.message
  return '生成失败'
}

async function generate() {
  generating.value = true
  task.value = undefined
  generateError.value = ''
  try {
    const compiled = compileReferences(form.content, refs.value.map((r) => ({ name: r.name, kind: r.kind as RefKind, url: r.url })))
    task.value = await runGeneration({
      kind: form.type,
      ...compiled,
      modelId: form.modelId,
      ratio: form.ratio || undefined,
      resolution: form.resolution || undefined,
      durationSec: form.type === 'video' ? form.durationSec : undefined,
    })
  } catch (error) {
    generateError.value = errorText(error)
  } finally {
    generating.value = false
  }
}

async function publish() {
  if (!task.value) return
  publishing.value = true
  try {
    const prompt = await createPrompt({
      title: form.title.trim(),
      content: form.content.trim(),
      type: form.type,
      modelId: form.modelId,
      params: { ratio: form.ratio || undefined, resolution: form.resolution || undefined, durationSec: form.type === 'video' ? form.durationSec : undefined },
      references: refs.value.map(({ name, kind, url }) => ({ name, kind, url })),
      taskId: task.value.id,
    })
    ElMessage.success('已发布')
    emit('published', prompt)
    visible.value = false
  } finally {
    publishing.value = false
  }
}
</script>

<style scoped>
.layout {
  display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 20px; align-items: stretch;
  height: min(70vh, 680px); min-height: 520px;
}
.form { min-width: 0; min-height: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.form :deep(.el-form-item) { margin-bottom: 12px; }
.form :deep(.el-form-item__content) { width: 100%; }
.prompt-item { flex: 1; min-height: 0; margin-bottom: 0; display: flex; flex-direction: column; }
.prompt-item :deep(.el-form-item__content) { flex: 1; min-height: 0; width: 100%; align-items: stretch; }
.prompt-input { flex: 1; width: 100%; min-width: 0; min-height: 0; align-self: stretch; }
.prompt-input :deep(.mention-input),
.prompt-input :deep(.mention-editor) { width: 100%; height: 100%; min-height: 0; }
.prompt-input :deep(textarea) { width: 100%; height: 100%; min-height: 180px; resize: none; }
.form :deep(.el-select) { width: 100%; }
.opt { margin-left: 6px; font-size: 12px; font-weight: 400; color: var(--color-text-tertiary); }
.refs { display: flex; flex-wrap: wrap; gap: 10px; width: 100%; }
.ref { position: relative; width: 92px; display: flex; flex-direction: column; gap: 6px; }
.ref-media { width: 92px; height: 70px; border-radius: var(--radius-sm); object-fit: cover; background: var(--color-bg-secondary); }
.ref-audio { display: grid; place-items: center; color: var(--color-text-tertiary); }
.ref-del { position: absolute; right: -6px; top: -6px; width: 20px; height: 20px; }
.ref-add { height: 70px; align-items: center; justify-content: center; gap: 4px; border: 1px dashed var(--color-border); border-radius: var(--radius-sm); background: transparent; color: var(--color-text-secondary); font-size: 12px; cursor: pointer; }
.ref-add:hover { border-color: var(--color-primary); color: var(--color-primary); }
.row { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
.result { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; height: 100%; }
.stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; border: 1px dashed var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-secondary); overflow: hidden; }
.stage :deep(.el-image), .stage video { width: 100%; max-height: 360px; }
.hint { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 20px; text-align: center; font-size: 13px; color: var(--color-text-tertiary); }
.hint.is-error { color: var(--color-error); overflow: auto; max-height: 100%; }
.hint.is-error span { max-width: 240px; line-height: 1.6; word-break: break-word; }
.problem { font-size: 12.5px; color: var(--color-error); }
@media (max-width: 760px) {
  .layout { grid-template-columns: 1fr; height: auto; }
  .form, .result { height: auto; }
}
</style>
