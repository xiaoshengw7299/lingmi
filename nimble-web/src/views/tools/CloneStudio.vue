<template>
  <section class="panel clone">
    <div class="materials">
      <div class="group">
        <span class="label">动作 {{ clock(motionSec) }}</span>
        <figure class="tile">
          <div class="frame is-motion">
            <video :src="motion?.url" muted loop autoplay playsinline />
          </div>
          <a v-if="motion?.url" class="motion-dl" :href="motion.url" target="_blank" rel="noopener" download>下载</a>
        </figure>
        <VideoShareButton v-if="motion?.url" source="tool" :id="task.id" :video="motion.url" title="动作视频" />
      </div>

      <div class="group">
        <span class="label">人物 / 商品</span>
        <div class="tiles">
          <figure v-for="(item, i) in people" :key="item.key" class="tile">
            <div class="frame">
              <img :src="item.url" alt="" />
              <button type="button" aria-label="移除" @click="people.splice(i, 1)">×</button>
            </div>
            <figcaption>@Image{{ i + 1 }}</figcaption>
          </figure>
          <button v-if="room > 0" type="button" class="tile add" :disabled="uploading === 'people'" @click="pick('people')">
            <span class="frame is-add">
              <el-icon :class="{ 'is-loading': uploading === 'people' }"><component :is="uploading === 'people' ? 'Loading' : 'Plus'" /></el-icon>
              {{ uploading === 'people' ? '上传中' : '添加' }}
            </span>
          </button>
        </div>
      </div>

      <div class="group">
        <span class="label">场景</span>
        <div class="tiles">
          <figure v-for="(item, i) in scenes" :key="item.key" class="tile">
            <div class="frame">
              <img :src="item.url" alt="" />
              <button type="button" aria-label="移除" @click="scenes.splice(i, 1)">×</button>
            </div>
            <figcaption>@Image{{ people.length + i + 1 }}</figcaption>
          </figure>
          <button v-if="room > 0" type="button" class="tile add" :disabled="uploading === 'scenes'" @click="pick('scenes')">
            <span class="frame is-add">
              <el-icon :class="{ 'is-loading': uploading === 'scenes' }"><component :is="uploading === 'scenes' ? 'Loading' : 'Plus'" /></el-icon>
              {{ uploading === 'scenes' ? '上传中' : '添加' }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <el-input
      v-model="prompt"
      class="prompt"
      type="textarea"
      :autosize="{ minRows: 2, maxRows: 4 }"
      maxlength="2000"
      placeholder="提示词已按人物和场景写好，可以直接改"
      @input="edited = true"
    />

    <input ref="picker" type="file" accept="image/*" multiple class="hidden-input" @change="onPick" />
    <p v-if="tooMany" class="warn">当前模型最多 {{ maxRefs }} 张参考图，请删掉多出来的</p>

    <div class="bar">
      <ModelPicker
        v-model:model-id="modelId"
        v-model:ratio="ratio"
        v-model:resolution="resolution"
        :models="models"
        hide-description
      />
      <span class="duration">
        时长
        <el-input-number v-model="durationSec" :min="model?.minDuration ?? 4" :max="maxDuration" size="small" />
        秒
      </span>
      <el-checkbox v-if="model?.supportsGenerateAudio" v-model="generateAudio">音效</el-checkbox>
      <el-button type="primary" class="generate-btn" :loading="submitting" :disabled="!ready" @click="submit">生成视频</el-button>
    </div>
    <p v-if="tooLong" class="warn">所选模型的参考视频最长 {{ model?.maxReferenceDurationSec }} 秒，请换一个模型</p>

    <div v-if="task.generations?.length" class="results">
      <div class="result-grid">
        <div v-for="item in task.generations" :key="item.id" class="result-card">
          <video v-if="item.status === 'succeeded' && item.url" :src="item.url" :poster="item.thumbUrl ?? undefined" controls playsinline preload="metadata" />
          <div v-else-if="item.status === 'failed'" class="result-state failed">{{ item.error || '生成失败，费用已退回' }}</div>
          <div v-else class="result-state"><el-icon class="is-loading" :size="18"><Loading /></el-icon>生成中</div>
          <div class="result-meta">
            <span>{{ item.modelName?.replace('|', ' ') }}</span>
            <a v-if="item.url" :href="item.url" target="_blank" rel="noopener" download>下载</a>
          </div>
          <VideoShareButton v-if="item.status === 'succeeded' && item.url" source="generation" :id="item.id" :video="item.url" :title="task.inputs[0]?.name" />
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import VideoShareButton from '@/components/VideoShareButton.vue'
import { getGenerationModels } from '@/api/generation'
import { clock, cloneGenerate, uploadCloneRef, type ToolTask } from '@/api/media-tools'
import type { MediaModelOption } from '@/api/video'
import ModelPicker from '@/views/video-producer/components/ModelPicker.vue'

const props = defineProps<{ task: ToolTask }>()
const emit = defineEmits<{ refresh: [] }>()

/** 和生成接口一致，人物图和场景图加起来最多 9 张 */
const REF_CAP = 9
type Shot = { key: string; url: string }
type Group = 'people' | 'scenes'

const picker = ref<HTMLInputElement>()
const models = ref<MediaModelOption[]>([])
const modelId = ref<string>()
const ratio = ref<string>()
const resolution = ref<string>()
const durationSec = ref(5)
const generateAudio = ref(false)
const people = ref<Shot[]>([])
const scenes = ref<Shot[]>([])
const prompt = ref('')
const edited = ref(false)
const uploading = ref<Group | ''>('')
const pending = ref<Group>('people')
const submitting = ref(false)

const motion = computed(() => props.task.outputs.find((item) => item.kind === 'video'))
const motionSec = computed(() => Number(props.task.data?.durationSec) || props.task.inputs[0]?.durationSec || 0)
const model = computed(() => models.value.find((item) => item.id === modelId.value))
const maxDuration = computed(() => model.value?.maxDuration ?? 30)
const maxRefs = computed(() => Math.min(REF_CAP, Math.max(1, model.value?.maxReferenceImages || REF_CAP)))
const room = computed(() => maxRefs.value - people.value.length - scenes.value.length)
const tooLong = computed(() => !!model.value?.maxReferenceDurationSec && motionSec.value > model.value.maxReferenceDurationSec + 0.5)
const tooMany = computed(() => room.value < 0)
const ready = computed(() => !!motion.value && !!model.value && !tooLong.value && !tooMany.value && !!prompt.value.trim() && !uploading.value)

/** 人物图在前、场景图在后，编号和提交顺序一致 */
function syncPrompt() {
  if (edited.value) return
  const personTags = people.value.map((_, i) => `@Image${i + 1}`)
  const sceneTags = scenes.value.map((_, i) => `@Image${people.value.length + i + 1}`)
  const who = personTags.length ? `让 ${personTags.join('、')} 中的人物或商品` : '让画面中的主体'
  const where = sceneTags.length ? `在 ${sceneTags.join('、')} 的场景里` : ''
  prompt.value = `参考 @Video1 的人物动作、肢体节奏、走位和镜头运动，${who}${where}完整复刻同样的动作。动作流畅连贯，与参考视频节奏一致，人物形象稳定，光影真实，画面清晰。`
}

watch([people, scenes], syncPrompt, { deep: true })
watch(model, (next) => {
  if (!next) return
  durationSec.value = Math.min(next.maxDuration, Math.max(next.minDuration, Math.round(motionSec.value) || next.minDuration))
})

function pick(group: Group) {
  pending.value = group
  picker.value?.click()
}

async function onPick(e: Event) {
  const target = e.target as HTMLInputElement
  const files = [...(target.files ?? [])]
  const group = pending.value
  target.value = ''
  if (!files.length || room.value <= 0) return
  if (files.length > room.value) ElMessage.warning(`最多 ${maxRefs.value} 张，多出来的已忽略`)
  const accepted = files.slice(0, room.value)
  uploading.value = group
  try {
    const uploaded = await Promise.all(accepted.map((file) => uploadCloneRef(props.task.id, file)))
    if (group === 'people') people.value.push(...uploaded)
    else scenes.value.push(...uploaded)
  } finally {
    uploading.value = ''
  }
}

async function submit() {
  submitting.value = true
  try {
    await cloneGenerate(props.task.id, {
      prompt: prompt.value.trim(),
      modelId: modelId.value,
      ratio: ratio.value,
      resolution: resolution.value,
      durationSec: durationSec.value,
      generateAudio: generateAudio.value,
      refImages: [...people.value, ...scenes.value].map((item) => item.key),
    })
    ElMessage.success('已开始生成，完成后显示在下方')
    emit('refresh')
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  syncPrompt()
  models.value = (await getGenerationModels()).video.filter((item) => item.maxReferenceVideos > 0)
  modelId.value = models.value.find((item) => item.isDefault)?.id ?? models.value[0]?.id
})
</script>

<style scoped>
.clone { padding: 18px 20px 20px; display: flex; flex-direction: column; gap: 16px; }

.materials { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; align-items: start; }
.group { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.label { font-size: 13px; font-weight: 650; color: var(--color-text-secondary); }
.tiles { display: flex; flex-wrap: wrap; gap: 12px; }

.tile { position: relative; width: 168px; flex: none; display: flex; flex-direction: column; gap: 6px; }
.motion-dl {
  position: absolute; top: 8px; left: 8px; z-index: 1; padding: 2px 8px; border-radius: 8px;
  background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 12px; line-height: 20px;
}
.frame { position: relative; width: 100%; aspect-ratio: 9 / 16; border-radius: 14px; overflow: hidden; background: #0f1512; }
.frame img, .frame video { width: 100%; height: 100%; object-fit: contain; }
.frame button {
  position: absolute; top: 8px; right: 8px; width: 22px; height: 22px; border: 0; border-radius: 50%;
  background: rgba(0, 0, 0, 0.55); color: #fff; cursor: pointer; line-height: 22px; font-size: 14px;
}
.tile figcaption { font-size: 12.5px; color: var(--color-text-tertiary); text-align: center; }

.add { padding: 0; border: 0; background: none; cursor: pointer; }
.add:disabled { cursor: progress; }
.frame.is-add {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  border: 1.5px dashed var(--color-primary-line); background: var(--color-primary-soft); color: var(--color-primary);
  font-size: 14px; font-weight: 650;
}
.frame.is-add .el-icon { font-size: 22px; }

.prompt :deep(.el-textarea__inner) { font-size: 13px; line-height: 1.6; }

.bar {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: 10px 14px;
  padding-top: 12px; border-top: 1px solid var(--color-divider);
}
.bar :deep(.model-picker) { flex: none; width: 240px; max-width: 100%; }
.bar .generate-btn { width: auto; height: 40px; margin: 0; padding: 0 28px; flex: none; }
.duration { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--color-text-secondary); white-space: nowrap; }
.warn { font-size: 12.5px; color: var(--color-warning); }

.results { padding-top: 4px; border-top: 1px solid var(--color-divider); }
.result-grid { display: flex; gap: 10px; overflow-x: auto; }
.result-card { width: 168px; flex: none; display: flex; flex-direction: column; gap: 6px; }
.result-card video, .result-state { width: 100%; aspect-ratio: 9 / 16; height: auto; border-radius: 14px; background: #0f1512; object-fit: contain; }
.result-state { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; color: #cbd5d0; font-size: 12px; text-align: center; }
.result-state.failed { color: #f3a5a5; }
.result-meta { display: flex; justify-content: space-between; gap: 6px; font-size: 11.5px; color: var(--color-text-tertiary); }
.result-meta span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-meta a { flex-shrink: 0; color: var(--color-primary); font-weight: 600; }

@media (max-width: 860px) {
  .materials { grid-template-columns: 1fr; }
  .clone { padding: 14px; }
  .materials { gap: 16px; }
  .tiles { gap: 8px; }
  .tile { width: min(128px, calc((100% - 8px) / 2)); }
  .frame button { width: 34px; height: 34px; }
  .bar :deep(.model-picker), .bar .generate-btn { width: 100%; }
  .prompt :deep(.el-textarea__inner) { font-size: 16px; }
}
</style>
