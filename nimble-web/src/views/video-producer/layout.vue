<template>
  <div ref="workspace" class="producer">
    <div class="tab-bar">
      <el-radio-group :model-value="tab" size="small" @change="(v) => switchTab(v as Tab)">
        <el-radio-button value="studio">通用创作</el-radio-button>
        <el-radio-button value="canvas">无限画布</el-radio-button>
      </el-radio-group>
      <span class="hint">{{ tab === 'studio' ? '对话生成分镜、素材与成片，一站式出片' : '自由摆放素材、连线即参考，灵活编排' }}</span>
    </div>
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'

type Tab = 'studio' | 'canvas'

const route = useRoute()
const router = useRouter()
const workspace = ref<HTMLElement>()
let resizeFrame = 0

function fitKeyboard() {
  if (resizeFrame) return
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0
    const viewport = window.visualViewport
    const el = workspace.value
    if (!viewport || !el) return
    // iOS 和部分 WebView 打开键盘时只缩小可视视口。
    if (window.innerWidth <= 960 && viewport.scale === 1 && window.innerHeight - viewport.height > 100) {
      const top = el.getBoundingClientRect().top
      el.style.maxHeight = `${Math.max(0, viewport.offsetTop + viewport.height - top)}px`
    } else {
      el.style.removeProperty('max-height')
    }
  })
}

onMounted(() => {
  window.visualViewport?.addEventListener('resize', fitKeyboard)
  window.visualViewport?.addEventListener('scroll', fitKeyboard)
})
onBeforeUnmount(() => {
  window.visualViewport?.removeEventListener('resize', fitKeyboard)
  window.visualViewport?.removeEventListener('scroll', fitKeyboard)
  cancelAnimationFrame(resizeFrame)
})

const tab = computed<Tab>(() => (route.name === 'video-canvas' ? 'canvas' : 'studio'))

/**
 * 两个标签页互相独立：各自用自己的地址参数（通用创作：会话 / 项目；无限画布：画布 id）。
 * 切走时记下各自的参数，切回来原样还原，看到的还是离开前打开的那个会话 / 画布。
 */
const lastQuery: Record<Tab, LocationQuery> = { studio: {}, canvas: {} }
watch(
  () => [route.name, route.query] as const,
  () => {
    if (route.name === 'video-studio' || route.name === 'video-canvas') lastQuery[tab.value] = { ...route.query }
  },
  { immediate: true },
)

const switchTab = (next: Tab) => router.push({ name: next === 'canvas' ? 'video-canvas' : 'video-studio', query: lastQuery[next] })
</script>

<style scoped>
.producer { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.tab-bar { display: flex; align-items: center; gap: 12px; height: 44px; padding: 0 16px; flex-shrink: 0; border-bottom: 1px solid var(--color-divider); background: var(--color-card); }
.hint { font-size: 12.5px; color: var(--color-text-tertiary); }
.producer > :deep(.agent-page), .producer > :deep(.canvas-page) { flex: 1; min-height: 0; }
@media (max-width: 960px) {
  .tab-bar { padding-inline: 10px; }
  .tab-bar :deep(.el-radio-group) { width: 100%; }
  .tab-bar :deep(.el-radio-button) { flex: 1; }
  .tab-bar :deep(.el-radio-button__inner) { width: 100%; min-height: 34px; display: grid; place-items: center; }
  .hint { display: none; }
}
</style>
