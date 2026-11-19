<template>
  <div class="lm-page account-page account-dashboard">
    <div class="lm-container wrap">
      <header class="head">
        <div>
          <h1>运营统计</h1>
          <p>用户、充值和模型使用情况的概览。充值数据来自支付服务，不含支付宝测试单。</p>
        </div>
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      </header>

      <template v-if="stats">
        <section class="cards">
          <div v-for="card in cards" :key="card.label" class="lm-card card">
            <span>{{ card.label }}</span>
            <b class="lm-money">{{ card.value }}</b>
            <small>{{ card.hint }}</small>
          </div>
        </section>

        <section class="charts">
          <div class="lm-card panel">
            <h2>近 {{ stats.users.trend.length }} 天新增用户</h2>
            <TrendBars :items="userTrend" />
          </div>
          <div class="lm-card panel">
            <h2>近 {{ stats.recharge?.trend.length ?? 14 }} 天充值金额（元）</h2>
            <TrendBars v-if="stats.recharge" :items="rechargeTrend" />
            <p v-else class="muted">支付服务暂不可用</p>
          </div>
        </section>

        <section class="lm-card panel">
          <div class="panel-head">
            <h2>模型使用情况</h2>
            <el-radio-group v-model="range" size="small" class="account-range" aria-label="模型使用时间范围" @change="load">
              <el-radio-button v-for="item in RANGES" :key="item.value" :value="item.value">{{ item.label }}</el-radio-button>
            </el-radio-group>
          </div>

          <ul class="kinds">
            <li v-for="kind in kinds" :key="kind.kind">
              <span>{{ KIND_LABEL[kind.kind] }}</span>
              <b class="lm-money">{{ kind.calls }} 次</b>
              <small>¥ {{ yuan(kind.chargeCents) }} · 利润 {{ yuan(kind.profitCents) }}</small>
            </li>
          </ul>

          <ResponsiveTable :data="stats.usage.models" empty-text="这个时间段还没有调用记录">
            <el-table-column class-name="mobile-hidden" type="index" label="#" width="56" />
            <el-table-column class-name="mobile-wide mobile-heading" prop="modelName" label="模型" min-width="200" show-overflow-tooltip />
            <el-table-column label="类型" width="110">
              <template #default="{ row }">{{ KIND_LABEL[row.kind] ?? row.kind }}</template>
            </el-table-column>
            <el-table-column label="调用次数" min-width="200">
              <template #default="{ row }">
                <div class="calls">
                  <i :style="{ width: `${(row.calls / maxCalls) * 100}%` }" />
                  <b class="lm-money">{{ row.calls }}</b>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="users" label="使用人数" width="100" align="right" />
            <el-table-column label="用户实付（元）" width="130" align="right">
              <template #default="{ row }"><span class="lm-money">{{ yuan(row.chargeCents) }}</span></template>
            </el-table-column>
            <el-table-column class-name="mobile-wide" label="利润（元）" width="120" align="right">
              <template #default="{ row }"><b class="lm-money profit">{{ yuan(row.profitCents) }}</b></template>
            </el-table-column>
          </ResponsiveTable>
          <p class="hint">只统计扣费成功且没有退款的调用；文本模型每次调用算一次，按实际 token 折算。利润 = 用户实付 - 上游成本，逐笔明细见「消费账单」。</p>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import ResponsiveTable from '@/components/ResponsiveTable.vue'
import { computed, onMounted, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import TrendBars from '@/components/TrendBars.vue'
import { getPlatformStats, type PlatformStats, type UsageRange } from '@/api/admin'
import { KIND_LABEL, yuan } from '@/utils/format'

const RANGES: Array<{ value: UsageRange; label: string }> = [
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'all', label: '全部' },
]

const stats = ref<PlatformStats | null>(null)
const range = ref<UsageRange>('7d')
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    stats.value = await getPlatformStats(range.value)
  } finally {
    loading.value = false
  }
}

