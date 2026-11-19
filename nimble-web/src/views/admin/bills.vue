<template>
  <div class="lm-page account-page account-dashboard">
    <div class="lm-container wrap">
      <header class="head">
        <div>
          <h1>消费账单</h1>
          <p>每笔扣费的用户实付、上游成本和利润。成本是 Atlas 实付价按扣费当时的汇率折算，不含加价；已退款的调用不计入汇总。</p>
        </div>
      </header>

      <section class="lm-card filters">
        <form v-if="compact" class="date-fields" @submit.prevent="applyDates">
          <label>开始日期<input v-model="dateFrom" type="date" :max="dateTo || undefined" /></label>
          <label>结束日期<input v-model="dateTo" type="date" :min="dateFrom || undefined" /></label>
          <div class="date-actions">
            <el-button v-if="dates" native-type="button" @click="clearDates">清除日期</el-button>
            <el-button type="primary" native-type="submit" :disabled="!dateFrom || !dateTo || dateFrom > dateTo">筛选日期</el-button>
          </div>
        </form>
        <el-date-picker
          v-else
          v-model="dates"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          @change="reload"
        />
        <el-select v-model="kind" clearable placeholder="全部类型" class="kind" @change="reload">
          <el-option v-for="(label, value) in KIND_LABEL" :key="value" :label="label" :value="value" />
        </el-select>
        <el-tag v-if="scope.userId" closable @close="clearScope('userId')">仅用户 #{{ scope.userId }}</el-tag>
        <el-tag v-if="scope.distributorId" closable @close="clearScope('distributorId')">仅分销商 #{{ scope.distributorId }} 名下用户</el-tag>
      </section>

      <section class="cards">
        <div v-for="card in cards" :key="card.label" class="lm-card card">
          <span>{{ card.label }}</span>
          <b class="lm-money">{{ card.value }}</b>
          <small>{{ card.hint }}</small>
        </div>
      </section>

      <ResponsiveTable v-loading="loading" :data="list" class="lm-card table" :row-class-name="billRowClass" empty-text="没有符合条件的账单">
        <el-table-column class-name="mobile-wide" label="时间" width="150"><template #default="{ row }">{{ dateTime(row.createdAt) }}</template></el-table-column>
        <el-table-column class-name="mobile-wide mobile-heading" label="用户" min-width="160">
          <template #default="{ row }">
            <b>{{ row.nickname || row.loginName }}</b>
            <small class="sub">{{ row.loginName }}</small>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="100"><template #default="{ row }">{{ KIND_LABEL[row.kind] }}</template></el-table-column>
        <el-table-column prop="modelName" label="模型" min-width="180" show-overflow-tooltip />
        <el-table-column label="实付（元）" width="110" align="right"><template #default="{ row }"><span class="lm-money">{{ money(row.chargeCents) }}</span></template></el-table-column>
        <el-table-column label="成本（元）" width="110" align="right"><template #default="{ row }"><span class="lm-money">{{ money(row.upstreamCents) }}</span></template></el-table-column>
        <el-table-column label="利润（元）" width="110" align="right"><template #default="{ row }"><b class="lm-money profit">{{ money(row.profitCents) }}</b></template></el-table-column>
        <el-table-column label="分销佣金（元）" width="130" align="right"><template #default="{ row }"><span class="lm-money">{{ row.commissionCents ? money(row.commissionCents) : '—' }}</span></template></el-table-column>
        <el-table-column class-name="mobile-wide" label="状态" width="90">
          <template #default="{ row }"><el-tag v-if="row.refunded" type="info" effect="light" round>已退款</el-tag><span v-else>已扣费</span></template>
        </el-table-column>
      </ResponsiveTable>

      <el-pagination
        v-if="total > pageSize"
        class="pager"
        :pager-count="5"
        background
        layout="prev, pager, next"
        :total="total"
        :page-size="pageSize"
        :current-page="page"
        @current-change="(p: number) => { page = p; load() }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import ResponsiveTable from '@/components/ResponsiveTable.vue'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getBills, type BillRow } from '@/api/admin'
import type { BillTotals } from '@/types'
import { dateTime, KIND_LABEL, marginRate, yuan } from '@/utils/format'

const route = useRoute()
const pageSize = 20

