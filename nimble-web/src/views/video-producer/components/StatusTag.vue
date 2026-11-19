<template>
  <el-tooltip v-if="status === 'failed' && error" :content="error" placement="top">
    <span class="status-tag" :class="[`is-${status}`, { 'is-mini': mini }]">
      <el-icon :size="mini ? 10 : 12" class="status-icon"><component :is="iconMap[status]" /></el-icon>
      <span v-if="!mini || label" class="status-text">{{ label ?? textMap[status] ?? status }}</span>
    </span>
  </el-tooltip>
  <span v-else class="status-tag" :class="[`is-${status}`, { 'is-mini': mini }]">
    <el-icon :size="mini ? 10 : 12" class="status-icon"><component :is="iconMap[status]" /></el-icon>
    <span v-if="!mini || label" class="status-text">{{ label ?? textMap[status] ?? status }}</span>
  </span>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { Clock, Loading, CircleCheckFilled, WarningFilled } from '@element-plus/icons-vue'
import { MEDIA_STATUS_LABEL } from '../constants'

const { status, label, error, mini } = defineProps<{
  status: string
  label?: string
  error?: string | null
  /** 极简模式：仅图标，用于媒体预览切换按钮等空间紧张处 */
  mini?: boolean
}>()

const iconMap: Record<string, Component> = {
  idle: Clock,
  draft: Clock,
  queued: Clock,
  generating: Loading,
  composing: Loading,
  success: CircleCheckFilled,
  done: CircleCheckFilled,
  failed: WarningFilled,
}

const textMap = MEDIA_STATUS_LABEL
</script>

<style scoped>
.status-tag {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 20px;
  font-size: 12px; font-weight: 500; line-height: 1.6; white-space: nowrap; vertical-align: middle;
}
.status-tag.is-mini { padding: 3px; }
.status-icon.is-mini-icon { flex-shrink: 0; }

.status-tag.is-idle, .status-tag.is-draft { background: var(--color-bg-secondary); color: var(--color-text-tertiary); }
.status-tag.is-queued { background: var(--color-primary-soft); color: var(--color-primary); }
.status-tag.is-generating, .status-tag.is-composing { background: var(--color-warning-soft); color: var(--color-warning); }
.status-tag.is-success, .status-tag.is-done { background: var(--color-success-soft); color: var(--color-success); }
.status-tag.is-failed { background: var(--color-error-soft); color: var(--color-error); }

.status-tag :deep(.el-icon) { flex-shrink: 0; }
.status-tag.is-generating .status-icon,
.status-tag.is-composing .status-icon { animation: status-spin 1s linear infinite; }

@keyframes status-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
