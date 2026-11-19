<template>
  <div v-loading="loading" class="referral">
    <section class="hero lm-card">
      <div class="hero-text">
        <span class="lm-eyebrow"><el-icon><Present /></el-icon>邀请有礼</span>
        <h2>邀请好友，每人奖励 <em class="lm-money">¥{{ yuan(rule.rewardCents) }}</em></h2>
        <p>好友通过你的链接登录，并完成首次充值{{ minRechargeText }}，奖励就会自动到账，可用于任何生成。</p>
      </div>

      <div class="share">
        <label>你的专属邀请链接</label>
        <div class="link">
          <el-input :model-value="link" readonly />
          <el-button type="primary" :disabled="!data" @click="copy(link, '邀请链接已复制')">复制链接</el-button>
        </div>
        <p class="code">
          邀请码 <b>{{ data?.code || '—' }}</b>
          <el-button link type="primary" :disabled="!data" @click="copy(data?.code ?? '', '邀请码已复制')">复制</el-button>
        </p>
      </div>
    </section>

    <section class="steps">
      <div v-for="(s, i) in STEPS" :key="s" class="step">
        <span class="no">{{ i + 1 }}</span>{{ s }}
      </div>
    </section>

    <section class="stats">
      <div class="lm-card stat"><small>已邀请</small><b>{{ data?.invitedCount ?? 0 }}<i>人</i></b></div>
      <div class="lm-card stat"><small>已获得奖励</small><b>{{ data?.rewardedCount ?? 0 }}<i>人</i></b></div>
      <div class="lm-card stat"><small>累计奖励</small><b class="lm-money gold">¥{{ yuan(data?.totalRewardCents ?? 0) }}</b></div>
    </section>

    <section class="lm-card records">
      <h3>推广记录</h3>
      <ResponsiveTable :data="data?.items ?? []" empty-text="还没有邀请记录，快把链接分享给朋友吧">
        <el-table-column class-name="mobile-wide mobile-heading" prop="name" label="好友" min-width="120" />
        <el-table-column label="状态" width="150">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'REWARDED'" type="success" effect="light" round>已奖励</el-tag>
            <el-tag v-else type="info" effect="light" round>待首充</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="奖励" width="110" align="right">
          <template #default="{ row }">
            <b v-if="row.status === 'REWARDED'" class="lm-money gold">+¥{{ yuan(row.rewardCents) }}</b>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column class-name="mobile-wide" label="加入时间" width="170">
          <template #default="{ row }">{{ dateTime(row.createdAt) }}</template>
        </el-table-column>
      </ResponsiveTable>
      <el-pagination
        v-if="(data?.total ?? 0) > pageSize"
        class="pager"
        :pager-count="5"
        background
        layout="prev, pager, next"
        :total="data?.total"
        :page-size="pageSize"
        :current-page="page"
        @current-change="(p: number) => { page = p; load() }"
      />
    </section>

    <p v-if="auth.isDistributor" class="rules">
      你是分销商。通过你的邀请链接注册的用户归你名下，但不发放邀请现金，佣金在分销后台查看。
    </p>
    <p class="rules">
      活动规则：每位好友仅对其邀请人产生一次奖励；奖励以余额形式发放，可用于消费，不可提现；
      请勿使用小号刷奖励，平台保留对异常邀请行为的处理权。
    </p>
  </div>
</template>

<script setup lang="ts">
import ResponsiveTable from '@/components/ResponsiveTable.vue'
import { computed, onMounted, ref } from 'vue'
import { Present } from '@element-plus/icons-vue'
import { getReferral } from '@/api/wallet'
import { useAuthStore } from '@/stores/auth'
import type { ReferralOverview } from '@/types'
import { copyText as copy } from '@/utils/clipboard'
import { dateTime, yuan } from '@/utils/format'

const auth = useAuthStore()
const pageSize = 10
const data = ref<ReferralOverview | null>(null)
const page = ref(1)
const loading = ref(false)

const rule = computed(() => data.value?.rule ?? { rewardCents: 1400, minRechargeCents: 100, signupGiftCents: 0 })
const minRechargeText = computed(() => (rule.value.minRechargeCents > 100 ? `（单次不低于 ¥${yuan(rule.value.minRechargeCents)}）` : ''))
const link = computed(() => (data.value ? `${location.origin}/login?ref=${data.value.code}` : '加载中…'))
const STEPS = computed(() => [
  '复制你的专属邀请链接，发给朋友',
  '朋友通过链接登录灵米',
  `朋友完成首次充值，你立得 ¥${yuan(rule.value.rewardCents)}`,
])

async function load() {
  loading.value = true
  try {
    data.value = await getReferral(page.value, pageSize)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.referral { display: grid; gap: 18px; }
.hero {
  display: grid; grid-template-columns: 1.1fr 1fr; gap: 28px; padding: 28px; border-color: var(--color-border);
  background: linear-gradient(120deg, var(--color-warning-soft), var(--color-card) 55%, var(--color-primary-soft));
}
.hero h2 { margin: 10px 0 8px; font-size: 24px; font-weight: 800; }
.hero em { font-style: normal; color: var(--color-accent); font-size: 30px; }
.hero p { font-size: 14px; line-height: 1.8; color: var(--color-text-secondary); }
.share { align-self: center; }
.share label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 600; color: var(--color-text-secondary); }
.link { display: flex; gap: 8px; }
.code { margin-top: 8px; font-size: 13px; color: var(--color-text-tertiary); }
.code b { margin: 0 4px; letter-spacing: 0.08em; color: var(--color-text-primary); }

.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.step { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: var(--radius-md); background: var(--color-card); border: 1px dashed var(--color-primary-line); font-size: 14px; font-weight: 600; }
.no { flex-shrink: 0; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; background: var(--color-primary); color: #fff; font-size: 13px; font-weight: 800; }

.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.stat { display: flex; flex-direction: column; gap: 4px; padding: 18px 22px; }
.stat small { font-size: 13px; color: var(--color-text-tertiary); }
.stat b { font-size: 28px; font-weight: 800; }
.stat i { margin-left: 4px; font-size: 13px; font-style: normal; font-weight: 500; color: var(--color-text-tertiary); }
.gold { color: var(--color-accent); }
.muted { color: var(--color-text-tertiary); }

.records { padding: 22px 26px 24px; }
.records h3 { margin-bottom: 8px; font-size: 18px; font-weight: 800; }
.pager { margin-top: 16px; justify-content: flex-end; }
.rules { font-size: 12px; line-height: 1.8; color: var(--color-text-tertiary); }

@media (max-width: 860px) {
  .referral { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .hero, .steps { grid-template-columns: minmax(0, 1fr); }
  .hero, .records { padding: 14px; }
  .hero { gap: 14px; }
  .hero-text { text-align: center; }
  .hero h2 { font-size: 19px; }
  .hero em { font-size: 23px; }
  .share { min-width: 0; padding: 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); }
  .link { display: grid; grid-template-columns: minmax(0, 1fr); }
  .link .el-input { min-width: 0; }
  .link .el-button { min-height: 42px; }
  .code { text-align: center; }
  .steps, .stats { gap: 8px; }
  .step { padding: 8px 10px; }
  .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .stat { min-width: 0; align-items: center; text-align: center; padding: 10px 4px; }
  .stat small { font-size: 12px; }
  .stat b { font-size: 19px; overflow-wrap: anywhere; }
}
</style>
