<template>
  <div v-loading="!task" class="tool-result">
    <template v-if="task">
      <header class="result-head">
        <div class="head-text">
          <h2>{{ title }}</h2>
          <p>
            <span v-if="modeLabel">{{ modeLabel }} · </span>{{ dateTime(task.createdAt) }}
            <span v-if="task.chargeCents"> · 消耗 ¥{{ yuan(task.chargeCents) }}</span>
          </p>
        </div>
        <div class="head-actions">
          <el-button :icon="Plus" @click="emit('new')">新建</el-button>
          <el-button :icon="Delete" :disabled="task.status === 'running'" @click="remove">删除</el-button>
        </div>
      </header>

      <section v-if="task.status === 'running'" class="panel state-card">
        <div class="pulse"><el-icon :size="30" class="is-loading"><Loading /></el-icon></div>
        <strong>正在处理</strong>
        <p>{{ runningHint }}</p>
      </section>

      <section v-else-if="task.status === 'failed'" class="panel state-card failed">
        <el-icon :size="30"><CircleCloseFilled /></el-icon>
        <strong>处理失败，费用已退回</strong>
        <p>{{ task.error }}</p>
        <el-button type="primary" @click="emit('new')">重新提交</el-button>
      </section>

      <template v-else>
        <section v-if="videos.length && task.tool !== 'viral-clone'" class="panel media-card">
          <video :key="activeVideo?.url" class="player" :src="activeVideo?.url" :poster="videos.length === 1 ? task.thumbUrl ?? undefined : undefined" controls playsinline preload="metadata" />
          <div class="media-bar">
            <div v-if="videos.length > 1" class="variants">
              <button v-for="(item, i) in videos" :key="item.url" type="button" class="version-chip" :class="{ 'is-active': i === activeIndex }" @click="activeIndex = i">
                {{ item.label }}
              </button>
            </div>
            <a v-if="activeVideo" :href="activeVideo.url" target="_blank" rel="noopener" download class="download"><el-icon><Download /></el-icon>下载{{ videos.length > 1 ? '当前' : '' }}</a>
            <VideoShareButton v-if="activeVideo" source="tool" :id="task.id" :video="activeVideo.url" :title="activeVideo.label" />
          </div>
          <ol v-if="segments.length" class="segments">
            <li v-for="(item, i) in segments" :key="i"><b>{{ item.title }}</b><span>{{ item.summary }}</span></li>
          </ol>
        </section>

        <section v-if="images.length" class="panel">
          <div class="section-head">
            <h3>{{ images.length > 1 ? `共 ${images.length} 张` : '结果' }}</h3>
          </div>
          <div class="image-grid" :class="{ 'is-single': images.length === 1 }">
            <figure v-for="(item, i) in images" :key="item.url">
              <el-image :src="item.url" :preview-src-list="imageUrls" :initial-index="i" fit="contain" lazy preview-teleported />
              <figcaption>
                <span>{{ item.label }}</span>
                <a :href="item.url" target="_blank" rel="noopener" download>下载</a>
              </figcaption>
            </figure>
          </div>
        </section>

        <section v-if="audios.length" class="panel">
          <div class="section-head"><h3>音轨</h3></div>
          <div class="audio-list">
            <div v-for="item in audios" :key="item.url" class="audio-row">
              <b>{{ item.label }}</b>
              <audio :src="item.url" controls preload="metadata" />
              <a :href="item.url" target="_blank" rel="noopener" download>下载</a>
            </div>
          </div>
        </section>

        <section v-if="subtitles.length" class="panel">
          <div class="section-head">
            <h3>字幕 · {{ subtitles.length }} 句</h3>
            <div class="section-actions">
              <el-button size="small" @click="copyText">复制全文</el-button>
              <el-button size="small" @click="exportText('txt')">导出 TXT</el-button>
              <el-button size="small" type="primary" @click="exportText('srt')">导出 SRT</el-button>
            </div>
          </div>
          <el-table :data="subtitles" height="420" size="small">
            <el-table-column label="时间" width="150"><template #default="{ row }">{{ clock(row.start) }} – {{ clock(row.end) }}</template></el-table-column>
            <el-table-column v-if="subtitles.some((s) => s.speaker != null)" label="说话人" width="80" prop="speaker" />
            <el-table-column label="内容" prop="text" />
          </el-table>
        </section>

        <section v-if="script" class="panel script">
          <div class="section-head">
            <h3>剧本</h3>
            <div class="section-actions">
              <a :href="scriptFile?.url" target="_blank" rel="noopener" download><el-button size="small">下载 JSON</el-button></a>
              <el-button size="small" type="primary" @click="toRecap">用它生成解说视频</el-button>
            </div>
          </div>
          <p v-if="script.plot" class="plot">{{ script.plot }}</p>
          <div class="script-stats">
            <span><b>{{ script.people.length }}</b>人物</span>
            <span><b>{{ script.scenes.length }}</b>场景</span>
            <span><b>{{ script.dialogues }}</b>句台词</span>
          </div>
          <div v-if="script.people.length" class="people">
            <span v-for="name in script.people" :key="name">{{ name }}</span>
          </div>
          <ol v-if="script.scenes.length" class="scene-list">
            <li v-for="(name, i) in script.scenes" :key="i">{{ name }}</li>
          </ol>
        </section>

        <CloneStudio v-if="task.tool === 'viral-clone'" :task="task" @refresh="load" />
      </template>

      <section class="panel params">
        <h3>输入与参数</h3>
        <ul>
          <li v-for="(file, i) in task.inputs" :key="i"><span>文件</span><b>{{ file.name }}<em v-if="file.durationSec"> · {{ clock(file.durationSec) }}</em></b></li>
          <li v-for="item in paramList" :key="item.label"><span>{{ item.label }}</span><b>{{ item.value }}</b></li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import VideoShareButton from '@/components/VideoShareButton.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CircleCloseFilled, Delete, Download, Loading, Plus } from '@element-plus/icons-vue'
