<template>
  <el-tooltip :content="saved ? '已加入我的资产' : '加入我的资产'" placement="top">
    <button v-if="quiet" type="button" class="quiet-save" :class="{ 'is-saved': saved }" :disabled="saving" @click.stop="save">
      <el-icon v-if="saving" class="is-loading" :size="14"><Loading /></el-icon>
      <el-icon v-else :size="14"><FolderAdd /></el-icon>
    </button>
    <el-button v-else :icon="saved ? Check : FolderAdd" :loading="saving" circle size="small" :type="saved ? 'success' : 'default'" @click.stop="save" />
  </el-tooltip>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, FolderAdd, Loading } from '@element-plus/icons-vue'
import { addAsset, type UserAsset, type UserAssetKind } from '@/api/asset'
import { useAuthStore } from '@/stores/auth'

/** 把一份媒体或提示词存进「我的资产」。视频制作、画布、提示词库共用同一个入口 */
const props = defineProps<{
  kind: UserAssetKind
  name: string
  /** 媒体地址（图片/视频/音频） */
  url?: string | null
  /** 提示词正文 */
  content?: string
  meta?: UserAsset['meta']
  /** 工作台卡片角标：浅色图标，不切换成对勾 */
  quiet?: boolean
}>()

const saving = ref(false)
const saved = ref(false)

async function save() {
  if (saving.value || saved.value || !useAuthStore().ensureLoggedIn()) return
  saving.value = true
  try {
    await addAsset({ kind: props.kind, name: props.name, url: props.url ?? undefined, content: props.content, meta: props.meta })
    saved.value = true
    ElMessage.success('已加入我的资产')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.quiet-save {
  flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; margin: 0; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: var(--color-text-tertiary); cursor: pointer;
  transition: color .15s;
}
.quiet-save:hover { color: var(--color-text-secondary); }
.quiet-save:disabled { cursor: default; }
.quiet-save.is-saved,
.quiet-save.is-saved:hover { color: var(--color-text-secondary); cursor: default; }
.is-loading { animation: quiet-spin 1s linear infinite; }
@keyframes quiet-spin { to { transform: rotate(360deg); } }
</style>
