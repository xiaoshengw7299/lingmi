<template>
  <div class="lm-page account-page">
    <div class="lm-container narrow">
      <header class="head lm-card">
        <UserAvatar :size="64" />
        <div class="who">
          <h1>{{ authStore.displayName }}</h1>
          <p>账号 {{ authStore.user?.loginName || '—' }}</p>
        </div>
        <div class="money">
          <small>账户余额</small>
          <b class="lm-money">¥ {{ yuan(wallet.balanceCents) }}</b>
        </div>
        <el-button type="primary" round @click="wallet.openRecharge()">充值</el-button>
      </header>

      <nav class="tabs">
        <router-link v-for="tab in TABS" :key="tab.to" :to="tab.to" class="tab" active-class="is-active">
          <el-icon><component :is="tab.icon" /></el-icon>{{ tab.label }}
        </router-link>
      </nav>

      <router-view />
    </div>
  </div>
</template>

<script setup lang="ts">
import UserAvatar from '@/components/UserAvatar.vue'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import { yuan } from '@/utils/format'

const TABS = [
  { to: '/user/profile', label: '个人资料', icon: 'User' },
  { to: '/user/wallet', label: '我的钱包', icon: 'Wallet' },
  { to: '/user/referral', label: '邀请有礼', icon: 'Present' },
  { to: '/user/security', label: '账号安全', icon: 'Lock' },
]

const authStore = useAuthStore()
const wallet = useWalletStore()
</script>

<style scoped>
.narrow { max-width: 960px; padding-top: 28px; padding-bottom: 56px; }
.head { display: flex; align-items: center; gap: 18px; padding: 22px 26px; }
.who { flex: 1; min-width: 0; }
.who h1 { font-size: 22px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.who p { margin-top: 2px; font-size: 13px; color: var(--color-text-tertiary); }
.money { display: flex; flex-direction: column; align-items: flex-end; margin-right: 6px; }
.money small { font-size: 12px; color: var(--color-text-tertiary); }
.money b { font-size: 26px; color: var(--color-primary); line-height: 1.2; }

.tabs { display: flex; gap: 6px; margin: 22px 0 18px; border-bottom: 1px solid var(--color-border); overflow-x: auto; }
.tab {
  display: inline-flex; align-items: center; gap: 6px; height: 44px; padding: 0 16px; margin-bottom: -1px; white-space: nowrap;
  font-size: 15px; font-weight: 600; color: var(--color-text-secondary); border-bottom: 2px solid transparent; transition: var(--transition);
}
.tab:hover { color: var(--color-text-primary); }
.tab.is-active { color: var(--color-primary-dark); border-bottom-color: var(--color-primary); }

@media (max-width: 860px) {
  .head {
    display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 14px;
    background: linear-gradient(135deg, var(--color-primary-soft), var(--color-card) 72%);
  }
  .head > .user-avatar { width: 48px; height: 48px; font-size: 20px; }
  .who { grid-column: 2 / -1; }
  .who h1 { font-size: 19px; }
  .who p { overflow-wrap: anywhere; }
  .money {
    grid-column: 1 / 3; align-items: flex-start; margin: 0; min-width: 0;
    padding: 8px 10px; border-radius: var(--radius-md); background: var(--color-primary-soft);
  }
  .money b { font-size: clamp(18px, 5.5vw, 24px); overflow-wrap: anywhere; }
  .head .el-button { min-height: 42px; }
  .tabs {
    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; margin: 12px 0;
    padding: 4px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card);
  }
  .tab {
    flex-direction: column; justify-content: center; gap: 4px; min-width: 0; height: 48px; margin: 0;
    padding: 0 2px; border: 0; border-radius: var(--radius-sm); font-size: 12px; line-height: 1;
  }
  .tab.is-active { background: var(--color-primary-soft); }
  .tab .el-icon { flex-shrink: 0; }
}
</style>
