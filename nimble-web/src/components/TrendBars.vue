<template>
  <div class="bars">
    <div v-for="(item, i) in items" :key="item.label" class="col" :class="{ 'is-last': i === items.length - 1 }" :title="`${item.label}：${item.text}`">
      <span class="val">{{ item.value > 0 ? item.text : '' }}</span>
      <div class="track"><i class="bar" :style="{ height: `${(item.value / max) * 100}%` }" /></div>
      <span class="lbl">{{ item.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /** value 决定柱高，text 是柱顶显示的文字（由调用方格式化） */
  items: Array<{ label: string; value: number; text: string }>
}>()

const max = computed(() => Math.max(1, ...props.items.map((item) => item.value)))
</script>

<style scoped>
.bars { display: flex; gap: 6px; height: 180px; }
.col { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.val { height: 14px; font-size: 11px; line-height: 14px; color: var(--color-text-secondary); white-space: nowrap; font-variant-numeric: tabular-nums; }
.track { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; }
.bar { display: block; width: 100%; max-width: 28px; min-height: 3px; border-radius: 6px 6px 2px 2px; background: var(--color-primary-line); transition: var(--transition); }
.col:hover .bar, .is-last .bar { background: var(--color-primary); }
.lbl { font-size: 11px; color: var(--color-text-tertiary); }
@media (max-width: 860px) {
  .bars { width: 100%; height: 160px; overflow-x: auto; padding-bottom: 4px; }
  .col { flex: 1 0 auto; min-width: 38px; }
}
</style>
