<template>
  <div class="lm-page">
    <div class="lm-container page">
      <header class="head">
        <div>
          <h1>提示词库</h1>
          <p>{{ PROMPTS_LEAD }}</p>
        </div>
        <el-button type="primary" :icon="Plus" @click="openPublish">发布提示词</el-button>
      </header>

      <div class="bar">
        <el-radio-group v-model="query.type" @change="reload">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="image">图片</el-radio-button>
          <el-radio-button value="video">视频</el-radio-button>
        </el-radio-group>
        <el-radio-group v-model="query.sort" @change="reload">
          <el-radio-button value="hot">综合</el-radio-button>
          <el-radio-button value="new">最新</el-radio-button>
        </el-radio-group>
        <el-input v-model="query.keyword" clearable placeholder="搜索标题或内容" :prefix-icon="Search" class="search" @input="debouncedReload" />
      </div>

      <div v-loading="loading" class="grid">
        <article v-for="item in items" :key="item.id" class="card" @click="open(item)">
          <div class="cover">
            <video v-if="item.type === 'video'" :src="item.mediaUrl" muted playsinline preload="metadata" />
            <el-image v-else :src="item.mediaUrl" fit="cover" loading="lazy" />
            <span class="badge">{{ item.type === 'video' ? '视频' : '图片' }}</span>
          </div>
          <div class="body">
            <h3 :title="item.title">{{ item.title }}</h3>
            <p class="text">{{ item.content }}</p>
            <div class="meta">
              <span>{{ item.createdByName || '匿名' }}</span>
              <span class="stat"><el-icon><View /></el-icon>{{ item.viewCount }}</span>
              <span class="stat"><el-icon><CopyDocument /></el-icon>{{ item.copyCount }}</span>
            </div>
          </div>
        </article>
      </div>
      <el-empty v-if="!loading && !items.length" description="还没有提示词，来发布第一条吧" />
      <el-pagination v-if="total > PAGE_SIZE" v-model:current-page="page" class="pager" layout="prev, pager, next" :page-size="PAGE_SIZE" :total="total" @current-change="load" />
    </div>

    <PublishDialog v-model="publishVisible" @published="reload" />

    <el-dialog v-model="detailVisible" :title="detail?.title" width="min(920px, 94vw)" align-center append-to-body destroy-on-close>
      <div v-if="detail" class="detail">
        <div class="stage">
          <video v-if="detail.type === 'video'" :src="detail.mediaUrl" controls playsinline />
          <el-image v-else :src="detail.mediaUrl" fit="contain" :preview-src-list="[detail.mediaUrl]" preview-teleported />
        </div>
        <div class="info">
          <p class="tags">
            <el-tag size="small">{{ detail.type === 'video' ? '视频' : '图片' }}</el-tag>
            <el-tag v-if="detail.modelName" size="small" type="info">{{ detail.modelName }}</el-tag>
            <el-tag v-if="detail.params?.ratio" size="small" type="info">{{ detail.params.ratio }}</el-tag>
            <el-tag v-if="detail.params?.durationSec" size="small" type="info">{{ detail.params.durationSec }}s</el-tag>
          </p>
          <p class="full">
            <template v-for="(seg, i) in segments(detail)" :key="i">
              <mark v-if="seg.mention" class="mention">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template>
            </template>
          </p>
          <div v-if="detail.references.length" class="refs">
            <span class="refs-title">参考素材（提示词里用 @ 引用）</span>
            <div class="ref-list">
              <figure v-for="ref in detail.references" :key="ref.name" class="ref">
                <el-image v-if="ref.kind === 'image'" :src="ref.url" fit="cover" :preview-src-list="[ref.url]" preview-teleported />
                <video v-else-if="ref.kind === 'video'" :src="ref.url" controls playsinline preload="metadata" />
                <audio v-else :src="ref.url" controls preload="none" />
                <figcaption>@{{ ref.name }}</figcaption>
                <VideoShareButton v-if="ref.kind === 'video'" source="prompt" :id="detail.id" :video="ref.url" :title="ref.name" compact />
              </figure>
            </div>
          </div>
          <p class="author">由 {{ detail.createdByName || '匿名' }} 发布 · {{ detail.viewCount }} 次查看 · {{ detail.copyCount }} 次复制</p>
          <div class="ops">
            <VideoShareButton v-if="detail.type === 'video'" source="prompt" :id="detail.id" :video="detail.mediaUrl" :title="detail.title" />
            <el-dropdown trigger="click" @command="(t: 'canvas' | 'studio') => useIn(detail!, t)">
              <el-button type="primary" :icon="MagicStick" :loading="using">使用此提示词</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="canvas">在无限画布中使用</el-dropdown-item>
                  <el-dropdown-item command="studio">在通用创作中使用</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button :icon="CopyDocument" @click="copy(detail)">复制提示词</el-button>
            <el-button :icon="FolderAdd" @click="saveAsset(detail)">加入我的资产</el-button>
            <el-button v-if="canDelete(detail)" type="danger" text :icon="Delete" @click="remove(detail)">删除</el-button>
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import VideoShareButton from '@/components/VideoShareButton.vue'
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import { PROMPTS_LEAD } from '@/seo/site'
import { CopyDocument, Delete, FolderAdd, MagicStick, Plus, Search, View } from '@element-plus/icons-vue'
import PublishDialog from './PublishDialog.vue'
import { addAsset } from '@/api/asset'
import { createCanvas } from '@/api/canvas'
import { deletePrompt, listPrompts, trackPrompt, usePrompt, type PromptItem, type PromptType, type RankSort } from '@/api/prompt'
import { promptToDoc } from '@/views/canvas/prompt-doc'
import { scanMentions } from '@/utils/mentions'
import { createStudioFromPrompt } from './studio-from-prompt'
import { useAuthStore } from '@/stores/auth'
import { copyText } from '@/utils/clipboard'

