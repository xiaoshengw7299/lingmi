<template>
  <span class="drag-handle" title="拖动排序" aria-label="拖动排序">
    <el-icon :size="14"><Rank /></el-icon>
  </span>
</template>

<script setup lang="ts">
import { Rank } from '@element-plus/icons-vue'
</script>

<style scoped>
.drag-handle {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin: 0;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: grab;
  touch-action: none;
  user-select: none;
  transition: color .15s;
}
.drag-handle:hover { color: var(--color-text-secondary); }
.drag-handle:active { cursor: grabbing; }
.drag-handle.is-frozen { pointer-events: none; opacity: .35; cursor: default; }
</style>