const cards = computed(() => {
  const s = stats.value
  if (!s) return []
  const r = s.recharge
  const rate = r && s.users.total ? `${((r.rechargeUsers / s.users.total) * 100).toFixed(1)}%` : '—'
  const unavailable = '支付服务暂不可用'
  return [
    { label: '总用户数', value: s.users.total, hint: `今日新增 ${s.users.today}` },
    { label: '当前在线', value: s.users.online, hint: `近 ${s.users.onlineWindowMinutes} 分钟内有操作` },
    { label: '今日活跃', value: s.users.activeToday, hint: '今天有过操作的用户' },
    {
      label: '作品总数',
      value: s.works.videos + s.works.shortVideos,
      hint: `视频 ${s.works.videos} · 成片 ${s.works.shortVideos}`,
    },
    { label: '充值用户', value: r?.rechargeUsers ?? '—', hint: r ? `转化率 ${rate} · 今日 ${r.todayRechargeUsers} 人` : unavailable },
    { label: '累计充值（元）', value: yuan(r?.rechargeCents), hint: r ? `${r.rechargeOrders} 笔 · 已退款 ${yuan(r.refundedCents)}` : unavailable },
    { label: '今日充值（元）', value: yuan(r?.todayRechargeCents), hint: r ? `${r.todayRechargeOrders} 笔` : unavailable },
    { label: '用户余额合计（元）', value: yuan(r?.balanceCents), hint: r ? `${r.walletCount} 个钱包` : unavailable },
  ]
})

const label = (date: string) => date.slice(5)
const userTrend = computed(() => stats.value?.users.trend.map((d) => ({ label: label(d.date), value: d.count, text: String(d.count) })) ?? [])
const rechargeTrend = computed(
  () => stats.value?.recharge?.trend.map((d) => ({ label: label(d.date), value: d.cents, text: String(Math.round(d.cents / 100)) })) ?? [],
)

const kinds = computed(() =>
  Object.keys(KIND_LABEL).flatMap((kind) => stats.value?.usage.kinds.filter((k) => k.kind === kind) ?? []),
)
const maxCalls = computed(() => Math.max(1, ...(stats.value?.usage.models.map((m) => m.calls) ?? [])))

onMounted(load)
</script>

<style scoped>
.wrap { padding-top: 28px; padding-bottom: 48px; max-width: 1200px; }
.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 18px; }
.head h1 { font-size: 24px; font-weight: 800; }
.head p { margin-top: 4px; font-size: 13px; color: var(--color-text-tertiary); }

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 16px; }
.card { display: grid; gap: 4px; padding: 18px 20px; }
.card span { font-size: 13px; color: var(--color-text-secondary); }
.card b { font-size: 28px; line-height: 1.2; color: var(--color-primary-dark); }
.card small { font-size: 12px; color: var(--color-text-tertiary); }

.charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 14px; margin-bottom: 16px; }
.panel { padding: 20px 24px 22px; }
.panel h2 { margin-bottom: 14px; font-size: 16px; font-weight: 800; }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.panel-head h2 { margin-bottom: 0; }

.kinds { list-style: none; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 16px; }
.kinds li { display: grid; gap: 2px; padding: 12px 14px; border-radius: var(--radius-md); background: var(--color-bg-secondary); }
.kinds span { font-size: 12px; color: var(--color-text-secondary); }
.kinds b { font-size: 18px; }
.kinds small { font-size: 12px; color: var(--color-text-tertiary); }

.calls { position: relative; display: flex; align-items: center; height: 24px; }
.calls i { position: absolute; left: 0; top: 2px; bottom: 2px; border-radius: 6px; background: var(--color-primary-soft); }
.calls b { position: relative; padding-left: 8px; font-size: 13px; }

.hint { margin-top: 12px; font-size: 12px; color: var(--color-text-tertiary); }
.muted { color: var(--color-text-tertiary); }
.profit { color: var(--color-accent); }
@media (max-width: 860px) {
  .charts { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .panel { min-width: 0; padding: 12px; }
  .panel-head { flex-wrap: wrap; gap: 8px; }
  .kinds { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .kinds li { padding: 8px; }
  .kinds li:last-child:nth-child(odd) { grid-column: 1 / -1; }
}
</style>