import { clock, deleteToolTask, getToolTask, type ToolDef, type ToolTask } from '@/api/media-tools'
import { copyText as copyToClipboard } from '@/utils/clipboard'
import { downloadTextFile } from '@/utils/download'
import { dateTime, yuan } from '@/utils/format'
import CloneStudio from './CloneStudio.vue'

const props = defineProps<{ taskId: string; tool: ToolDef }>()
const emit = defineEmits<{ changed: [ToolTask]; deleted: [string]; new: [] }>()

const POLL_MS = 4000
const router = useRouter()
const task = ref<ToolTask>()
const activeIndex = ref(0)
const script = ref<{ plot: string; people: string[]; scenes: string[]; dialogues: number }>()
let timer: number | undefined

const mode = computed(() => props.tool.modes.find((item) => item.id === task.value?.mode))
const modeLabel = computed(() => (props.tool.modes.length > 1 ? mode.value?.label : ''))
const title = computed(() => {
  const inputs = task.value?.inputs ?? []
  if (!inputs.length) return props.tool.name
  return inputs.length > 1 ? `${inputs[0].name} 等 ${inputs.length} 个文件` : inputs[0].name
})
const runningHint = computed(() =>
  mode.value?.sync ? '通常几秒到几十秒完成' : '视频处理通常需要视频时长的几倍时间。可以先离开页面，完成后左侧记录会自动更新',
)

const outputsOf = (kind: string) => task.value?.outputs.filter((item) => item.kind === kind) ?? []
const videos = computed(() => outputsOf('video'))
const images = computed(() => outputsOf('image'))
const audios = computed(() => outputsOf('audio'))
const imageUrls = computed(() => images.value.map((item) => item.url))
const activeVideo = computed(() => videos.value[activeIndex.value] ?? videos.value[0])
const scriptFile = computed(() => (task.value?.tool === 'drama-script' ? outputsOf('file')[0] : undefined))

