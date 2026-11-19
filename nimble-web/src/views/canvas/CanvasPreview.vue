<template>
  <div ref="boxRef" class="preview">
    <div class="world" :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${offset.k})` }">
      <svg class="edges">
        <path v-for="e in paths" :key="e.id" :d="e.d" />
      </svg>
      <CanvasNodeCard v-for="node in doc.nodes" :key="node.id" :node="node" :selected="false" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import CanvasNodeCard from './CanvasNodeCard.vue'
import { curve } from './geometry'
import type { CanvasDoc } from './types'

const props = defineProps<{ doc: CanvasDoc }>()

const PADDING = 32
const boxRef = ref<HTMLElement>()
const size = ref({ w: 1, h: 1 })
let observer: ResizeObserver | undefined

onMounted(() => {
  observer = new ResizeObserver(([entry]) => (size.value = { w: entry.contentRect.width, h: entry.contentRect.height }))
  observer.observe(boxRef.value!)
})
onBeforeUnmount(() => observer?.disconnect())

/** 只读预览：整块画布缩放居中，铺满容器，不可交互 */
const offset = computed(() => {
  const nodes = props.doc.nodes
  if (!nodes.length) return { x: 0, y: 0, k: 1 }
  const minX = Math.min(...nodes.map((n) => n.x))
  const minY = Math.min(...nodes.map((n) => n.y))
  const maxX = Math.max(...nodes.map((n) => n.x + n.w))
  const maxY = Math.max(...nodes.map((n) => n.y + n.h))
  const k = Math.min((size.value.w - PADDING * 2) / (maxX - minX), (size.value.h - PADDING * 2) / (maxY - minY), 1)
  return { k, x: (size.value.w - (maxX - minX) * k) / 2 - minX * k, y: (size.value.h - (maxY - minY) * k) / 2 - minY * k }
})

const paths = computed(() => {
  const byId = new Map(props.doc.nodes.map((n) => [n.id, n]))
  return props.doc.edges.flatMap((e) => {
    const a = byId.get(e.from)
    const b = byId.get(e.to)
    return a && b ? [{ id: e.id, d: curve(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2) }] : []
  })
})
</script>

<style scoped>
.preview { position: relative; flex: 1; min-height: 0; overflow: hidden; background: var(--color-background); pointer-events: none; }
.world { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-origin: 0 0; }
.edges { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; }
.edges path { fill: none; stroke: var(--color-primary-light); stroke-width: 2; }
</style>
