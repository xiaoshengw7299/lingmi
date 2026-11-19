<template>
  <div class="gallery">
    <div class="gallery-header">
      <span class="gallery-title">从这里开始</span>
      <span class="gallery-sub">{{ mode === 'canvas' ? '新建空白画布从零创作，或先预览别人分享的作品再复制成自己的' : `新建空白工作台，或复制别人的作品。${SHARE_REWARD_BRIEF}` }}</span>
      <el-radio-group v-model="sort" size="small" class="gallery-sort" @change="load">
        <el-radio-button value="hot">综合</el-radio-button>
        <el-radio-button value="new">最新</el-radio-button>
      </el-radio-group>
    </div>
    <el-scrollbar class="gallery-scroll">
      <div class="gallery-grid">
        <div
          class="gallery-card gallery-card--blank" :class="{ 'is-disabled': creatingBlank }"
          @click="!creatingBlank && $emit('createBlank')"
        >
          <div class="card-cover card-cover--blank">
            <span v-if="creatingBlank" class="card-loading"><el-icon class="is-loading" :size="20"><Loading /></el-icon></span>
            <span v-else class="blank-icon"><el-icon :size="26"><Plus /></el-icon></span>
          </div>
          <span class="card-name">{{ mode === 'canvas' ? '空白画布' : '空白工作台' }}</span>
        </div>

        <template v-if="loading">
          <div v-for="n in SKELETON_COUNT" :key="n" class="gallery-card skeleton"><div class="card-cover" /><span class="card-name">&nbsp;</span></div>
        </template>
        <div
          v-for="work in works" v-else :key="work.id" class="gallery-card"
          :class="{ 'is-disabled': !!usingExampleId || deletingId === work.id || previewingId === work.id }"
          @click="handlePreview(work)"
        >
          <div class="card-cover">
            <img v-if="work.coverUrl && !brokenCovers.has(work.id)" :src="work.coverUrl" alt="" loading="lazy" @error="brokenCovers.add(work.id)" />
            <el-icon v-else :size="22"><component :is="work.kind === 'canvas' ? MagicStick : VideoCamera" /></el-icon>
            <span class="kind-badge">{{ work.kind === 'canvas' ? '无限画布' : '通用创作' }}</span>
            <span v-if="usingExampleId === work.id || previewingId === work.id" class="card-loading"><el-icon class="is-loading" :size="20"><Loading /></el-icon></span>
            <template v-else>
              <span class="use-count-badge">
                <el-icon :size="12"><View /></el-icon>{{ work.viewCount }}
                <el-icon :size="12"><CopyDocument /></el-icon>{{ work.copyCount }}
              </span>
              <span class="preview-hint">预览作品</span>
            </template>
          </div>
          <span class="card-name" :title="work.title">{{ work.title }}</span>
          <button
            v-if="canDelete(work)" type="button" class="card-delete"
            :disabled="deletingId === work.id" title="删除作品"
            @click.stop="handleDelete(work)"
          >
            <el-icon :size="13"><Delete /></el-icon>
          </button>
        </div>
      </div>
    </el-scrollbar>

    <el-dialog
      v-model="previewVisible"
      class="example-preview-dialog"
      width="94vw"
      align-center
      append-to-body
      destroy-on-close
      :close-on-click-modal="false"
      :lock-scroll="true"
    >
      <template #header>
        <div class="preview-header">
          <div class="preview-title-block">
            <h3 class="preview-title">{{ previewTitle }}</h3>
            <p class="preview-meta">
              <span v-if="previewMeta.by">{{ previewMeta.by }}</span>
              <span>{{ previewMeta.view }} 次查看 · 被复制 {{ previewMeta.copy }} 次</span>
            </p>
          </div>
        </div>
      </template>
      <div class="preview-body">
        <VideoWorkbenchPanel v-if="previewProject" :preview-project="previewProject" readonly />
        <template v-else-if="previewDoc && previewCanvas">
          <CanvasPreview :doc="previewDoc" />
          <ul v-if="previewVideos.length" class="canvas-videos">
            <li v-for="node in previewVideos" :key="node.id">
              <span>{{ node.title }}</span>
              <VideoShareButton source="canvas-example" :id="previewCanvas.id" :video="node.url" :title="node.title" />
            </li>
          </ul>
        </template>
      </div>
      <template #footer>
        <el-button @click="previewVisible = false">关闭</el-button>
        <el-button type="primary" :loading="!!usingExampleId" @click="handleCopy">{{ previewKind === 'canvas' ? '复制到无限画布' : '复制到通用创作' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { VideoCamera, Loading, Plus, View, CopyDocument, Delete, MagicStick } from '@element-plus/icons-vue'
import { deleteCanvasExample, getCanvasExample, listCanvasExamples, viewCanvasExample, type CanvasExampleItem } from '@/api/canvas'
import { listExamples, deleteExample, getExample, viewExample, exampleToPreviewProject, type VideoExample, type VideoProject } from '@/api/video'
import { useAuthStore } from '@/stores/auth'
import CanvasPreview from '@/views/canvas/CanvasPreview.vue'
import VideoShareButton from '@/components/VideoShareButton.vue'
import type { CanvasDoc } from '@/views/canvas/types'
import VideoWorkbenchPanel from '@/views/video-producer/components/VideoWorkbenchPanel.vue'
import { SHARE_REWARD_BRIEF } from '@/views/video-producer/share-reward'

type Work =
  | (VideoExample & { kind: 'studio'; hot: number })
  | (CanvasExampleItem & { kind: 'canvas' })

const SKELETON_COUNT = 7
const PAGE_SIZE = 24

/** mode 决定第一张"新建空白…"卡片的含义；分享的作品两种都展示，混排在一起 */
const props = defineProps<{ mode: 'studio' | 'canvas'; usingExampleId?: string; creatingBlank?: boolean }>()
const emit = defineEmits<{ useExample: [id: string]; useCanvasExample: [id: string]; createBlank: [] }>()

const authStore = useAuthStore()
const works = ref<Work[]>([])
const loading = ref(true)
const sort = ref<'hot' | 'new'>('hot')
const deletingId = ref<string>()
const previewingId = ref<string>()
const previewVisible = ref(false)
const previewKind = ref<Work['kind']>('studio')
const previewExample = ref<VideoExample>()
const previewProject = ref<VideoProject>()
const previewCanvas = ref<{ title: string; createdByName: string | null; viewCount: number; copyCount: number; id: string }>()
const previewDoc = ref<CanvasDoc>()
const previewVideos = computed(() => previewDoc.value?.nodes.filter((node) => node.type === 'video' && node.url) ?? [])
/** 封面加载失败（如对象存储抖动）的作品 id，降级为占位图标，避免出现空白"消失"的观感 */
const brokenCovers = ref<Set<string>>(new Set())

const previewTitle = computed(() => (previewKind.value === 'canvas' ? previewCanvas.value?.title : previewExample.value?.title))
const previewMeta = computed(() => {
  const src = previewKind.value === 'canvas' ? previewCanvas.value : previewExample.value
  return { by: src?.createdByName, view: src?.viewCount ?? 0, copy: src?.copyCount ?? 0 }
})

/** 工作台案例与画布作品并行拉取；任一失败不影响另一边，首页永远能打开 */
async function load() {
  loading.value = !works.value.length
  const [studio, canvas] = await Promise.all([
    listExamples({ pageSize: PAGE_SIZE, sort: sort.value }).then((r) => r.items).catch(() => [] as VideoExample[]),
    listCanvasExamples({ pageSize: PAGE_SIZE, sort: sort.value }).then((r) => r.items).catch(() => [] as CanvasExampleItem[]),
  ])
  const merged: Work[] = [
    ...studio.map((e) => ({ ...e, kind: 'studio' as const, hot: e.hot ?? 0 })),
    ...canvas.map((c) => ({ ...c, kind: 'canvas' as const })),
  ]
  const byTime = (w: Work) => new Date(w.createdAt).getTime()
  works.value = merged.sort((a, b) => (sort.value === 'new' ? byTime(b) - byTime(a) : b.hot - a.hot))
  loading.value = false
}

onMounted(load)

/** 管理员可删除任意作品；普通用户只能删除自己分享的 */
const canDelete = (work: Work) => authStore.isAdmin || work.createdBy === String(authStore.user?.id ?? '')

async function handlePreview(work: Work) {
  if (props.usingExampleId || deletingId.value || previewingId.value) return
  previewingId.value = work.id
  try {
    if (work.kind === 'canvas') {
      const detail = await getCanvasExample(work.id)
      if (await viewCanvasExample(work.id)) detail.viewCount += 1
      previewCanvas.value = detail
      previewDoc.value = detail.doc
      previewProject.value = undefined
    } else {
      const detail = await getExample(work.id)
      if (await viewExample(work.id)) detail.viewCount += 1
      previewExample.value = detail
      previewProject.value = exampleToPreviewProject(detail)
      previewDoc.value = undefined
    }
    previewKind.value = work.kind
    previewVisible.value = true
  } catch {
    // 错误已由 request 拦截器统一提示
  } finally {
    previewingId.value = undefined
  }
}

function handleCopy() {
  if (props.usingExampleId) return
  if (previewKind.value === 'canvas' && previewCanvas.value) emit('useCanvasExample', previewCanvas.value.id)
  else if (previewExample.value) emit('useExample', previewExample.value.id)
}

async function handleDelete(work: Work) {
  if (deletingId.value) return
  try {
    await ElMessageBox.confirm(`确定删除作品「${work.title}」吗？此操作不可恢复。`, '删除作品', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
    })
  } catch {
    return
  }
  deletingId.value = work.id
  try {
    await (work.kind === 'canvas' ? deleteCanvasExample(work.id) : deleteExample(work.id))
    works.value = works.value.filter((item) => item.id !== work.id)
    ElMessage.success('作品已删除')
  } catch {
    // 错误已由 request 拦截器统一提示
  } finally {
    deletingId.value = undefined
  }
}
</script>

<style scoped>
.gallery { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0 0 20px; }
.gallery-header { display: flex; align-items: baseline; flex-wrap: wrap; gap: 10px; margin: 0 auto 16px; width: min(1320px, calc(100% - clamp(32px, 5vw, 96px))); }
.gallery-title { font-size: 15px; font-weight: 700; color: var(--color-text-primary); }
.gallery-sub { flex: 1; min-width: 220px; font-size: 12.5px; line-height: 1.6; color: var(--color-text-tertiary); }
.kind-badge { position: absolute; left: 8px; top: 8px; padding: 2px 8px; border-radius: 10px; background: rgba(0, 0, 0, .55); color: #fff; font-size: 11px; font-weight: 600; z-index: 1; }
.gallery-card.skeleton { pointer-events: none; }
.gallery-card.skeleton .card-cover, .gallery-card.skeleton .card-name { background: linear-gradient(90deg, var(--color-bg-secondary), color-mix(in srgb, var(--color-bg-secondary) 55%, var(--color-card)), var(--color-bg-secondary)); background-size: 200% 100%; animation: shimmer 1.2s linear infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
.gallery-sort { margin-left: auto; flex-shrink: 0; }
.gallery-scroll { flex: 1; min-height: 0; overflow: hidden; }
.gallery-scroll :deep(.el-scrollbar__view) { width: min(1320px, calc(100% - clamp(32px, 5vw, 96px))); margin: 0 auto; }

/* 默认成片是 9:16。列宽随屏幕增减，封面保持竖屏，避免被拉成横图后裁掉上下 */
.gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 156px), 1fr)); gap: 16px; padding-bottom: 4px; }
.gallery-card {
  position: relative; display: flex; flex-direction: column; gap: 10px; padding: 0; border: 1px solid var(--color-border); border-radius: 16px;
  background: var(--color-card); cursor: pointer; transition: box-shadow .18s, border-color .18s, transform .15s; text-align: left; overflow: hidden;
}
.gallery-card:hover:not(.is-disabled) { box-shadow: 0 10px 24px rgba(31, 35, 60, .12); border-color: var(--color-border); transform: translateY(-2px); }
.gallery-card.is-disabled { cursor: not-allowed; opacity: .7; }
.card-name { display: block; padding: 0 36px 12px 12px; font-size: 13.5px; font-weight: 600; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.card-cover {
  position: relative; width: 100%; aspect-ratio: 9 / 16; overflow: hidden; background: #14151d;
  display: flex; align-items: center; justify-content: center; color: rgba(255, 255, 255, .4);
}
.card-cover img { width: 100%; height: 100%; object-fit: cover; object-position: center; }
.card-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, .35); color: #fff; }
.use-count-badge {
  position: absolute; left: 8px; bottom: 8px; display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 8px; border-radius: 10px; background: rgba(0, 0, 0, .5); color: #fff; font-size: 11.5px; font-weight: 600;
  backdrop-filter: blur(2px); z-index: 1;
}
.preview-hint {
  position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center;
  background: rgba(20, 21, 29, .42); color: #fff; font-size: 13px; font-weight: 700; letter-spacing: .04em;
  opacity: 0; transition: opacity .15s;
}
.gallery-card:hover:not(.is-disabled) .preview-hint { opacity: 1; }

