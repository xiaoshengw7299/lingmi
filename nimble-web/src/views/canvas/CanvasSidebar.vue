<template>
  <div class="sidebar">
    <div class="new-btn" @click="$emit('create')">
      <el-icon><Plus /></el-icon>
      <span>新建画布</span>
    </div>
    <div class="label">我的画布</div>
    <el-scrollbar class="list">
      <div
        v-for="item in items"
        :key="item.id"
        class="item"
        :class="{ active: item.id === currentId }"
        @click="$emit('select', item.id)"
      >
        <el-icon class="icon"><MagicStick /></el-icon>
        <span class="title" :title="item.title">{{ item.title || '未命名画布' }}</span>
        <button type="button" class="del" aria-label="删除画布" @click.stop="remove(item)"><el-icon><Delete /></el-icon></button>
      </div>
      <div v-if="!items.length" class="empty">{{ loading ? '加载中…' : '还没有画布' }}</div>
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { Delete, MagicStick, Plus } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import type { CanvasSummary } from '@/api/canvas'

defineProps<{ items: CanvasSummary[]; currentId: string; loading?: boolean }>()
const emit = defineEmits<{ create: []; select: [id: string]; remove: [id: string] }>()

async function remove(item: CanvasSummary) {
  try {
    await ElMessageBox.confirm(`确定删除画布「${item.title}」吗？删除后无法恢复。`, '提示', { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' })
    emit('remove', item.id)
  } catch { /* 取消 */ }
}
</script>

<style scoped>
.sidebar { width: 250px; height: 100%; display: flex; flex-direction: column; background: var(--color-card); border-right: 1px solid var(--color-border); flex-shrink: 0; }
.new-btn { display: flex; align-items: center; gap: 8px; margin: 12px 12px 0; padding: 10px 14px; border-radius: 10px; border: 1px dashed var(--color-border); cursor: pointer; font-size: 14px; color: var(--color-text-secondary); transition: all 0.2s; user-select: none; }
.new-btn:hover { border-color: var(--color-primary-light); color: var(--color-primary-light); background: var(--color-info-soft); }
.label { padding: 14px 16px 8px; font-size: 12px; color: var(--color-text-tertiary); font-weight: 500; }
.list { flex: 1; }
.item { display: flex; align-items: center; gap: 8px; padding: 10px 16px; cursor: pointer; transition: background 0.15s; }
.item:hover { background: var(--color-bg-secondary); }
.item.active { background: var(--color-info-soft); }
.icon { font-size: 14px; color: var(--color-text-tertiary); flex-shrink: 0; }
.item.active .icon, .item.active .title { color: var(--color-primary-light); }
.title { flex: 1; font-size: 13px; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.del { display: grid; place-items: center; border: 0; background: none; cursor: pointer; font-size: 14px; color: transparent; flex-shrink: 0; transition: color 0.2s; }
.item:hover .del, .del:focus-visible { color: var(--color-text-tertiary); }
.del:hover { color: var(--color-error) !important; }
.empty { padding: 40px 16px; text-align: center; font-size: 13px; color: var(--color-text-tertiary); }
@media (max-width: 960px) {
  .sidebar { width: 100%; border: 0; }
  .item { min-height: 44px; padding: 2px 10px; }
  .del { width: 36px; height: 36px; color: var(--color-text-tertiary); }
}
</style>
