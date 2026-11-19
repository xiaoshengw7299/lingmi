<template>
  <div class="canvas-page">
    <WorkspaceSidebar v-slot="{ close }" title="我的画布">
      <CanvasSidebar :items="items" :current-id="canvasId" :loading="loading" @create="close(); create()" @select="(id) => { close(); open(id) }" @remove="remove" />
    </WorkspaceSidebar>

    <div class="main">
      <CanvasEditor v-if="canvasId" :id="canvasId" :key="canvasId" />
      <!-- 没有选中画布 = 无限画布首页：展示大家分享的作品（工作台案例和画布作品混排），不会自动创建任何东西 -->
      <div v-else class="landing">
        <div class="landing-head">
          <h2>无限画布</h2>
          <p>把图片、视频、音频、文字摆在一张无限大的画布上，连线即参考，自由组合出片。</p>
        </div>
        <WorksGallery
          mode="canvas"
          :using-example-id="usingId"
          @create-blank="create"
          @use-canvas-example="copyCanvasExample"
          @use-example="copyStudioExample"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import WorksGallery from '@/components/WorksGallery.vue'
import { createCanvas, deleteCanvas, listCanvases, useCanvasExample, type CanvasSummary } from '@/api/canvas'
import { useExample } from '@/api/video'
import { useAuthStore } from '@/stores/auth'
import CanvasEditor from './CanvasEditor.vue'
import CanvasSidebar from './CanvasSidebar.vue'
import WorkspaceSidebar from '@/views/video-producer/WorkspaceSidebar.vue'
import { useCanvasStore } from './store'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const store = useCanvasStore()

/** 当前画布由 URL 决定：/canvas?id=<画布>，刷新、分享链接都能还原；没有 id 就是首页 */
const canvasId = computed(() => (typeof route.query.id === 'string' ? route.query.id : ''))
const items = ref<CanvasSummary[]>([])
const loading = ref(false)
const usingId = ref<string>()

async function refresh() {
  if (!auth.isLoggedIn) return
  loading.value = true
  try {
    items.value = await listCanvases()
  } finally {
    loading.value = false
  }
}

const open = (id: string) => router.push({ query: { id } })

async function create() {
  if (!auth.ensureLoggedIn()) return
  const canvas = await createCanvas()
  await refresh()
  open(canvas.id)
}

async function remove(id: string) {
  await deleteCanvas(id)
  items.value = items.value.filter((c) => c.id !== id)
  if (id === canvasId.value) await router.push({ query: {} })
}

/** 复制别人分享的画布作品：媒体复制到自己名下，成为新画布，直接打开 */
async function copyCanvasExample(id: string) {
  if (!auth.ensureLoggedIn() || usingId.value) return
  usingId.value = id
  try {
    const canvas = await useCanvasExample(id)
    await refresh()
    open(canvas.id)
  } finally {
    usingId.value = undefined
  }
}

/** 首页的分享作品里混着工作台案例：复制成自己的工作台，然后跳到通用创作打开 */
async function copyStudioExample(id: string) {
  if (!auth.ensureLoggedIn() || usingId.value) return
  usingId.value = id
  try {
    const sessionId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const project = await useExample(id, { sessionId })
    await router.push({ path: '/video-producer/studio', query: { session: sessionId, project: project.id } })
  } finally {
    usingId.value = undefined
  }
}

// 编辑器里改了画布名，侧栏列表同步显示
watch(
  () => store.title,
  (title) => {
    const item = items.value.find((c) => c.id === store.projectId)
    if (item && title) item.title = title
  },
)

onMounted(refresh)
</script>

<style scoped>
.canvas-page { flex: 1; min-height: 0; display: flex; overflow: hidden; background: var(--color-card); }
.main { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; }
.landing { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--color-background); }
.landing-head { width: min(1320px, calc(100% - clamp(32px, 5vw, 96px))); margin: 0 auto; padding: 28px 0 16px; }
.landing-head h2 { font-size: 26px; font-weight: 800; }
.landing-head p { margin-top: 6px; font-size: 14px; color: var(--color-text-secondary); }
@media (max-width: 960px) {
  .canvas-page { flex-direction: column; }
  .main { min-height: 0; }
  .landing-head { padding: 16px 0 12px; }
  .landing-head h2 { font-size: 20px; }
}
</style>