const PAGE_SIZE = 24

const auth = useAuthStore()
const query = reactive({ type: '' as PromptType | '', sort: 'hot' as RankSort, keyword: '' })
const page = ref(1)
const total = ref(0)
const items = ref<PromptItem[]>([])
const loading = ref(false)
const publishVisible = ref(false)
const router = useRouter()
const using = ref(false)
const detail = ref<PromptItem>()

/** 把提示词里的 @名称 标出来（只标确实存在的参考，名称后面没有空格也认） */
function segments(item: PromptItem) {
  const names = item.references.map((r) => r.name)
  const known = new Set(names)
  const text = item.content
  const hits = scanMentions(text, names).filter((hit) => hit.known && known.has(hit.name))
  if (!hits.length) return [{ text, mention: false }]
  const parts: { text: string; mention: boolean }[] = []
  let last = 0
  for (const hit of hits) {
    if (hit.start > last) parts.push({ text: text.slice(last, hit.start), mention: false })
    parts.push({ text: text.slice(hit.start, hit.end), mention: true })
    last = hit.end
  }
  if (last < text.length) parts.push({ text: text.slice(last), mention: false })
  return parts
}

/**
 * 使用提示词：参考素材复制到自己名下。无限画布里搭成"参考 → 生成"；
 * 通用创作里变成素材和「新建图片素材 / 新建分镜」。创建完成后跳到对应的页面。
 */
async function useIn(item: PromptItem, target: 'canvas' | 'studio') {
  if (using.value || !auth.ensureLoggedIn()) return
  using.value = true
  try {
    const data = await usePrompt(item.id)
    item.copyCount += 1
    if (target === 'canvas') {
      const canvas = await createCanvas({ title: data.title.slice(0, 60), doc: promptToDoc(data) })
      await router.push({ path: '/video-producer/canvas', query: { id: canvas.id } })
    } else {
      const session = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const project = await createStudioFromPrompt(data, session)
      await router.push({ path: '/video-producer/studio', query: { session, project: project.id } })
    }
  } finally {
    using.value = false
  }
}
const detailVisible = computed({ get: () => !!detail.value, set: (v) => !v && (detail.value = undefined) })

