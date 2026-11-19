<template>
  <div class="callback">
    <BrandLogo :size="40" />
    <p>{{ message }}</p>
    <el-button v-if="failed" type="primary" round @click="router.replace('/login')">返回登录页</el-button>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import BrandLogo from '@/components/BrandLogo.vue'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const message = ref('正在完成微信登录…')
const failed = ref(false)

function fail(text: string) {
  message.value = text
  failed.value = true
}

onMounted(async () => {
  const code = typeof route.query.code === 'string' ? route.query.code : ''
  const state = typeof route.query.state === 'string' ? route.query.state : ''
  const saved = sessionStorage.getItem('auth-redirect')
  sessionStorage.removeItem('auth-redirect')
  if (!code || !state) return fail('微信没有返回授权码，请回到登录页重试')
  try {
    await authStore.loginWithWechat(code, state)
    await authStore.fetchUserInfo().catch(() => {})
    const loginName = authStore.user?.loginName
    if (authStore.user?.hasPassword === false && loginName) {
      ElMessage.success({
        message: `登录成功。你的登录账号是 ${loginName}，可在「账号安全」修改账号并设置密码`,
        duration: 6000,
      })
    }
    router.replace(saved?.startsWith('/') ? saved : '/')
  } catch (error) {
    const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message
    fail(message || '微信登录失败，请回到登录页重新扫码')
  }
})
</script>

<style scoped>
.callback { min-height: 100vh; display: grid; place-content: center; justify-items: center; gap: 18px; background: var(--color-background); color: var(--color-text-secondary); }
</style>
