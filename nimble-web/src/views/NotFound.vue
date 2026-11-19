<template>
  <div class="not-found">
    <BrandLogo :size="40" />
    <div class="code">404</div>
    <p>这颗种子还没有发芽，你访问的页面不存在</p>
    <el-button type="primary" round @click="router.push('/')">返回首页</el-button>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import BrandLogo from '@/components/BrandLogo.vue'

const router = useRouter()
</script>

<style scoped>
.not-found { min-height: 100vh; display: grid; place-content: center; justify-items: center; gap: 14px; background: var(--color-background); text-align: center; }
.code { font-size: 88px; font-weight: 800; line-height: 1; color: var(--color-primary); letter-spacing: 0.04em; }
p { font-size: 16px; color: var(--color-text-secondary); margin-bottom: 8px; }
</style>
