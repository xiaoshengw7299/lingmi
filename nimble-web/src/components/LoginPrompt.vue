<template>
  <el-dialog v-model="authStore.loginPromptOpen" width="min(400px, 92vw)" align-center>
    <div class="prompt">
      <BrandLogo :size="46" :text="false" />
      <h3>登录后即可开始创作</h3>
      <p v-if="route.name === 'short-video'">首次微信登录会自动创建账号。登录后会回到一键成片。</p>
      <p v-else>微信扫码即可登录，第一次会自动分配账号。按量计费、失败自动退回，每次生成前就知道要花多少。</p>
    </div>
    <template #footer>
      <el-button type="primary" size="large" @click="goLogin">{{ route.name === 'short-video' ? '去登录' : '微信登录' }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import BrandLogo from '@/components/BrandLogo.vue'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()

/** 登录完成后回到用户刚才所在的页面 */
function goLogin() {
  authStore.loginPromptOpen = false
  router.push({ path: '/login', query: { redirect: route.fullPath } })
}
</script>

<style scoped>
.prompt { display: grid; justify-items: center; gap: 10px; padding-top: 6px; text-align: center; }
.prompt h3 { font-size: 20px; font-weight: 800; }
.prompt p { max-width: 300px; font-size: 14px; line-height: 1.8; color: var(--color-text-secondary); }
</style>