const subtitles = computed<Array<{ text: string; start: number; end: number; speaker?: string | number }>>(() => task.value?.data?.subtitles ?? [])
const segments = computed<Array<{ title: string; summary: string }>>(() => task.value?.data?.segments?.[activeIndex.value] ?? [])

/** 参数摘要：用目录里的中文名展示，内部参数不显示 */
const paramList = computed(() => {
  const values = task.value?.values ?? {}
  return (mode.value?.options ?? [])
    .filter((option) => values[option.key] !== undefined && !['boxes', 'mask', 'record'].includes(option.type))
    .map((option) => {
      const value = values[option.key]
      const choice = option.choices?.find((item) => item.value === value)
      let text = choice?.label ?? String(value)
      if (option.type === 'switch') text = value ? '开' : '关'
      if (option.type === 'tags') text = (value as number[]).map((n) => `${n}${option.unit ?? ''}`).join('、')
      if (option.type === 'pairs') text = (value as Array<{ from: string; to: string }>).map((p) => `${p.from} → ${p.to}`).join('；')
      return { label: option.label, value: text }
    })
})

async function load() {
  window.clearTimeout(timer)
  const next = await getToolTask(props.taskId)
  task.value = next
  emit('changed', next)
  const generating = next.generations?.some((item) => item.status === 'queued' || item.status === 'running')
  if (next.status === 'running' || generating) timer = window.setTimeout(() => void load().catch(() => undefined), POLL_MS)
}

/** 剧本文件较大，只在打开时取一次做摘要。结构见 MediaKit 剧本还原文档：Plot / Scenes[].Title / People[].Name / Dialogues */
watch(scriptFile, async (file) => {
  if (!file) return
  try {
    const json = await (await fetch(file.url)).json()
    script.value = {
      plot: String(json.Plot ?? ''),
      people: (json.People ?? []).map((p: { Name?: string }) => p.Name ?? '').filter(Boolean),
      scenes: (json.Scenes ?? []).map((s: { Title?: string }) => s.Title ?? '').filter(Boolean),
      dialogues: (json.Dialogues ?? []).length,
    }
  } catch {
    script.value = { plot: '', people: [], scenes: [], dialogues: 0 }
  }
})

const srtTime = (seconds: number) => {
  const ms = Math.round(seconds * 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor((ms % 3_600_000) / 60_000))}:${pad(Math.floor((ms % 60_000) / 1000))},${pad(ms % 1000, 3)}`
}

function exportText(format: 'srt' | 'txt') {
  const base = title.value.replace(/\.[^.]+$/, '')
  const content =
    format === 'srt'
      ? subtitles.value.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`).join('\n')
      : subtitles.value.map((s) => s.text).join('\n')
  downloadTextFile(`${base}.${format}`, content, 'text/plain;charset=utf-8')
}

const copyText = () => copyToClipboard(subtitles.value.map((s) => s.text).join('\n'), '已复制全文')

function toRecap() {
  router.push({ path: '/video-tools/drama-recap', query: { script: props.taskId } })
}

