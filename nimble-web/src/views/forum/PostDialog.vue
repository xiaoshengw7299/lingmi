<template>
  <el-dialog v-model="visible" :title="post ? '编辑帖子' : '发帖'" width="640px" append-to-body destroy-on-close @open="init" @closed="cleanup">
    <el-form label-position="top" @submit.prevent="submit">
      <el-form-item label="标题">
        <el-input v-model="form.title" maxlength="80" show-word-limit placeholder="一句话说清你想分享或反馈的事" />
      </el-form-item>
      <el-form-item label="内容">
        <el-input v-model="form.content" type="textarea" :rows="8" maxlength="5000" show-word-limit placeholder="写清楚做法、结果，或者问题是怎么出现的" />
      </el-form-item>
      <el-form-item label="谁可以看">
        <div class="vis">
          <button type="button" :class="{ on: form.visibility === 'public' }" @click="form.visibility = 'public'">
            <b>公开</b>
            <span>所有人可见，可以一起讨论</span>
          </button>
          <button type="button" :class="{ on: form.visibility === 'admin' }" @click="form.visibility = 'admin'">
            <b>仅管理员</b>
            <span>只有你和管理员能看到，适合反馈问题</span>
          </button>
        </div>
      </el-form-item>
      <el-form-item label="附件">
        <button type="button" class="drop" :disabled="drafts.length >= FORUM_MAX_FILES" @click="fileInput?.click()" @dragover.prevent @drop.prevent="addFiles($event.dataTransfer?.files)">
          <el-icon><Upload /></el-icon>
          <span>点击或拖拽添加</span>
          <small>图片、视频、音频、PDF，最多 {{ FORUM_MAX_FILES }} 个，单个 20MB</small>
        </button>
        <input ref="fileInput" type="file" :accept="forumAccept" multiple hidden @change="onPick" />
        <ul v-if="drafts.length" class="files">
          <li v-for="(item, i) in drafts" :key="item.key || item.url">
            <img v-if="item.mime.startsWith('image/')" :src="item.url" alt="" />
            <el-icon v-else><Document /></el-icon>
            <span class="name" :title="item.name">{{ item.name }}</span>
            <span class="size">{{ fileSize(item.size) }}</span>
            <el-button :icon="Close" circle size="small" text @click="removeDraft(i)" />
          </li>
        </ul>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!form.title.trim() || !form.content.trim()" @click="submit">
        {{ post ? '保存' : '发布' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Close, Document, Upload } from '@element-plus/icons-vue'
import {
  FORUM_MAX_FILES,
  createForumPost,
  forumAccept,
  forumFileError,
  updateForumPost,
  uploadForumFile,
  type ForumPost,
  type ForumVisibility,
} from '@/api/forum'

interface Draft {
  key?: string
  name: string
  mime: string
  size: number
  url: string
  file?: File
  local?: boolean
}

const props = defineProps<{ post?: ForumPost | null }>()
const emit = defineEmits<{ saved: [post: ForumPost] }>()
const visible = defineModel<boolean>({ default: false })

const form = reactive({ title: '', content: '', visibility: 'public' as ForumVisibility })
const drafts = ref<Draft[]>([])
const saving = ref(false)
const fileInput = ref<HTMLInputElement>()

function init() {
  cleanup()
  form.title = props.post?.title ?? ''
  form.content = props.post?.content ?? ''
  form.visibility = props.post?.visibility ?? 'public'
  drafts.value = (props.post?.attachments ?? []).map((item) => ({ ...item }))
}

function cleanup() {
  drafts.value.forEach((item) => item.local && URL.revokeObjectURL(item.url))
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  addFiles(input.files)
  input.value = ''
}

function addFiles(list: FileList | null | undefined) {
  if (!list?.length) return
  for (const file of list) {
    const message = forumFileError(file, drafts.value.length)
    if (message) {
      ElMessage.warning(message)
      if (drafts.value.length >= FORUM_MAX_FILES) break
      continue
    }
    drafts.value.push({
      name: file.name,
      mime: file.type,
      size: file.size,
      url: URL.createObjectURL(file),
      file,
      local: true,
    })
  }
}

function removeDraft(index: number) {
  const [item] = drafts.value.splice(index, 1)
  if (item?.local) URL.revokeObjectURL(item.url)
}

async function submit() {
  const title = form.title.trim()
  const content = form.content.trim()
  if (!title || !content || saving.value) return
  saving.value = true
  try {
    const attachments: Array<{ key: string; name: string; mime: string; size: number }> = []
    for (const item of drafts.value) {
      if (!item.file && !item.key) continue
      const file = item.key ? item : await uploadForumFile(item.file as File)
      if (!file.key) continue
      attachments.push({ key: file.key, name: file.name, mime: file.mime, size: file.size })
    }
    const payload = { title, content, visibility: form.visibility, attachments }
    const saved = props.post ? await updateForumPost(props.post.id, payload) : await createForumPost(payload)
    emit('saved', saved)
    visible.value = false
  } finally {
    saving.value = false
  }
}

function fileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
</script>

<style scoped>
.vis { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; width: 100%; }
.vis button {
  text-align: left;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-card);
  cursor: pointer;
  transition: var(--transition);
}
.vis button.on { border-color: var(--color-primary); background: var(--color-primary-soft); }
.vis b { display: block; font-size: 14px; }
.vis span { display: block; margin-top: 2px; font-size: 12px; line-height: 1.5; color: var(--color-text-secondary); }
.drop {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 16px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.drop:hover:not(:disabled) { border-color: var(--color-primary); color: var(--color-primary-dark); }
.drop:disabled { cursor: not-allowed; opacity: 0.6; }
.drop small { font-size: 12px; color: var(--color-text-tertiary); }
.files { list-style: none; width: 100%; margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.files li { display: flex; align-items: center; gap: 8px; }
.files img { width: 40px; height: 40px; object-fit: cover; border-radius: var(--radius-sm); background: var(--color-bg-secondary); }
.files .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.files .size { color: var(--color-text-tertiary); font-size: 12px; }
@media (max-width: 640px) { .vis { grid-template-columns: 1fr; } }
</style>
