<template>
  <div v-if="storyboard" class="storyboard-card" @click="open">
    <div class="storyboard-icon">
      <el-icon :size="22" color="#fff"><VideoCamera /></el-icon>
    </div>
    <div class="storyboard-info">
      <div class="storyboard-title">{{ storyboard.title }}</div>
      <div class="storyboard-meta">{{ storyboard.assetCount ?? 0 }} 个素材 · {{ storyboard.shotCount ?? 0 }} 个分镜</div>
    </div>
    <el-button type="primary" size="small" round>打开工作台</el-button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { VideoCamera } from '@element-plus/icons-vue'
import type { BiPart, VideoStoryboardSummary } from '@/api/agent'

/** 智能体生成分镜脚本后在对话里展示的摘要卡片（后端 bi.tag === 'video-storyboard'），点击打开视频工作台 */
const props = defineProps<{ data?: BiPart }>()
const emit = defineEmits<{ 'open-storyboard': [projectId: string] }>()

const storyboard = computed(() =>
  props.data?.tag === 'video-storyboard' ? (props.data.data as VideoStoryboardSummary) : undefined,
)

const open = () => {
  if (storyboard.value?.projectId) emit('open-storyboard', storyboard.value.projectId)
}
</script>

<style scoped>
.storyboard-card { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border: 1px solid var(--color-border); border-radius: 10px; cursor: pointer; transition: all .2s; background: var(--color-card); }
.storyboard-card:hover { border-color: var(--color-primary); box-shadow: 0 2px 12px color-mix(in srgb, var(--color-primary) 12%, transparent); }
.storyboard-icon { flex-shrink: 0; width: 40px; height: 40px; border-radius: 10px; background: linear-gradient(135deg, var(--color-primary), var(--color-primary-light)); display: flex; align-items: center; justify-content: center; }
.storyboard-info { flex: 1; min-width: 0; }
.storyboard-title { font-size: 14px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 2px; }
.storyboard-meta { font-size: 12px; color: var(--color-text-tertiary); }
</style>
