<template>
  <span class="user-avatar" :style="{ '--size': `${size}px` }">
    <img v-if="avatar && !broken" :src="avatar" alt="" @error="broken = true" />
    <template v-else>{{ initial }}</template>
  </span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'

withDefaults(defineProps<{ size?: number }>(), { size: 36 })
const authStore = useAuthStore()
const broken = ref(false)

const avatar = computed(() => authStore.user?.avatar)
const initial = computed(() => (authStore.displayName || 'U').slice(0, 1).toUpperCase())
// 换了头像地址就重新尝试加载
watch(avatar, () => (broken.value = false))
</script>

<style scoped>
.user-avatar {
  width: var(--size); height: var(--size); border-radius: 50%; flex-shrink: 0; overflow: hidden;
  display: inline-grid; place-items: center;
  background: linear-gradient(145deg, var(--color-primary-light), var(--color-primary-dark));
  color: #fff; font-weight: 700; font-size: calc(var(--size) * 0.42);
}
img { width: 100%; height: 100%; object-fit: cover; }
</style>
