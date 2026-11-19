<template>
  <el-table class="responsive-table" :cell-style="cellStyle">
    <slot />
  </el-table>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'

function cellStyle({ column }: { column: { label?: string } }): CSSProperties | undefined {
  if (column.label) return { '--cell-label': JSON.stringify(column.label) } as CSSProperties
}
</script>

<style scoped>
@media (max-width: 860px) {
  .responsive-table.el-table { --el-table-border-color: transparent; background: transparent; border: 0; box-shadow: none; }
  .responsive-table :deep(.el-table__header-wrapper),
  .responsive-table :deep(.el-table__footer-wrapper),
  .responsive-table :deep(.el-scrollbar__bar.is-horizontal),
  .responsive-table :deep(colgroup),
  .responsive-table :deep(.el-table__inner-wrapper::before) { display: none; }
  /* 滚动视图默认按内容收缩，手机端的卡片要撑满整个内容区。 */
  .responsive-table :deep(.el-table__body-wrapper > .el-scrollbar > .el-scrollbar__wrap > .el-scrollbar__view) { width: 100%; }
  .responsive-table :deep(.el-table__body),
  .responsive-table :deep(.el-table__body > tbody) { display: block; width: 100% !important; }
  .responsive-table :deep(.el-table__row) {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px;
    padding: 14px; margin-bottom: 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md);
    background: var(--color-card); content-visibility: auto; contain-intrinsic-size: auto 220px;
  }
  .responsive-table :deep(.el-table__row:last-child) { margin-bottom: 0; }
  .responsive-table :deep(.el-table__cell) {
    display: block; min-width: 0; padding: 0; text-align: left; border: 0; background: transparent !important;
    position: static !important; box-shadow: none;
  }
  .responsive-table :deep(.el-table__cell::before) {
    display: block; content: var(--cell-label, ''); color: var(--color-text-tertiary); font-size: 12px;
  }
  .responsive-table :deep(.el-table__cell::after) { display: none; }
  .responsive-table :deep(.el-table__cell > .cell) { width: auto !important; padding: 0; white-space: normal; overflow-wrap: anywhere; }
  .responsive-table :deep(.el-table__cell.mobile-wide) { grid-column: 1 / -1; }
  .responsive-table :deep(.el-table__cell.mobile-heading) {
    padding-bottom: 8px; border-bottom: 1px solid var(--color-divider);
  }
  .responsive-table :deep(.el-table__cell.mobile-heading > .cell) { font-weight: 650; color: var(--color-text-primary); }
  .responsive-table :deep(.el-table__cell.mobile-hidden) { display: none; }
  .responsive-table :deep(.el-table__cell.mobile-actions) { margin-top: 2px; padding-top: 10px; border-top: 1px solid var(--color-divider); }
  .responsive-table :deep(.el-table__cell.mobile-actions::before),
  .responsive-table :deep(.el-table__cell.mobile-actions:not(:has(.el-button))) { display: none; }
  .responsive-table :deep(.el-table__cell.mobile-actions > .cell) {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px;
  }
  .responsive-table :deep(.el-table__cell.mobile-actions .el-button) {
    width: 100%; min-height: 38px; margin: 0; padding: 4px;
    white-space: normal; border-radius: var(--radius-sm); background: var(--color-primary-soft);
  }
  .responsive-table :deep(.el-table__cell.mobile-actions .el-button--danger) { background: var(--color-error-soft); }
  .responsive-table :deep(.el-table__cell.mobile-actions .el-button:last-child:nth-child(odd)) { grid-column: 1 / -1; }
  .responsive-table :deep(.el-table__empty-block) {
    width: 100% !important; min-height: 76px; border: 1px solid var(--color-border);
    border-radius: var(--radius-md); background: var(--color-card);
  }
  .responsive-table :deep(.el-table__empty-text) { width: auto; padding: 12px; line-height: 1.6; }
}
</style>
