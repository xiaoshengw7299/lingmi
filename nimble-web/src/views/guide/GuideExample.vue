<template>
  <div ref="root">
    <ToolShowcase v-if="open" :tool-id="toolId" :showcase="showcase" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import ToolShowcase from '@/views/tools/ToolShowcase.vue'
import type { Showcase } from '@/api/media-tools'

defineProps<{ toolId: string; showcase: Showcase[] }>()

const root = ref<HTMLElement>()
const open = ref(false)
let observer: IntersectionObserver | undefined

onMounted(() => {
  const el = root.value
  if (!el || typeof IntersectionObserver === 'undefined') {
    open.value = true
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      open.value = true
      observer?.disconnect()
    },
    { root: el.closest('.lm-page'), rootMargin: '240px' },
  )
  observer.observe(el)
})

onBeforeUnmount(() => observer?.disconnect())
</script>