/** 删除按钮：卡片右下角，仅悬停时出现，避免默认状态下界面显得操作繁杂 */
.card-delete {
  position: absolute; right: 8px; bottom: 8px; display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border: none; border-radius: 50%; background: rgba(0, 0, 0, .55); color: #fff;
  cursor: pointer; opacity: 0; transform: translateY(4px); transition: opacity .15s, transform .15s, background .15s;
}
.gallery-card:hover .card-delete { opacity: 1; transform: translateY(0); }
.card-delete:hover { background: var(--color-error); }
.card-delete:disabled { cursor: not-allowed; opacity: .6; }

.gallery-card--blank { border-style: solid; border-color: var(--color-border); }
.gallery-card--blank:hover:not(.is-disabled) { border-color: var(--color-primary); }
.card-cover--blank { background: linear-gradient(135deg, var(--color-primary-soft), var(--color-primary-soft)); }
.blank-icon {
  display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 50%;
  background: rgba(255, 255, 255, .7); color: var(--color-primary);
}
.gallery-card--blank .card-loading { background: transparent; color: var(--color-primary); }

.preview-header { display: flex; align-items: center; min-width: 0; padding-right: 36px; }
.preview-title-block { min-width: 0; }
.preview-title { margin: 0; font-size: 16px; font-weight: 800; color: var(--color-text-primary); }
.preview-meta { display: flex; gap: 12px; margin: 4px 0 0; font-size: 12.5px; color: var(--color-text-tertiary); }
.preview-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.preview-body :deep(.workbench) { flex: 1; min-height: 0; height: auto; }
.canvas-videos { display: none; }
@media (max-width: 1100px), (hover: none) and (pointer: coarse) {
  .canvas-videos { display: block; max-height: 35%; overflow-y: auto; list-style: none; padding: 6px 12px; }
  .canvas-videos li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0; }
  .canvas-videos li > span:first-child { overflow-wrap: anywhere; }
}
@media (max-width: 640px) {
  .gallery-header { gap: 6px 10px; margin-bottom: 10px; }
  .gallery-sub { order: 3; flex-basis: 100%; min-width: 0; }
  .gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .card-name { padding-left: 8px; }
  .card-delete { width: 32px; height: 32px; opacity: 1; transform: none; }
}
</style>

<style>
.el-overlay:has(.example-preview-dialog) { overflow: hidden; }
.el-overlay-dialog:has(.example-preview-dialog) {
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.example-preview-dialog {
  margin: auto !important;
  display: flex;
  flex-direction: column;
  height: 92vh;
  max-height: 92vh;
  border-radius: 16px;
  overflow: hidden;
}
.example-preview-dialog .el-dialog__header,
.example-preview-dialog .el-dialog__footer { flex-shrink: 0; }
.example-preview-dialog .el-dialog__header { padding: 14px 20px 10px; margin-right: 0; }
.example-preview-dialog .el-dialog__body {
  flex: 1;
  min-height: 0;
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-secondary);
}
.example-preview-dialog .el-dialog__footer {
  padding: 12px 20px 16px;
  border-top: 1px solid var(--color-border);
}
@media (max-width: 640px) {
  .example-preview-dialog { height: 94dvh; max-height: 94dvh; }
  .example-preview-dialog .el-dialog__header, .example-preview-dialog .el-dialog__footer { padding-inline: 12px; }
}
</style>
