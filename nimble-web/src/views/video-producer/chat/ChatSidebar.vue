<template>
  <div class="chat-sidebar">
    <div class="new-chat-btn" @click="$emit('newChat')">
      <el-icon><Plus /></el-icon>
      <span>新建工作台</span>
      <span class="shortcut">Ctrl K</span>
    </div>

    <!-- 历史对话 -->
    <div class="history-section">
      <div class="history-label">历史对话</div>
      <el-scrollbar class="history-list">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="history-item"
          :class="{ active: session.id === currentSessionId }"
          @click="$emit('selectSession', session.id)"
        >
          <el-icon class="item-icon"><ChatRound /></el-icon>
          <span class="item-title" :title="session.title">{{ session.title || '新对话' }}</span>
          <button type="button" class="item-delete" aria-label="删除对话" @click.stop="handleDelete(session.id)"><el-icon><Delete /></el-icon></button>
        </div>
        <div v-if="sessions.length === 0" class="history-empty">暂无历史对话</div>
      </el-scrollbar>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Plus, ChatRound, Delete } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import type { AgentSession } from './types'

const props = withDefaults(defineProps<{
  sessions: AgentSession[]
  currentSessionId: string
  /** 删除确认文案；视频制作会同时删掉项目，需要说清楚 */
  deleteConfirm?: string
}>(), {
  deleteConfirm: '确定删除该对话吗？',
})

const emit = defineEmits<{
  newChat: []
  selectSession: [sessionId: string]
  deleteSession: [sessionId: string]
}>()

const handleDelete = async (sessionId: string) => {
  try {
    await ElMessageBox.confirm(props.deleteConfirm, '提示', { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' })
    emit('deleteSession', sessionId)
  } catch { /* 取消 */ }
}
</script>

<style scoped>
.chat-sidebar { width: 250px; height: 100%; display: flex; flex-direction: column; background: var(--color-card); border-right: 1px solid var(--color-border); flex-shrink: 0; }
.new-chat-btn { display: flex; align-items: center; gap: 8px; margin: 12px 12px 0; padding: 10px 14px; border-radius: 10px; border: 1px dashed var(--color-border); cursor: pointer; font-size: 14px; color: var(--color-text-secondary); transition: all .2s; user-select: none; }
.new-chat-btn:hover { border-color: var(--color-primary-light); color: var(--color-primary-light); background: var(--color-info-soft); }
.shortcut { margin-left: auto; font-size: 11px; color: var(--color-text-tertiary); background: var(--color-bg-secondary); padding: 2px 6px; border-radius: 4px; }
.history-section { flex: 1; display: flex; flex-direction: column; overflow: hidden; padding-top: 12px; }
.history-label { padding: 0 16px 8px; font-size: 12px; color: var(--color-text-tertiary); font-weight: 500; }
.history-list { flex: 1; }
.history-item { display: flex; align-items: center; gap: 8px; padding: 10px 16px; cursor: pointer; transition: background .15s; position: relative; }
.history-item:hover { background: var(--color-bg-secondary); }
.history-item.active { background: var(--color-info-soft); }
.item-icon { font-size: 14px; color: var(--color-text-tertiary); flex-shrink: 0; }
.history-item.active .item-icon { color: var(--color-primary-light); }
.item-title { flex: 1; font-size: 13px; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-item.active .item-title { color: var(--color-primary-light); font-weight: 500; }
.item-delete { display: grid; place-items: center; border: 0; background: none; cursor: pointer; font-size: 14px; color: transparent; flex-shrink: 0; transition: color .2s; }
.history-item:hover .item-delete, .item-delete:focus-visible { color: var(--color-text-tertiary); }
.item-delete:hover { color: var(--color-error) !important; }
.history-empty { padding: 40px 16px; text-align: center; font-size: 13px; color: var(--color-text-tertiary); }
@media (max-width: 960px) {
  .chat-sidebar { width: 100%; border: 0; }
  .shortcut { display: none; }
  .history-item { min-height: 44px; padding: 2px 10px; }
  .item-delete { width: 36px; height: 36px; color: var(--color-text-tertiary); }
}
</style>