async function remove() {
  await ElMessageBox.confirm('删除后结果文件会一起删除，无法恢复。', '删除记录', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  await deleteToolTask(props.taskId)
  ElMessage.success('已删除')
  emit('deleted', props.taskId)
}

void load()
onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<style scoped>
.tool-result { display: flex; flex-direction: column; gap: 14px; min-height: 240px; }
.result-head { display: flex; align-items: center; gap: 16px; }
.head-text { flex: 1; min-width: 0; }
.head-text h2 { font-size: 18px; font-weight: 750; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.head-text p { margin-top: 2px; font-size: 12.5px; color: var(--color-text-tertiary); }
.head-actions { display: flex; gap: 8px; }

.state-card { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 24px; text-align: center; color: var(--color-primary); }
.state-card strong { font-size: 17px; color: var(--color-text-primary); }
.state-card p { max-width: 460px; font-size: 13px; line-height: 1.7; color: var(--color-text-secondary); }
.state-card.failed { color: var(--color-error); }
.pulse { width: 64px; height: 64px; display: grid; place-items: center; border-radius: 50%; background: var(--color-primary-soft); animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { box-shadow: 0 0 0 12px color-mix(in srgb, var(--color-primary) 10%, transparent); } }

.media-card { padding: 14px; }
.player { width: 100%; max-height: 62vh; border-radius: 14px; background: #0f1512; display: block; }
.media-bar { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.variants { flex: 1; display: flex; flex-wrap: wrap; gap: 6px; }
.download { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 600; color: var(--color-primary); }
.segments { margin: 12px 0 0 18px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.segments b { margin-right: 6px; }
.segments span { color: var(--color-text-secondary); }

.section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.section-head h3 { font-size: 15px; font-weight: 700; }
.section-actions { display: flex; flex-wrap: wrap; gap: 6px; }

.image-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.image-grid.is-single { grid-template-columns: 1fr; }
.image-grid figure { display: flex; flex-direction: column; gap: 6px; }
.image-grid .el-image {
  width: 100%; aspect-ratio: 1; border-radius: 12px; overflow: hidden;
  background: repeating-conic-gradient(var(--color-bg-secondary) 0 25%, var(--color-card) 0 50%) 0 / 18px 18px;
}
.image-grid.is-single .el-image { aspect-ratio: auto; max-height: 60vh; }
.image-grid figcaption { display: flex; justify-content: space-between; font-size: 12px; color: var(--color-text-tertiary); }
.image-grid a, .audio-row a { color: var(--color-primary); font-weight: 600; }

.audio-list { display: flex; flex-direction: column; gap: 10px; }
.audio-row { display: flex; align-items: center; gap: 14px; padding: 10px 14px; border-radius: 12px; background: var(--color-bg-secondary); }
.audio-row b { width: 56px; flex-shrink: 0; font-size: 13px; }
.audio-row audio { flex: 1; min-width: 0; height: 36px; }
.audio-row a { font-size: 13px; }

.plot { font-size: 13.5px; line-height: 1.8; color: var(--color-text-secondary); }
.script-stats { display: flex; gap: 24px; margin: 14px 0; }
.script-stats span { display: flex; align-items: baseline; gap: 4px; font-size: 12.5px; color: var(--color-text-tertiary); }
.script-stats b { font-size: 20px; color: var(--color-primary); }
.people { display: flex; flex-wrap: wrap; gap: 6px; }
.scene-list { margin: 14px 0 0 20px; columns: 2 240px; column-gap: 24px; font-size: 13px; line-height: 1.9; color: var(--color-text-secondary); }
.people span { padding: 3px 10px; border-radius: 999px; background: var(--color-primary-soft); color: var(--color-primary-dark); font-size: 12.5px; }

.params { padding: 16px 20px; }
.params h3 { margin-bottom: 10px; font-size: 14px; }
.params ul { list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px 20px; }
.params li { display: flex; gap: 10px; font-size: 13px; min-width: 0; }
.params li span { flex-shrink: 0; width: 72px; color: var(--color-text-tertiary); }
.params li b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.params li em { font-style: normal; font-weight: 400; color: var(--color-text-tertiary); }
@media (max-width: 640px) {
  .result-head, .media-bar, .section-head { flex-wrap: wrap; gap: 8px; }
  .head-text { flex-basis: 100%; }
  .head-actions .el-button + .el-button { margin-left: 0; }
  .variants { flex-basis: 100%; }
  .version-chip { min-height: 36px; }
  .audio-row { flex-wrap: wrap; gap: 8px; }
  .audio-row audio { flex-basis: 100%; }
  .params { padding: 14px; }
  .params ul { grid-template-columns: minmax(0, 1fr); }
}
</style>
