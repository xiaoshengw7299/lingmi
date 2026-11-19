<template>
  <div class="lm-page forum" :class="{ 'is-reading': !!detail && !wide }">
    <header class="head">
      <div>
        <h1>论坛&反馈</h1>
        <p>{{ FORUM_LEAD }}</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openPublish">发帖</el-button>
    </header>

    <div class="split">
      <aside class="pane list-pane">
        <div class="bar">
          <el-input v-model="keyword" clearable placeholder="搜索标题或内容" :prefix-icon="Search" @input="debouncedReload" />
          <span class="sort">按点赞排序</span>
        </div>
        <div v-loading="loading" class="list">
          <article
            v-for="item in items"
            :key="item.id"
            class="row"
            :class="{ 'is-active': item.id === detail?.id }"
            tabindex="0"
            @click="open(item)"
            @keydown.enter="onRowKey($event, item)"
          >
            <button type="button" class="like" :class="{ 'is-on': item.liked }" :aria-pressed="item.liked" :disabled="liking === item.id" @click.stop="toggleLike(item)">
              <el-icon><component :is="item.liked ? StarFilled : Star" /></el-icon>
              <span>{{ item.likeCount }}</span>
            </button>
            <div class="main">
              <div class="title-line">
                <h3>{{ item.title }}</h3>
                <el-tag v-if="isMine(item)" size="small" type="info">我的</el-tag>
                <el-tag v-if="item.visibility === 'admin'" size="small" type="warning">仅管理员</el-tag>
                <el-tag v-if="item.visibility === 'admin' && item.status === 'resolved'" size="small" type="success">已处理</el-tag>
                <el-tag v-else-if="item.visibility === 'admin'" size="small">待处理</el-tag>
              </div>
              <p class="excerpt">{{ excerpt(item.content) }}</p>
              <p class="meta">
                <span>{{ item.authorName }}</span>
                <span>{{ ago(item.createdAt) }}</span>
                <span class="stat"><el-icon><ChatDotRound /></el-icon>{{ item.commentCount }}</span>
                <span v-if="item.attachments.length" class="stat"><el-icon><Paperclip /></el-icon>{{ item.attachments.length }}</span>
              </p>
            </div>
          </article>
          <el-empty v-if="!loading && !items.length" :description="keyword.trim() ? '没有找到相关帖子' : '还没有帖子，来发第一条吧'" />
        </div>
        <el-pagination v-if="total > PAGE_SIZE" v-model:current-page="page" class="pager" layout="prev, pager, next" :page-size="PAGE_SIZE" :total="total" size="small" @current-change="load" />
      </aside>

      <section class="pane detail-pane">
        <div v-if="detail" v-loading="detailLoading" class="detail">
          <header class="detail-head">
            <button type="button" class="back" @click="closeDetail">
              <el-icon><ArrowLeft /></el-icon>返回列表
            </button>
            <div class="title-line">
              <h3 class="detail-title">{{ detail.title }}</h3>
              <el-tag v-if="detail.visibility === 'admin'" size="small" type="warning">仅管理员</el-tag>
              <el-tag v-if="detail.visibility === 'admin' && detail.status === 'resolved'" size="small" type="success">已处理</el-tag>
              <el-tag v-else-if="detail.visibility === 'admin'" size="small">待处理</el-tag>
            </div>
            <div class="detail-ops">
              <el-button v-if="canEdit(detail)" link type="primary" @click="openEdit(detail)">编辑</el-button>
              <el-button v-if="canDelete(detail)" link type="danger" @click="remove(detail)">删除</el-button>
            </div>
          </header>

          <div class="detail-body">
            <p class="meta">
              <span>{{ detail.authorName }}</span>
              <span>发布于 {{ dateTime(detail.createdAt) }}</span>
              <span v-if="edited(detail)">更新于 {{ dateTime(detail.updatedAt) }}</span>
            </p>
            <p class="content">{{ detail.content }}</p>

            <div v-if="images.length" class="gallery">
              <el-image v-for="file in images" :key="file.key" :src="file.url" fit="cover" :preview-src-list="images.map((item) => item.url)" preview-teleported />
            </div>
            <div v-for="file in videos" :key="file.key" class="player">
              <video :src="file.url" controls playsinline preload="metadata" />
              <span>{{ file.name }}</span>
              <VideoShareButton v-if="detail.visibility === 'public' || isMine(detail)" source="forum" :id="detail.id" :video="file.url" :title="detail.title" />
            </div>
            <div v-for="file in audios" :key="file.key" class="player">
              <audio :src="file.url" controls preload="none" />
              <span>{{ file.name }}</span>
            </div>
            <div v-if="docs.length" class="docs">
              <a v-for="file in docs" :key="file.key" :href="file.url" target="_blank" rel="noopener">
                <el-icon><Document /></el-icon>{{ file.name }}
              </a>
            </div>

            <div class="action-row">
              <button type="button" class="like like-inline" :class="{ 'is-on': detail.liked }" :aria-pressed="detail.liked" :disabled="liking === detail.id" @click="toggleLike(detail)">
                <el-icon><component :is="detail.liked ? StarFilled : Star" /></el-icon>
                <span>{{ detail.liked ? '已赞' : '点赞' }} {{ detail.likeCount }}</span>
              </button>
              <el-button v-if="auth.isAdmin && detail.visibility === 'admin' && detail.status === 'open'" @click="mark('resolved')">标为已处理</el-button>
              <el-button v-else-if="auth.isAdmin && detail.visibility === 'admin'" @click="mark('open')">重新打开</el-button>
            </div>

            <h4 class="comments-title">评论 {{ detail.commentCount }}</h4>
            <p v-if="!detail.comments.length" class="no-comment">还没有评论</p>
            <ul v-else class="comments">
              <li v-for="item in detail.comments" :key="item.id">
                <span class="ava">{{ item.authorName.slice(0, 1) }}</span>
                <div>
                  <p class="comment-meta">
                    <b>{{ item.authorName }}</b>
                    <span>{{ ago(item.createdAt) }}</span>
                    <el-button v-if="canDeleteComment(item)" link type="danger" @click="removeComment(item)">删除</el-button>
                  </p>
                  <p class="comment-text">{{ item.content }}</p>
                </div>
              </li>
            </ul>
          </div>

          <div class="composer">
            <el-input v-model="comment" type="textarea" :rows="2" maxlength="2000" show-word-limit placeholder="说说你的看法" />
            <el-button type="primary" :loading="sending" :disabled="!comment.trim()" @click="sendComment">发表</el-button>
          </div>
        </div>
        <el-empty v-else-if="!loading" class="placeholder" :description="items.length ? '从左侧选择一篇帖子' : '发一条帖子，内容会显示在这里'" />
      </section>
    </div>

    <PostDialog v-model="dialogOpen" :post="editing" @saved="onSaved" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { FORUM_LEAD } from '@/seo/site'
