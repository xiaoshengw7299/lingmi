<template>
  <div class="card-corner">
    <DragHandle v-if="sortable" :class="{ 'is-frozen': sortFrozen }" />
    <SaveToAssetButton
      v-if="asset?.url"
      quiet
      :kind="asset.kind"
      :name="asset.name"
      :url="asset.url"
      :meta="asset.meta"
    />
    <button type="button" class="corner-btn" title="删除" :disabled="deleteDisabled" @click.stop="$emit('delete')">
      <el-icon :size="14"><Delete /></el-icon>
    </button>
  </div>
</template>

<script setup lang="ts">
import { Delete } from '@element-plus/icons-vue'
import DragHandle from './DragHandle.vue'
import SaveToAssetButton from '@/components/SaveToAssetButton.vue'
import type { UserAsset } from '@/api/asset'

defineProps<{
  sortable?: boolean
  /** 这张卡正在生成时不允许拖动 */
  sortFrozen?: boolean
  deleteDisabled?: boolean
  asset?: Pick<UserAsset, 'kind' | 'name' | 'url' | 'meta'> | null
}>()

defineEmits<{ delete: [] }>()
</script>

<style scoped>
.card-corner {
  position: absolute; top: 7px; right: 8px; z-index: 5;
  display: flex; align-items: center; gap: 2px;
}
.corner-btn {
  flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; margin: 0; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: var(--color-text-tertiary); cursor: pointer;
  transition: color .15s;
}
.corner-btn:hover { color: var(--color-error); }
.corner-btn:disabled { opacity: .35; cursor: not-allowed; }
.corner-btn:disabled:hover { color: var(--color-text-tertiary); }
</style>
