<template>
  <div class="auth">
    <section class="story">
      <router-link to="/" class="brand"><BrandLogo :size="40" /></router-link>

      <div class="story-body">
        <span class="lm-eyebrow light">AI 视频创作平台</span>
        <h1>每一个创意，<br />从一个小小的<em>灵感种子</em>开始</h1>
        <ul>
          <li v-for="item in POINTS" :key="item.title">
            <el-icon :size="20"><component :is="item.icon" /></el-icon>
            <div><b>{{ item.title }}</b><span>{{ item.desc }}</span></div>
          </li>
        </ul>
      </div>

      <p class="story-foot">{{ APP_CONFIG.brandCn }} {{ APP_CONFIG.brand }} · 用户隔离，隐私安全</p>
    </section>

    <section class="panel">
      <div class="card">
        <p class="step">WELCOME</p>
        <h2>{{ showQr ? '微信登录' : '登录' }}</h2>
        <p class="desc">{{ showQr ? '扫码即可进入。第一次登录会自动分配账号，设置密码后也可以直接登录。' : '使用登录账号和密码。第一次使用请先微信登录，再设置密码。' }}</p>

        <template v-if="!showQr">
          <el-form label-position="top" size="large" @submit.prevent="submit">
            <el-form-item label="账号">
              <el-input v-model="account" maxlength="32" placeholder="登录账号" autocomplete="username" />
            </el-form-item>
            <el-form-item label="密码">
              <el-input v-model="password" type="password" show-password placeholder="至少 8 位" autocomplete="current-password" />
            </el-form-item>
            <el-button type="primary" size="large" class="submit" native-type="submit" :loading="submitting">登录</el-button>
          </el-form>
          <p class="hint">首次微信登录后，可在「用户中心 → 账号安全」修改登录账号并设置密码。</p>
          <template v-if="wechatReady">
            <el-divider>或</el-divider>
            <el-button size="large" class="wechat-btn" @click="openWechat">微信登录</el-button>
          </template>
        </template>

        <template v-else>
          <div class="qr-box">
            <div id="wechat-qr" class="qr" />
          </div>
          <el-button text type="primary" @click="backToPassword">返回账号登录</el-button>
        </template>

        <p class="legal">
          登录即表示同意
          <router-link to="/terms" target="_blank">《用户协议》</router-link>和
          <router-link to="/privacy" target="_blank">《隐私政策》</router-link>
        </p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Coin, RefreshLeft, VideoCamera } from '@element-plus/icons-vue'
import { getAuthProviders, getWechatConnect } from '@/api/auth'
import BrandLogo from '@/components/BrandLogo.vue'
import { APP_CONFIG } from '@/config'
import { useAuthStore } from '@/stores/auth'

const POINTS = [
  { icon: VideoCamera, title: '视频、图片、配音一站式', desc: '从脚本到成片，一个平台做完' },
  { icon: Coin, title: '价格透明，充多少用多少', desc: '每个模型的单价都和官方对比' },
  { icon: RefreshLeft, title: '失败自动退回', desc: '生成失败的任务不收费' },
]

declare global {
  interface Window {
    WxLogin?: new (options: Record<string, string | number | boolean>) => void
  }
}

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const account = ref('')
const password = ref('')
const submitting = ref(false)
const showQr = ref(false)
const wechatReady = ref(false)

const redirect = computed(() => {
  const value = route.query.redirect
  return typeof value === 'string' && value.startsWith('/') ? value : '/'
})

onMounted(() => {
  void loadProviders()
})

async function loadProviders() {
  try {
    wechatReady.value = (await getAuthProviders()).wechat
  } catch {
    wechatReady.value = false
  }
}

async function openWechat() {
  sessionStorage.setItem('auth-redirect', redirect.value)
  showQr.value = true
  try {
    const connect = await getWechatConnect()
    await nextTick()
    await loadWxLogin()
    const box = document.getElementById('wechat-qr')
    if (box) box.innerHTML = ''
    new window.WxLogin!({
      self_redirect: false,
      id: 'wechat-qr',
      appid: connect.appId,
      scope: 'snsapi_login',
      redirect_uri: encodeURIComponent(connect.redirectUri),
      state: connect.state,
      style: 'black',
      stylelite: 1,
    })
  } catch {
    showQr.value = false
    ElMessage.error('微信登录暂时无法打开')
  }
}

