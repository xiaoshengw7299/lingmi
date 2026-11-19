<template>
  <div class="lm-page pricing">
    <div class="lm-container">
      <header class="head">
        <span class="lm-eyebrow">PRICING</span>
        <h1>模型价格，一目了然</h1>
        <p>{{ PRICING_LEAD }}</p>
      </header>

      <PriceStatement />

      <div class="notes">
        <div v-for="note in PRICING_NOTES" :key="note.title" class="note"><b>{{ note.title }}</b><span>{{ note.desc }}</span></div>
      </div>

      <PriceTable :rows="pricing.rows" :loading="pricing.loading" />

      <PriceFaq class="faq" />

      <div class="cta">
        <el-button type="primary" size="large" round @click="router.push(authStore.isLoggedIn ? '/video-producer' : '/login')">
          {{ authStore.isLoggedIn ? '去创作' : '微信登录，开始创作' }}
        </el-button>
        <el-button v-if="authStore.isLoggedIn" size="large" round @click="wallet.openRecharge()">充值</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import PriceFaq from '@/components/PriceFaq.vue'
import PriceStatement from '@/components/PriceStatement.vue'
import PriceTable from '@/components/PriceTable.vue'
import { PRICING_LEAD, PRICING_NOTES } from '@/seo/site'
import { useAuthStore } from '@/stores/auth'
import { usePricingStore } from '@/stores/pricing'
import { useWalletStore } from '@/stores/wallet'

const router = useRouter()
const authStore = useAuthStore()
const wallet = useWalletStore()
const pricing = usePricingStore()

onMounted(() => void pricing.load().catch(() => undefined))
</script>

<style scoped>
.pricing { padding-bottom: 72px; }
.head { padding: 48px 0 28px; max-width: 720px; }
.head h1 { margin: 10px 0 12px; font-size: 36px; font-weight: 800; }
.head p { font-size: 16px; line-height: 1.85; color: var(--color-text-secondary); }
.notes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 26px; }
.note { display: flex; flex-direction: column; gap: 4px; padding: 16px 18px; border-radius: var(--radius-md); background: var(--color-primary-soft); }
.note b { color: var(--color-primary-dark); }
.note span { font-size: 13px; line-height: 1.7; color: var(--color-text-secondary); }
.faq { margin-top: 48px; }
.cta { display: flex; gap: 12px; justify-content: center; margin-top: 44px; }
@media (max-width: 860px) { .notes { grid-template-columns: 1fr; } .head h1 { font-size: 28px; } }
</style>
