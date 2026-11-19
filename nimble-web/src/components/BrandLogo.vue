<template>
  <span class="brand-logo" :style="{ '--size': `${size}px` }">
    <img class="mark" src="@/assets/brand-mark.png" alt="" />
    <span v-if="text" class="word">
      <b>{{ APP_CONFIG.brandCn }}</b>
      <small>{{ APP_CONFIG.brand }}</small>
    </span>
  </span>
</template>

<script setup lang="ts">
import { APP_CONFIG } from '@/config'

withDefaults(defineProps<{ size?: number; text?: boolean }>(), { size: 32, text: true })
</script>

<style scoped>
.brand-logo { display: inline-flex; align-items: center; gap: 10px; color: var(--color-text-primary); }
.mark { width: var(--size); height: var(--size); flex-shrink: 0; display: block; }
.word { display: inline-flex; flex-direction: column; line-height: 1.1; white-space: nowrap; }
.word b { font-size: calc(var(--size) * 0.56); font-weight: 800; letter-spacing: 0.04em; }
.word small { font-size: calc(var(--size) * 0.32); font-weight: 600; letter-spacing: 0.22em; color: var(--color-primary); }
</style>