function backToPassword() {
  showQr.value = false
}

function loadWxLogin() {
  if (window.WxLogin) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('微信登录脚本加载失败'))
    document.body.appendChild(script)
  })
}

async function submit() {
  if (submitting.value) return
  const name = account.value.trim().toLowerCase()
  if (!/^[a-z0-9]{4,32}$/.test(name)) return void ElMessage.warning('请输入 4～32 位字母或数字的账号')
  if (password.value.length < 8) return void ElMessage.warning('密码至少 8 位')
  submitting.value = true
  try {
    await authStore.login(name, password.value)
    await authStore.fetchUserInfo().catch(() => {})
    ElMessage.success('登录成功')
    router.replace(redirect.value)
  } catch (error) {
    const response = (error as { response?: { status?: number; data?: { message?: string } } }).response
    if (response?.status === 401) ElMessage.error(response.data?.message || '登录失败')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.auth { min-height: 100vh; display: grid; grid-template-columns: minmax(420px, 1.05fr) minmax(420px, 0.95fr); background: var(--color-background); }

.story {
  position: relative; display: flex; flex-direction: column; padding: 36px 56px 32px; overflow: hidden; color: #eafaf2;
  background: radial-gradient(circle at 80% 12%, rgba(233, 196, 106, 0.28), transparent 34%), radial-gradient(circle at 12% 88%, rgba(52, 178, 127, 0.35), transparent 40%),
    linear-gradient(160deg, #0f3d2c 0%, #08724c 60%, #0b8f5f 130%);
}
.brand { width: fit-content; }
.brand :deep(.brand-logo) { color: #fff; }
.brand :deep(small) { color: #ffe9a8; }
.story-body { margin-top: 72px; max-width: 520px; }
.lm-eyebrow.light { color: #ffe9a8; }
.story h1 { margin: 14px 0 34px; font-size: clamp(28px, 2.9vw, 40px); line-height: 1.25; font-weight: 800; color: #fff; }
.story em { font-style: normal; color: #ffe9a8; }
.story ul { list-style: none; display: grid; gap: 18px; }
.story li { display: flex; gap: 14px; align-items: flex-start; }
.story li .el-icon { margin-top: 3px; color: #ffe9a8; }
.story li div { display: flex; flex-direction: column; gap: 2px; }
.story li b { font-size: 16px; color: #fff; }
.story li span { font-size: 13px; color: rgba(234, 250, 242, 0.75); }
.story-foot { margin-top: auto; padding-top: 32px; font-size: 13px; color: rgba(234, 250, 242, 0.6); }

.panel { display: flex; align-items: center; justify-content: center; padding: 40px 28px; }
.card { width: min(420px, 100%); }
.step { font-size: 12px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-primary); }
.card h2 { margin: 8px 0 0; font-size: 30px; font-weight: 800; }
.desc { margin: 8px 0 18px; font-size: 14px; line-height: 1.7; color: var(--color-text-tertiary); }
.qr-box { display: grid; place-items: center; min-height: 300px; margin-bottom: 4px; border-radius: var(--radius-md); background: var(--color-card); }
.qr { width: 300px; min-height: 300px; }
.legal { margin: 18px 0 0; font-size: 13px; text-align: center; color: var(--color-text-tertiary); }
.legal a { color: var(--color-primary); font-weight: 600; }
.submit, .wechat-btn { width: 100%; height: 46px; border-radius: var(--radius-md); }
.wechat-btn { margin-top: 0; }
.hint { margin-top: 14px; font-size: 13px; line-height: 1.7; color: var(--color-text-tertiary); }

@media (max-width: 960px) {
  .auth { grid-template-columns: 1fr; }
  .story { padding: 24px; }
  .story-body { margin-top: 28px; }
  .story ul, .story-foot { display: none; }
  .story h1 { margin-bottom: 0; font-size: 28px; }
}
@media (max-width: 480px) {
  .panel { padding-inline: 18px; }
  .card :deep(.el-input__inner) { font-size: 16px; }
}
</style>