async function load() {
  loading.value = true
  try {
    const res = await listPrompts({ ...query, type: query.type || undefined, page: page.value, pageSize: PAGE_SIZE })
    items.value = res.items
    total.value = res.total
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  return load()
}

let timer: number | undefined
function debouncedReload() {
  window.clearTimeout(timer)
  timer = window.setTimeout(reload, 300)
}

function openPublish() {
  if (auth.ensureLoggedIn()) publishVisible.value = true
}

async function open(item: PromptItem) {
  detail.value = item
  // 游客也计入：后端按访客 + 天去重，只有真正计数了才更新界面上的数字
  if (await trackPrompt(item.id, 'view')) item.viewCount += 1
}

async function copy(item: PromptItem) {
  await copyText(item.content, '已复制提示词')
  if (await trackPrompt(item.id, 'copy')) item.copyCount += 1
}

async function saveAsset(item: PromptItem) {
  if (!auth.ensureLoggedIn()) return
  await addAsset({ kind: 'prompt', name: item.title, content: item.content, meta: { modelName: item.modelName ?? undefined, from: 'library' } })
  ElMessage.success('已加入我的资产')
  if (await trackPrompt(item.id, 'copy')) item.copyCount += 1
}

const canDelete = (item: PromptItem) => auth.isAdmin || item.createdBy === String(auth.user?.id ?? '')

async function remove(item: PromptItem) {
  await ElMessageBox.confirm(`确定删除「${item.title}」吗？`, '删除提示词', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  await deletePrompt(item.id)
  detail.value = undefined
  await load()
}

onMounted(load)
</script>

<style scoped>
.page { max-width: 1400px; padding: 24px clamp(28px, 4vw, 48px) 32px; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.head h1 { font-size: 22px; font-weight: 800; }
.head p { margin-top: 4px; font-size: 13px; color: var(--color-text-secondary); }
.bar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.search { width: 260px; margin-left: auto; }
/* 默认示例是 9:16。窄列多排，封面按竖屏铺满，宽屏自动多加几列 */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 168px), 1fr)); gap: 14px; min-height: 200px; }
.card { border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-card); overflow: hidden; cursor: pointer; transition: var(--transition); }
.card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); border-color: var(--color-primary-line); }
.cover { position: relative; aspect-ratio: 9 / 16; background: #14151d; }
.cover :deep(.el-image), .cover video { width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; }
.cover :deep(.el-image__inner) { width: 100%; height: 100%; object-fit: cover; object-position: center; }
.badge { position: absolute; left: 8px; top: 8px; padding: 1px 9px; border-radius: 999px; background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 11px; }
.body { padding: 10px 12px 12px; }
.body h3 { font-size: 14px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.text { margin: 6px 0 10px; height: 40px; font-size: 12.5px; line-height: 1.6; color: var(--color-text-secondary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--color-text-tertiary); }
.meta > span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stat { display: inline-flex; align-items: center; gap: 3px; }
.pager { justify-content: center; margin-top: 20px; }
.detail { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 20px; align-items: start; }
.stage {
  width: min(300px, 70vw, calc(64vh * 9 / 16));
  aspect-ratio: 9 / 16;
  margin: 0 auto;
  border-radius: var(--radius-md);
  background: #14151d;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.stage video, .stage :deep(.el-image) { width: 100%; height: 100%; display: block; }
.stage video { object-fit: contain; }
.tags { display: flex; gap: 6px; flex-wrap: wrap; }
.full { margin: 12px 0; white-space: pre-wrap; line-height: 1.8; font-size: 14px; max-height: 260px; overflow-y: auto; }
.mention { padding: 0 3px; border-radius: 4px; background: var(--color-primary-soft); color: var(--color-primary-dark); }
.refs { margin: 4px 0 12px; }
.refs-title { font-size: 12px; font-weight: 700; color: var(--color-text-tertiary); }
.ref-list { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
.ref { margin: 0; width: max-content; max-width: 160px; }
.ref :deep(.el-image), .ref video { width: 72px; aspect-ratio: 9 / 16; height: auto; border-radius: var(--radius-sm); object-fit: cover; object-position: center; display: block; }
.ref audio { width: 160px; height: 32px; }
.ref figcaption { margin-top: 4px; font-size: 12px; color: var(--color-primary-dark); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.author { font-size: 12.5px; color: var(--color-text-tertiary); }
.ops { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
@media (max-width: 760px) {
  .detail { grid-template-columns: 1fr; }
  .stage { width: min(220px, 64vw); }
}
@media (max-width: 720px) {
  .page { padding: 16px; }
  .search { width: 100%; margin-left: 0; }
}
</style>
