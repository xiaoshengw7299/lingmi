<template>
  <div class="tool-page">
    <div v-if="narrow" class="mobile-actions">
      <el-button :icon="Files" @click="recordsOpen = true">生成记录{{ total ? `（${total}）` : '' }}</el-button>
      <el-button v-if="selectedId" type="primary" :icon="Plus" @click="selectRecord(null)">新建</el-button>
    </div>
    <component
      :is="narrow ? ElDrawer : 'aside'"
      :class="{ 'desktop-records': !narrow }"
      v-bind="narrow ? { modelValue: recordsOpen, title: '生成记录', size: 'min(380px, 100%)', appendToBody: true } : {}"
      @update:model-value="recordsOpen = $event"
    >
      <div class="records" :class="{ 'in-drawer': narrow }">
        <div class="records-head">
          <div>
            <h2 v-if="!narrow">生成记录</h2>
            <p>{{ total ? `共 ${total} 条` : '只保留记录和结果，删除时文件一起删除' }}</p>
          </div>
          <el-button type="primary" :icon="Plus" round size="small" :disabled="!selectedId" @click="selectRecord(null)">新建</el-button>
        </div>

        <div v-loading="loading && !tasks.length" class="records-list">
          <button
            v-for="task in tasks"
            :key="task.id"
            type="button"
            class="record"
            :class="{ 'is-active': task.id === selectedId }"
            @click="selectRecord(task.id)"
          >
            <div class="record-thumb">
              <img v-if="task.thumbUrl" :src="task.thumbUrl" alt="" loading="lazy" />
              <el-icon v-else :size="18"><component :is="outputIcon(task)" /></el-icon>
              <span v-if="task.status !== 'succeeded'" class="record-badge" :class="`is-${task.status}`">
                <el-icon v-if="task.status === 'running'" class="is-loading"><Loading /></el-icon>
                <template v-else>失败</template>
              </span>
            </div>
            <div class="record-body">
              <b>{{ recordTitle(task) }}</b>
              <span>{{ recordMeta(task) }}</span>
            </div>
          </button>

          <div v-if="!loading && !tasks.length" class="records-empty">
            <el-icon :size="30"><Files /></el-icon>
            <p>还没有记录<br />上传文件即可开始处理</p>
          </div>
          <el-button v-if="tasks.length < total" text :loading="loading" class="more" @click="loadMore">加载更多</el-button>
        </div>
      </div>
    </component>

    <main ref="stage" class="stage">
      <ToolResult v-if="selectedId && tool" :key="selectedId" :task-id="selectedId" :tool="tool" @changed="onChanged" @deleted="onDeleted" @new="selectRecord(null)" />
      <ToolForm v-else-if="tool" :key="tool.id" :tool="tool" @created="onCreated" />
      <el-skeleton v-else :rows="8" animated class="panel" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElDrawer } from 'element-plus'
import { Files, Loading, Plus } from '@element-plus/icons-vue'
import { getToolCatalog, listToolTasks, type ToolDef, type ToolTask } from '@/api/media-tools'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import { dateTime } from '@/utils/format'
import ToolForm from './ToolForm.vue'
import ToolResult from './ToolResult.vue'

const props = defineProps<{ toolId: string }>()

