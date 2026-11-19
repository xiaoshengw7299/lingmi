<template>
  <div class="login">
    <form @submit.prevent="submit">
      <p>运营后台</p>
      <h1>nimblePay</h1>
      <el-input v-model="username" placeholder="用户名" />
      <el-input v-model="password" type="password" show-password placeholder="密码" />
      <el-button type="primary" native-type="submit" :loading="loading" style="width: 100%">登录</el-button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { login } from '@/api';
import { useAuthStore } from '@/stores/auth';

const username = ref('admin');
const password = ref('');
const loading = ref(false);
const router = useRouter();
const auth = useAuthStore();

async function submit() {
  loading.value = true;
  try {
    const data = (await login(username.value.trim(), password.value)) as { accessToken: string; refreshToken: string; user: never };
    localStorage.setItem('np_access', data.accessToken);
    localStorage.setItem('np_refresh', data.refreshToken);
    auth.user = data.user;
    router.push('/dashboard');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login { min-height: 100vh; display: grid; place-items: center; background: linear-gradient(160deg, #0f172a, #0f766e); }
form { width: min(360px, calc(100vw - 32px)); display: grid; gap: 14px; padding: 32px; border-radius: 20px; background: #fff; box-sizing: border-box; }
p { margin: 0; color: #0f766e; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; }
h1 { margin: 0 0 8px; }
</style>