import { ArrowLeft, ChatDotRound, Document, Paperclip, Plus, Search, Star, StarFilled } from '@element-plus/icons-vue'
import PostDialog from './PostDialog.vue'
import VideoShareButton from '@/components/VideoShareButton.vue'
import {
  commentForumPost,
  deleteForumComment,
  deleteForumPost,
  getForumPost,
  likeForumPost,
  listForumPosts,
  setForumStatus,
  type ForumAttachment,
  type ForumComment,
  type ForumDetail,
  type ForumPost,
  type ForumStatus,
} from '@/api/forum'
import { useAuthStore } from '@/stores/auth'
import { dateTime } from '@/utils/format'

const PAGE_SIZE = 20
const WIDE_QUERY = '(min-width: 860px)'

const auth = useAuthStore()
const keyword = ref('')
const page = ref(1)
const total = ref(0)
const items = ref<ForumPost[]>([])
const loading = ref(false)
const liking = ref('')
const detail = ref<ForumDetail>()
const detailLoading = ref(false)
const dialogOpen = ref(false)
const editing = ref<ForumPost | null>(null)
const comment = ref('')
const sending = ref(false)
const wide = ref(typeof window !== 'undefined' && window.matchMedia(WIDE_QUERY).matches)

let openSeq = 0
const images = computed(() => ofKind(detail.value?.attachments, 'image'))
const videos = computed(() => ofKind(detail.value?.attachments, 'video'))
const audios = computed(() => ofKind(detail.value?.attachments, 'audio'))
const docs = computed(() => ofKind(detail.value?.attachments, 'file'))

function ofKind(files: ForumAttachment[] | undefined, kind: 'image' | 'video' | 'audio' | 'file') {
  return (files ?? []).filter((file) => {
    if (kind === 'file') return !file.mime.startsWith('image/') && !file.mime.startsWith('video/') && !file.mime.startsWith('audio/')
    return file.mime.startsWith(`${kind}/`)
  })
}

const isMine = (item: ForumPost) => item.authorId === auth.user?.id
const canEdit = (item: ForumPost) => isMine(item)
const canDelete = (item: ForumPost) => auth.isAdmin || isMine(item)
const canDeleteComment = (item: ForumComment) => auth.isAdmin || item.authorId === auth.user?.id || detail.value?.authorId === auth.user?.id
const edited = (item: ForumPost) => new Date(item.updatedAt).getTime() - new Date(item.createdAt).getTime() > 2000
const excerpt = (text: string) => text.replace(/\s+/g, ' ').trim()

