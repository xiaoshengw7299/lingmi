<template>
  <el-container class="shell">
    <el-aside :width="collapsed ? '64px' : '220px'" class="aside">
      <div class="brand" @click="collapsed = !collapsed">
        <span class="mark">NP</span>
        <strong v-show="!collapsed">nimblePay</strong>
      </div>
      <el-menu
        :default-active="route.path"
        :collapse="collapsed"
        :collapse-transition="false"
        background-color="#0f172a"
        text-color="#cbd5e1"
        active-text-color="#5eead4"
        router
      >
        <el-menu-item v-for="m in menus" :key="m.path" :index="m.path">
          <el-icon><component :is="m.icon" /></el-icon>
          <template #title>{{ m.title }}</template>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container class="body">
      <el-header class="top">
        <span class="crumb">{{ title }}</span>
        <el-dropdown trigger="click">
          <span class="user">{{ auth.user?.realName || auth.user?.username }}</span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Coin,
  CreditCard,
  DataAnalysis,
  Document,
  Money,
  Odometer,
  Share,
  Tickets,
  User,
  Wallet,
} from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';

const collapsed = ref(false);
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const all = [
  { path: '/dashboard', title: '工作台', perm: 'dashboard:view', icon: Odometer },
  { path: '/wallets', title: '用户余额', perm: 'wallet:view', icon: Wallet },
  { path: '/orders', title: '充值订单', perm: 'order:view', icon: Tickets },
  { path: '/refunds', title: '退款', perm: 'refund:view', icon: Coin },
  { path: '/transfers', title: '转账', perm: 'transfer:view', icon: Money },
  { path: '/division', title: '分账', perm: 'division:view', icon: Share },
  { path: '/recon', title: '对账', perm: 'recon:view', icon: DataAnalysis },
  { path: '/alipay', title: '支付宝', perm: 'alipay:view', icon: CreditCard },
  { path: '/iam', title: '管理员', perm: 'iam:view', icon: User },
  { path: '/audit', title: '审计', perm: 'audit:view', icon: Document },
];
const menus = computed(() => all.filter((m) => auth.can(m.perm)));
const title = computed(() => all.find((m) => m.path === route.path)?.title || '');
function logout() {
  auth.logout();
  router.push('/login');
}
</script>

<style scoped>
.shell { height: 100vh; overflow: hidden; }
.aside { background: #0f172a; color: #fff; overflow: auto; }
.body { min-width: 0; height: 100vh; display: flex; flex-direction: column; }
.brand { height: 56px; display: flex; align-items: center; gap: 10px; padding: 0 16px; cursor: pointer; white-space: nowrap; }
.mark { width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center; background: #0f766e; font-size: 12px; font-weight: 800; flex: none; }
.top {
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e2e8f0;
  height: 56px;
}
.crumb { font-weight: 650; }
.user { cursor: pointer; color: #0f766e; font-weight: 650; outline: none; }
.main { flex: 1; min-width: 0; overflow: auto; padding: 20px; }
@media (max-width: 720px) {
  .main { padding: 12px; }
}
</style>