const LIST_REFRESH_MS = 8000
const auth = useAuthStore()
const wallet = useWalletStore()
const tool = ref<ToolDef>()
const tasks = ref<ToolTask[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const selectedId = ref<string | null>(null)
const stage = ref<HTMLElement>()
const media = window.matchMedia('(max-width: 960px)')
const narrow = ref(media.matches)
const recordsOpen = ref(false)
let refreshTimer: number | undefined
let listRequest = 0
let toolRequest = 0

function updateLayout(event: MediaQueryListEvent) {
  narrow.value = event.matches
  recordsOpen.value = false
}
media.addEventListener('change', updateLayout)

function selectRecord(id: string | null) {
  selectedId.value = id
  recordsOpen.value = false
  stage.value?.scrollTo(0, 0)
}

const KIND_ICON: Record<string, string> = { video: 'VideoCamera', image: 'Picture', audio: 'Headset', file: 'Document' }
const outputIcon = (task: ToolTask) => KIND_ICON[task.outputs[0]?.kind ?? task.inputs[0]?.kind ?? 'file'] ?? 'Document'

function recordTitle(task: ToolTask) {
  const [first] = task.inputs
  if (!first) return tool.value?.name ?? '记录'
  return task.inputs.length > 1 ? `${first.name} 等 ${task.inputs.length} 个` : first.name
}

function recordMeta(task: ToolTask) {
  const mode = tool.value && tool.value.modes.length > 1 ? tool.value.modes.find((item) => item.id === task.mode)?.label : ''
  return [mode, dateTime(task.createdAt).slice(5)].filter(Boolean).join(' · ')
}

async function load(reset = true) {
  if (!auth.isLoggedIn) return
  const request = ++listRequest
  const toolId = props.toolId
  const requestedPage = reset ? 1 : page.value + 1
  loading.value = true
  try {
    const data = await listToolTasks(toolId, requestedPage)
    if (request !== listRequest || toolId !== props.toolId) return
    page.value = requestedPage
    tasks.value = reset ? data.items : [...tasks.value, ...data.items]
    total.value = data.total
  } finally {
    if (request === listRequest) {
      loading.value = false
      scheduleRefresh()
    }
  }
}

function loadMore() {
  if (loading.value) return
  void load(false).catch(() => undefined)
}

/** 有任务在处理时定期刷新列表，用户不点开也能看到完成状态 */
function scheduleRefresh() {
  window.clearTimeout(refreshTimer)
  if (!tasks.value.some((task) => task.status === 'running')) return
  const toolId = props.toolId
  const request = listRequest
  refreshTimer = window.setTimeout(async () => {
    const data = await listToolTasks(toolId, 1).catch(() => null)
    if (request !== listRequest || toolId !== props.toolId) return
    if (data) data.items.forEach(onChanged)
    scheduleRefresh()
  }, LIST_REFRESH_MS)
}

function onCreated(task: ToolTask) {
  tasks.value = [task, ...tasks.value]
  total.value += 1
  selectRecord(task.id)
  void wallet.refresh()
  scheduleRefresh()
}

function onChanged(task: ToolTask) {
  const index = tasks.value.findIndex((item) => item.id === task.id)
  if (index < 0) return
  const before = tasks.value[index]
  tasks.value.splice(index, 1, task)
  if (before.status === 'running' && task.status !== 'running') void wallet.refresh()
}

function onDeleted(id: string) {
  tasks.value = tasks.value.filter((item) => item.id !== id)
  total.value = Math.max(0, total.value - 1)
  selectRecord(null)
}

watch(
  () => props.toolId,
  async (id) => {
    const request = ++toolRequest
    selectRecord(null)
    tool.value = undefined
    ++listRequest
    window.clearTimeout(refreshTimer)
    tasks.value = []
    total.value = 0
    void load().catch(() => undefined)
    const catalog = await getToolCatalog().catch(() => [])
    if (request === toolRequest) tool.value = catalog.find((item) => item.id === id)
  },
  { immediate: true },
)
watch(() => auth.isLoggedIn, (loggedIn) => {
  if (loggedIn) return void load().catch(() => undefined)
  ++listRequest
  window.clearTimeout(refreshTimer)
  tasks.value = []
  total.value = 0
  loading.value = false
  selectRecord(null)
})
onBeforeUnmount(() => {
  ++listRequest
  ++toolRequest
  window.clearTimeout(refreshTimer)
  media.removeEventListener('change', updateLayout)
})
</script>

<style scoped>
.tool-page { flex: 1; min-height: 0; display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 16px; padding: 16px; overflow: hidden; }
.desktop-records { min-height: 0; }

.records {
  height: 100%; min-height: 0; display: flex; flex-direction: column; border-radius: 20px; overflow: hidden;
  background: var(--color-card); border: 1px solid color-mix(in srgb, var(--color-text-tertiary) 16%, transparent);
}
.records-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 16px 12px; border-bottom: 1px solid var(--color-divider); }
.records-head h2 { font-size: 15px; font-weight: 750; }
.records-head p { margin-top: 2px; font-size: 11.5px; color: var(--color-text-tertiary); }
.records-list { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 4px; }

.record {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px; border: 0; border-radius: 12px;
  background: transparent; text-align: left; cursor: pointer; transition: background 0.15s ease;
}
.record:hover { background: var(--color-bg-secondary); }
.record.is-active { background: var(--color-primary-soft); }
.record-thumb {
  position: relative; width: 56px; height: 42px; flex-shrink: 0; display: grid; place-items: center; overflow: hidden;
  border-radius: 9px; background: var(--color-bg-secondary); color: var(--color-text-tertiary);
}
.record-thumb img { width: 100%; height: 100%; object-fit: cover; }
.record-badge {
  position: absolute; inset: 0; display: grid; place-items: center; font-size: 11px; font-weight: 700; color: #fff;
  background: color-mix(in srgb, var(--color-primary) 72%, transparent);
}
.record-badge.is-failed { background: color-mix(in srgb, var(--color-error) 78%, transparent); }
.record-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.record-body b { font-size: 13px; font-weight: 600; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.record.is-active .record-body b { color: var(--color-primary-dark); }
.record-body span { font-size: 11.5px; color: var(--color-text-tertiary); }
.records-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 16px; text-align: center; color: var(--color-text-tertiary); font-size: 12.5px; line-height: 1.7; }
.more { margin: 4px auto; }

.stage { min-width: 0; min-height: 0; overflow-y: auto; padding-right: 2px; }

@media (max-width: 960px) {
  .tool-page { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); gap: 8px; padding: 10px 10px 0; }
  .mobile-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .mobile-actions .el-button { min-height: 40px; margin: 0; }
  .records.in-drawer { border: 0; border-radius: 0; }
  .records.in-drawer .records-head { padding: 0 0 10px; }
  .records.in-drawer .records-list { padding-inline: 0; }
  .stage { padding: 0 0 max(12px, env(safe-area-inset-bottom)); }
}
</style>