function ago(value: string) {
  const min = Math.floor((Date.now() - new Date(value).getTime()) / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return dateTime(value)
}

function closeDetail() {
  openSeq += 1
  detail.value = undefined
}

async function load() {
  loading.value = true
  const keepId = detail.value?.id
  try {
    const res = await listForumPosts({ keyword: keyword.value.trim() || undefined, page: page.value, pageSize: PAGE_SIZE })
    items.value = res.items
    total.value = res.total
  } finally {
    loading.value = false
  }
  if (items.value.some((item) => item.id === keepId)) return
  if (wide.value && items.value[0]) await open(items.value[0])
  else detail.value = undefined
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
  if (!auth.ensureLoggedIn()) return
  editing.value = null
  dialogOpen.value = true
}

function openEdit(post: ForumPost) {
  editing.value = post
  dialogOpen.value = true
}

async function open(item: ForumPost) {
  const seq = ++openSeq
  if (detail.value?.id !== item.id) comment.value = ''
  detail.value = { ...item, comments: detail.value?.id === item.id ? detail.value.comments : [] }
  detailLoading.value = true
  try {
    const fresh = await getForumPost(item.id)
    if (seq === openSeq) detail.value = fresh
  } catch {
    if (seq === openSeq) detail.value = undefined
  } finally {
    if (seq === openSeq) detailLoading.value = false
  }
}

function onRowKey(event: KeyboardEvent, item: ForumPost) {
  if ((event.target as HTMLElement).closest('.like')) return
  open(item)
}

async function onSaved(post: ForumPost) {
  ElMessage.success(editing.value ? '已保存' : '已发布')
  await load()
  await open(post)
}

function sync(post: ForumPost) {
  const row = items.value.find((item) => item.id === post.id)
  if (row) Object.assign(row, post)
  if (detail.value?.id === post.id) detail.value = { ...detail.value, ...post }
}

async function toggleLike(item: ForumPost) {
  if (liking.value) return
  if (!auth.ensureLoggedIn()) return
  liking.value = item.id
  try {
    const res = await likeForumPost(item.id)
    const row = items.value.find((one) => one.id === item.id)
    if (row) {
      row.liked = res.liked
      row.likeCount = res.likeCount
    }
    if (detail.value?.id === item.id) {
      detail.value.liked = res.liked
      detail.value.likeCount = res.likeCount
    }
    items.value.sort((a, b) => b.likeCount - a.likeCount || +new Date(b.createdAt) - +new Date(a.createdAt))
  } catch {
    // 拦截器已提示
  } finally {
    liking.value = ''
  }
}

async function sendComment() {
  if (!detail.value || !comment.value.trim()) return
  if (!auth.ensureLoggedIn()) return
  const post = detail.value
  sending.value = true
  try {
    const created = await commentForumPost(post.id, comment.value.trim())
    if (detail.value?.id !== post.id) return
    detail.value.comments.push(created)
    detail.value.commentCount += 1
    const row = items.value.find((item) => item.id === post.id)
    if (row) row.commentCount += 1
    comment.value = ''
  } finally {
    sending.value = false
  }
}

async function remove(item: ForumPost) {
  try {
    await ElMessageBox.confirm(`确定删除「${item.title}」吗？评论和附件会一起删除。`, '删除帖子', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch {
    return
  }
  await deleteForumPost(item.id)
  if (detail.value?.id === item.id) detail.value = undefined
  ElMessage.success('已删除')
  await load()
}

async function removeComment(item: ForumComment) {
  if (!detail.value) return
  try {
    await ElMessageBox.confirm('确定删除这条评论吗？', '删除评论', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch {
    return
  }
  const post = detail.value
  await deleteForumComment(post.id, item.id)
  if (detail.value?.id !== post.id) return
  post.comments = post.comments.filter((one) => one.id !== item.id)
  post.commentCount = Math.max(0, post.commentCount - 1)
  const row = items.value.find((one) => one.id === post.id)
  if (row) row.commentCount = post.commentCount
}

async function mark(status: ForumStatus) {
  if (!detail.value) return
  sync(await setForumStatus(detail.value.id, status))
  ElMessage.success(status === 'resolved' ? '已标为已处理' : '已重新打开')
}

watch(wide, (isWide) => {
  if (isWide && !detail.value && items.value[0]) open(items.value[0])
})

let media: MediaQueryList | undefined
function onWideChange(event: MediaQueryListEvent) {
  wide.value = event.matches
}

onMounted(() => {
  media = window.matchMedia(WIDE_QUERY)
  wide.value = media.matches
  media.addEventListener('change', onWideChange)
  load()
})

onBeforeUnmount(() => media?.removeEventListener('change', onWideChange))
</script>

<style scoped>
.forum {
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px 12px;
}
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex: none; }
.head h1 { font-size: 22px; font-weight: 800; }
.head p { margin-top: 4px; font-size: 13px; color: var(--color-text-secondary); }
.split { flex: 1; min-height: 0; display: grid; grid-template-columns: 380px minmax(0, 1fr); gap: 14px; }
.pane {
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-card);
  overflow: hidden;
}
.bar { display: flex; flex-direction: column; gap: 6px; padding: 12px 12px 8px; flex: none; }
.sort { font-size: 12px; color: var(--color-text-tertiary); }
.list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 0 8px 8px; }
.row {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 10px;
  align-items: start;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: var(--color-bg-secondary);
  cursor: pointer;
  transition: var(--transition);
}
.row:hover { border-color: var(--color-primary-line); }
.row.is-active { border-color: var(--color-primary); background: var(--color-primary-soft); }
.like {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 48px;
  min-height: 48px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-card);
  color: var(--color-text-secondary);
  font-weight: 800;
  cursor: pointer;
}
.like:hover:not(:disabled) { border-color: var(--color-primary-line); color: var(--color-primary-dark); }
.like.is-on { color: var(--color-primary-dark); background: var(--color-primary-soft); border-color: var(--color-primary-line); }
.like:disabled { cursor: progress; }
.like-inline { flex-direction: row; width: auto; min-height: 36px; padding: 0 14px; gap: 6px; }
.title-line { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
.title-line h3 { font-size: 14.5px; font-weight: 700; line-height: 1.45; word-break: break-word; }
.excerpt {
  margin: 4px 0 6px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--color-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.meta { display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; color: var(--color-text-tertiary); }
.stat { display: inline-flex; align-items: center; gap: 3px; }
.pager { justify-content: center; padding: 8px 0 10px; flex: none; }
.detail { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.detail-head { display: flex; align-items: flex-start; gap: 12px; padding: 16px 18px 12px; border-bottom: 1px solid var(--color-divider); flex: none; }
.detail-title { font-size: 18px; font-weight: 800; line-height: 1.45; word-break: break-word; }
.detail-ops { display: flex; flex: none; margin-left: auto; }
.back { display: none; align-items: center; gap: 2px; border: 0; background: transparent; color: var(--color-text-secondary); cursor: pointer; padding: 0; font-size: 13px; }
.detail-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px 20px; display: flex; flex-direction: column; gap: 14px; }
.content { white-space: pre-wrap; word-break: break-word; line-height: 1.8; font-size: 14.5px; }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.gallery :deep(.el-image) { width: 100%; height: 120px; border-radius: var(--radius-md); background: var(--color-bg-secondary); }
.player { display: flex; flex-direction: column; gap: 4px; }
.player video, .player audio { width: 100%; border-radius: var(--radius-md); }
.player video { background: #000; }
.player span, .docs a { font-size: 12.5px; color: var(--color-text-secondary); }
.docs { display: flex; flex-direction: column; gap: 6px; }
.docs a { display: inline-flex; align-items: center; gap: 6px; color: var(--color-primary-dark); }
.action-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.comments-title { font-size: 14px; font-weight: 800; }
.no-comment { font-size: 13px; color: var(--color-text-tertiary); }
.comments { list-style: none; display: flex; flex-direction: column; gap: 14px; }
.comments li { display: flex; gap: 10px; }
.ava {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex: none;
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
  font-weight: 800;
}
.comment-meta { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--color-text-tertiary); }
.comment-meta b { color: var(--color-text-primary); font-size: 13px; }
.comment-text { white-space: pre-wrap; word-break: break-word; line-height: 1.7; }
.composer { display: flex; align-items: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--color-divider); flex: none; }
.composer .el-textarea { flex: 1; }
.placeholder { margin: auto; }
@media (max-width: 859px) {
  .forum { padding: 12px; }
  .head { flex-direction: column; }
  .head p { display: none; }
  .split { grid-template-columns: 1fr; }
  .is-reading .list-pane { display: none; }
  .forum:not(.is-reading) .detail-pane { display: none; }
  .back { display: inline-flex; flex-basis: 100%; }
  .detail-head { flex-wrap: wrap; }
}
</style>
