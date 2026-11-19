<template>
  <div class="welcome-header">
    <div class="welcome-icon">
      <el-icon :size="36" color="#0B8F5F"><VideoCamera /></el-icon>
    </div>
    <h2 class="welcome-title">今天想制作什么视频？</h2>
    <div class="question-grid">
      <div v-for="(q, i) in questions" :key="i" class="question-tag" @click="$emit('selectQuestion', q)">
        {{ q }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { VideoCamera } from '@element-plus/icons-vue'

defineProps<{ questions: string[] }>()
defineEmits<{ selectQuestion: [question: string] }>()
</script>

<style scoped>
.welcome-header { flex-shrink: 0; padding: 36px 20px 20px; text-align: center; }
.welcome-icon { margin-bottom: 14px; }
.welcome-title { font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin: 0 0 22px; }
.question-grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; max-width: 640px; margin: 0 auto; }
.question-tag { padding: 9px 18px; background: var(--color-bg-secondary); border-radius: 20px; font-size: 13.5px; color: var(--color-text-secondary); cursor: pointer; transition: all .2s; user-select: none; max-width: 280px; text-align: center; }
.question-tag:hover { background: var(--color-bg-secondary); color: var(--color-primary-dark); transform: translateY(-1px); }
@media (max-width: 960px) {
  .welcome-header { padding: 14px 10px; }
  .welcome-icon { display: none; }
  .welcome-title { font-size: 18px; margin-bottom: 10px; }
  .question-grid { gap: 6px; }
  .question-tag { padding: 6px 10px; max-width: 100%; }
}
</style>
