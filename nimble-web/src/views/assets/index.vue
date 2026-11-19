<template>
  <div class="lm-page">
    <div class="lm-container page">
      <header class="head">
        <div>
          <h2>我的资产</h2>
          <p>图片、视频、音频和提示词都收在这里，视频制作与无限画布里可以随时引用。</p>
        </div>
        <div class="head-actions">
          <el-button :icon="Edit" @click="promptDialog = true">新建提示词</el-button>
          <el-button type="primary" :icon="Upload" :loading="uploading" @click="fileInput?.click()">上传素材</el-button>
          <input ref="fileInput" type="file" accept="image/*,video/*,audio/*" multiple hidden @change="onFiles" />
        </div>
      </header>

      <div class="bar">
        <el-radio-group v-model="kind" @change="reload">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button v-for="(label, k) in ASSET_KIND_LABEL" :key="k" :value="k">{{ label }}</el-radio-button>
        </el-radio-group>
        <el-input v-model="keyword" clearable placeholder="搜索名称" :prefix-icon="Search" class="search" @input="debouncedReload" />
      </div>

      <div v-loading="loading" class="grid">
        <AssetCard v-for="asset in items" :key="asset.id" :asset="asset" @click="preview = asset">
          <template #actions>
            <el-button v-if="asset.kind === 'prompt'" :icon="CopyDocument" circle size="small" @click="copyPrompt(asset)" />
            <el-button :icon="Delete" circle size="small" type="danger" @click="remove(asset)" />
          </template>
        </AssetCard>
      </div>
      <el-empty v-if="!loading && !items.length" description="还没有资产。上传素材，或在视频制作、提示词库里点「加入我的资产」" />
      <el-pagination v-if="total > PAGE_SIZE" v-model:current-page="page" class="pager" layout="prev, pager, next" :page-size="PAGE_SIZE" :total="total" @current-change="load" />
    </div>

    <el-dialog v-model="promptDialog" title="新建提示词" width="560px" append-to-body>
      <el-form label-position="top">
        <el-form-item label="名称"><el-input v-model="draft.name" maxlength="60" /></el-form-item>
        <el-form-item label="提示词内容"><el-input v-model="draft.content" type="textarea" :rows="6" maxlength="8000" show-word-limit /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="promptDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!draft.name.trim() || !draft.content.trim()" @click="createPromptAsset">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="previewVisible" :title="preview?.name" width="min(720px, calc(100vw - 24px))" append-to-body destroy-on-close>
      <template v-if="preview">
        <el-image v-if="preview.kind === 'image'" :src="preview.url!" fit="contain" class="big" />
        <template v-else-if="preview.kind === 'video'">
          <video :src="preview.url!" controls playsinline class="big" />
          <VideoShareButton v-if="preview.url" source="asset" :id="preview.id" :video="preview.url" :title="preview.name" />
        </template>
        <audio v-else-if="preview.kind === 'audio'" :src="preview.url!" controls class="audio" />
        <p v-else class="full-prompt">{{ preview.content }}</p>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Delete, Edit, Search, Upload } from '@element-plus/icons-vue'
import AssetCard from '@/components/AssetCard.vue'
import VideoShareButton from '@/components/VideoShareButton.vue'
import { addAsset, ASSET_KIND_LABEL, deleteAsset, listAssets, uploadAsset, type UserAsset, type UserAssetKind } from '@/api/asset'
import { copyText } from '@/utils/clipboard'

const PAGE_SIZE = 40

const kind = ref<UserAssetKind | ''>('')
const keyword = ref('')
const page = ref(1)
const total = ref(0)
const items = ref<UserAsset[]>([])
const loading = ref(false)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement>()
const promptDialog = ref(false)
const draft = reactive({ name: '', content: '' })
const preview = ref<UserAsset>()
const previewVisible = computed({ get: () => !!preview.value, set: (v) => !v && (preview.value = undefined) })

async function load() {
  loading.value = true
  try {
    const res = await listAssets({ kind: kind.value || undefined, keyword: keyword.value, page: page.value, pageSize: PAGE_SIZE })
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

async function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (!files.length) return
  uploading.value = true
  try {
    for (const file of files) await uploadAsset(file)
    ElMessage.success(`已上传 ${files.length} 个素材`)
    await reload()
  } finally {
    uploading.value = false
  }
}

async function createPromptAsset() {
  await addAsset({ kind: 'prompt', name: draft.name.trim(), content: draft.content.trim() })
  promptDialog.value = false
  draft.name = draft.content = ''
  await reload()
}

const copyPrompt = (asset: UserAsset) => copyText(asset.content ?? '', '已复制提示词')

async function remove(asset: UserAsset) {
  await ElMessageBox.confirm(`确定删除「${asset.name}」吗？`, '删除资产', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  await deleteAsset(asset.id)
  await load()
}

onMounted(load)
</script>

<style scoped>
.page { padding-block: 24px; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.head h2 { font-size: 22px; font-weight: 800; }
.head p { margin-top: 4px; font-size: 13px; color: var(--color-text-secondary); }
.head-actions { display: flex; gap: 8px; flex-shrink: 0; }
.bar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.search { width: 240px; margin-left: auto; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px; min-height: 200px; }
.pager { justify-content: center; margin-top: 20px; }
.big { width: 100%; height: 62vh; background: var(--color-bg-secondary); }
.big :deep(.el-image__inner) { object-fit: contain; }
video.big { height: auto; max-height: 62vh; object-fit: contain; display: block; }
.audio { width: 100%; }
.full-prompt { white-space: pre-wrap; line-height: 1.8; font-size: 14px; color: var(--color-text-primary); }
</style>
