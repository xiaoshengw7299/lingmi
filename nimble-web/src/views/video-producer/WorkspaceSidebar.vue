<template>
  <div class="workspace-sidebar">
    <el-button v-if="compact" class="history-trigger" :icon="Clock" text @click="open = true">{{ title }}</el-button>
    <component
      :is="compact ? ElDrawer : 'aside'"
      v-bind="compact ? { modelValue: open, title, size: 'min(340px, 90vw)', appendToBody: true } : {}"
      @update:model-value="open = $event"
    >
      <slot :close="close" />
    </component>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { ElDrawer } from 'element-plus'
import { Clock } from '@element-plus/icons-vue'

defineProps<{ title: string }>()

const media = window.matchMedia('(max-width: 960px)')
const compact = ref(media.matches)
const open = ref(false)
const close = () => { open.value = false }

function onResize(event: MediaQueryListEvent) {
  compact.value = event.matches
  close()
}

media.addEventListener('change', onResize)
onBeforeUnmount(() => media.removeEventListener('change', onResize))
</script>

<style scoped>
.workspace-sidebar { flex: none; min-height: 0; display: flex; }
.workspace-sidebar > aside { min-height: 0; }
.history-trigger { min-height: 36px; margin: 0 8px; }
@media (max-width: 960px) {
  .workspace-sidebar { align-items: center; border-bottom: 1px solid var(--color-divider); background: var(--color-card); }
}
</style>
