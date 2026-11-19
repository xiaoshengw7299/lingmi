<template>
  <section class="statement">
    <h3>{{ PRICE_STATEMENT.title }}</h3>
    <p>{{ PRICE_STATEMENT.desc }}</p>
    <div class="promises">
      <div v-for="item in HOME_PROMISES" :key="item.title" class="promise">
        <el-icon :size="20"><component :is="item.icon" /></el-icon>
        <div><b>{{ item.title }}</b><span>{{ item.desc }}</span></div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { HOME_PROMISES, PRICE_STATEMENT } from '@/seo/site'
</script>

<style scoped>
.statement { margin-bottom: 22px; padding: 22px 24px; border: 1px solid var(--color-primary-line); border-radius: var(--radius-lg); background: var(--color-card); }
.statement h3 { font-size: 18px; font-weight: 800; color: var(--color-primary-dark); }
.statement > p { margin-top: 8px; font-size: 14px; line-height: 1.85; color: var(--color-text-secondary); }
.promises { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 16px; }
.promise { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-radius: var(--radius-md); background: var(--color-primary-soft); color: var(--color-primary-dark); }
.promise div { display: flex; flex-direction: column; line-height: 1.5; }
.promise b { font-size: 15px; }
.promise span { font-size: 12px; color: var(--color-text-secondary); }
@media (max-width: 860px) { .promises { grid-template-columns: 1fr; } }
</style>
