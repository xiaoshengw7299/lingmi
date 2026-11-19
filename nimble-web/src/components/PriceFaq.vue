<template>
  <section class="faq">
    <h2 v-if="showTitle">常见问题</h2>
    <el-collapse>
      <el-collapse-item v-for="item in FAQ" :key="item.q" :title="item.q" :name="item.q">
        <p>{{ item.a }}</p>
      </el-collapse-item>
    </el-collapse>
  </section>
</template>

<script setup lang="ts">
import { FAQ } from '@/seo/site'

withDefaults(defineProps<{ showTitle?: boolean }>(), { showTitle: true })
</script>

<style scoped>
.faq h2 { margin-bottom: 14px; font-size: 22px; font-weight: 800; }
.faq p { line-height: 1.85; color: var(--color-text-secondary); }
</style>