const list = ref<BillRow[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const summary = ref<BillTotals | null>(null)
const dates = ref<[string, string] | null>(null)
const dateFrom = ref('')
const dateTo = ref('')
const narrowScreen = window.matchMedia('(max-width: 860px)')
const compact = ref(narrowScreen.matches)
function updateLayout(event: MediaQueryListEvent) {
  compact.value = event.matches
}
watch(dates, (range) => {
  dateFrom.value = range?.[0] ?? ''
  dateTo.value = range?.[1] ?? ''
})
const kind = ref<BillRow['kind']>()

/** 从用户管理、分销商页跳过来时带的范围，可以点标签上的 × 取消 */
const scope = reactive<{ userId?: number; distributorId?: number }>({
  userId: Number(route.query.userId) || undefined,
  distributorId: Number(route.query.distributorId) || undefined,
})

/** 账单金额常有零头（文本模型一次只有几厘），多留一位小数才对得上汇总 */
const money = (cents: number) => (cents / 100).toFixed(3)
const billRowClass = ({ row }: { row: BillRow }) => row.refunded ? 'is-refunded' : ''

const cards = computed(() => {
  const s = summary.value
  return [
    { label: '有效调用', value: s?.calls ?? '—', hint: '不含已退款' },
    { label: '用户实付（元）', value: yuan(s?.chargeCents), hint: '用户实际花掉的钱' },
    { label: '上游成本（元）', value: yuan(s?.upstreamCents), hint: '平台向 Atlas 支付的钱' },
    { label: '利润（元）', value: yuan(s?.profitCents), hint: s ? `利润率 ${marginRate(s.profitCents, s.chargeCents)}` : '' },
    { label: '分销佣金（元）', value: yuan(s?.commissionCents), hint: '应付给分销商，已含在利润里' },
  ]
})

async function load() {
  loading.value = true
  try {
    const [from, to] = dates.value ?? []
    const data = await getBills({ page: page.value, pageSize, kind: kind.value, from, to, ...scope })
    list.value = data.list
    total.value = data.total
    summary.value = data.summary
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  void load()
}

function applyDates() {
  if (!dateFrom.value || !dateTo.value || dateFrom.value > dateTo.value) return
  dates.value = [dateFrom.value, dateTo.value]
  reload()
}

function clearDates() {
  dates.value = null
  reload()
}

function clearScope(key: 'userId' | 'distributorId') {
  scope[key] = undefined
  reload()
}

onMounted(() => {
  narrowScreen.addEventListener('change', updateLayout)
  void load()
})
onBeforeUnmount(() => narrowScreen.removeEventListener('change', updateLayout))
</script>

<style scoped>
.wrap { padding-top: 28px; padding-bottom: 48px; max-width: 1240px; }
.head { margin-bottom: 18px; }
.head h1 { font-size: 24px; font-weight: 800; }
.head p { margin-top: 4px; font-size: 13px; color: var(--color-text-tertiary); }

.filters { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 14px 18px; margin-bottom: 16px; }
.kind { width: 140px; }

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 16px; }
.card { display: grid; gap: 4px; padding: 18px 20px; }
.card span { font-size: 13px; color: var(--color-text-secondary); }
.card b { font-size: 26px; line-height: 1.2; color: var(--color-primary-dark); }
.card small { font-size: 12px; color: var(--color-text-tertiary); }

.table { overflow: hidden; }
.table :deep(.is-refunded) { color: var(--color-text-tertiary); text-decoration: line-through; }
.sub { margin-left: 8px; font-size: 12px; color: var(--color-text-tertiary); }
.profit { color: var(--color-accent); }
.pager { margin-top: 16px; justify-content: flex-end; }
@media (max-width: 860px) {
  .filters { display: grid; grid-template-columns: minmax(0, 1fr); padding: 14px; }
  .date-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .date-fields label { display: grid; min-width: 0; gap: 4px; font-size: 12px; color: var(--color-text-secondary); }
  .date-fields input {
    display: block; width: 100%; min-width: 0; height: 40px; padding-inline: 6px; border: 1px solid var(--color-border);
    border-radius: var(--radius-sm); background: var(--color-card); color: var(--color-text-primary); font: inherit; font-size: 16px;
  }
  .date-actions { display: flex; grid-column: 1 / -1; gap: 8px; }
  .date-actions .el-button { flex: 1; min-height: 42px; margin: 0; }
  .kind { width: 100%; }
  .kind :deep(.el-select__wrapper) { min-height: 40px; }
  .filters .el-tag { justify-self: start; max-width: 100%; }
}
</style>
