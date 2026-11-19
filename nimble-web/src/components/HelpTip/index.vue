<template>
  <el-tooltip placement="top" :show-after="200" popper-class="help-tip-popper">
    <template #content>{{ tip }}</template>
    <button type="button" class="help-tip" aria-label="说明" @click.stop>?</button>
  </el-tooltip>
</template>

<script setup lang="ts">
defineProps<{ tip: string }>()
</script>

<style scoped>
.help-tip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--color-border);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  cursor: help;
  vertical-align: middle;
  flex-shrink: 0;
}
.help-tip:hover,
.help-tip:focus-visible {
  background: var(--color-primary);
  outline: none;
}
</style>

<style>
.help-tip-popper {
  max-width: 280px;
  line-height: 1.55;
  font-size: 12px;
}
</style>
