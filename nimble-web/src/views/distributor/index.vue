<template>
  <div class="lm-page account-page account-dashboard">
    <div class="lm-container wrap">
      <header class="head">
        <div>
          <h1>分销后台</h1>
          <p>
            通过你的专属链接登录的用户，以及他们再邀请来的所有人，都归在你名下。
            <template v-if="overview?.canAppoint">你可以把直属用户再设为分销商，从你的佣金比例里分一部分给他。</template>
          </p>
        </div>
        <el-radio-group v-model="range" size="small" class="account-range" aria-label="统计时间范围" @change="loadOverview">
          <el-radio-button v-for="item in RANGES" :key="item.value" :value="item.value">{{ item.label }}</el-radio-button>
        </el-radio-group>
      </header>

      <section class="lm-card share">
        <label>你的专属推广链接</label>
        <div class="link">
          <el-input :model-value="link" readonly />
          <el-button type="primary" :disabled="!overview" @click="copy(link, '推广链接已复制')">复制链接</el-button>
        </div>
        <p class="hint">用户第一次通过链接打开时归属就确定了。通过你的链接来的人归你名下，只结算佣金，不发邀请现金；他们再邀请来的人同样归你。</p>
      </section>

      <section v-loading="loading" class="cards">
        <div v-for="card in cards" :key="card.label" class="lm-card card">
          <span>{{ card.label }}</span>
          <b class="lm-money">{{ card.value }}</b>
          <small>{{ card.hint }}</small>
        </div>
      </section>

      <section class="lm-card panel">
        <el-tabs v-model="tab" class="dashboard-tabs">
          <el-tab-pane label="名下用户" name="users">
            <ResponsiveTable v-loading="membersLoading" :data="members?.list ?? []" empty-text="还没有用户，把推广链接分享出去吧">
              <el-table-column class-name="mobile-wide mobile-heading" label="用户" min-width="170">
                <template #default="{ row }">
                  <b>{{ row.nickname || row.loginName }}</b>
                  <small class="sub">{{ row.loginName }}</small>
                  <el-tag v-if="overview?.canAppoint && row.badge" size="small" :type="row.badge === '分销商' ? 'warning' : 'info'" effect="light" class="tag">{{ row.badge }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column v-if="overview?.canAppoint" label="归属" width="140" show-overflow-tooltip>
                <template #default="{ row }">{{ row.ownerName || '直属' }}</template>
              </el-table-column>
              <el-table-column label="来源" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.direct ? 'success' : 'info'" effect="light" round>{{ row.direct ? '直接邀请' : '下线邀请' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="加入时间" width="150"><template #default="{ row }">{{ dateTime(row.createdAt) }}</template></el-table-column>
              <el-table-column label="最近登录" width="150"><template #default="{ row }">{{ dateTime(row.lastLoginAt) }}</template></el-table-column>
              <el-table-column prop="calls" label="调用次数" width="90" align="right" />
              <el-table-column label="消费（元）" width="110" align="right"><template #default="{ row }"><span class="lm-money">{{ yuan(row.chargeCents) }}</span></template></el-table-column>
              <el-table-column label="成本（元）" width="110" align="right"><template #default="{ row }"><span class="lm-money">{{ yuan(row.upstreamCents) }}</span></template></el-table-column>
              <el-table-column label="利润（元）" width="110" align="right"><template #default="{ row }"><b class="lm-money profit">{{ yuan(row.profitCents) }}</b></template></el-table-column>
              <el-table-column v-if="overview?.canAppoint" class-name="mobile-wide mobile-actions" label="操作" width="110" fixed="right">
                <template #default="{ row }">
                  <el-button v-if="row.appointable" link type="primary" @click="appoint(row as DistributorMember)">设为分销商</el-button>
                </template>
              </el-table-column>
            </ResponsiveTable>
            <el-pagination
              v-if="(members?.total ?? 0) > pageSize"
              class="pager"
              :pager-count="5"
              background
              layout="prev, pager, next"
              :total="members?.total"
              :page-size="pageSize"
              :current-page="page"
              @current-change="(p: number) => { page = p; loadMembers() }"
            />
            <p class="hint">
              用户列表是累计数据，不受右上角时间范围影响；只统计扣费成功且没有退款的调用。佣金按每笔扣费当时的比例累计，之后调整比例不影响已产生的佣金。
              <template v-if="overview?.canAppoint">直属用户可以设为分销商，只影响他之后带来的新用户。</template>
            </p>
          </el-tab-pane>

          <el-tab-pane v-if="overview?.canAppoint" label="下级分销" name="subs">
            <ResponsiveTable v-loading="subsLoading" :data="subs" empty-text="还没有下级。在「名下用户」里把直属用户设为分销商">
              <el-table-column class-name="mobile-wide mobile-heading" label="分销商" min-width="160">
                <template #default="{ row }">
                  <b>{{ row.nickname || row.loginName }}</b>
                  <small class="sub">{{ row.loginName }}</small>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="90">
                <template #default="{ row }">
                  <el-tag :type="row.isDistributor ? 'success' : 'info'" effect="light" round>{{ row.isDistributor ? '分销中' : '已取消' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="比例" width="80" align="right"><template #default="{ row }">{{ row.commissionPercent }}%</template></el-table-column>
              <el-table-column prop="members" label="名下用户" width="90" align="right" />
              <el-table-column label="用户消费（元）" width="120" align="right"><template #default="{ row }"><span class="lm-money">{{ yuan(row.chargeCents) }}</span></template></el-table-column>
              <el-table-column label="利润（元）" width="110" align="right"><template #default="{ row }"><b class="lm-money profit">{{ yuan(row.profitCents) }}</b></template></el-table-column>
              <el-table-column label="对方佣金（元）" width="120" align="right"><template #default="{ row }"><span class="lm-money">{{ yuan(row.commissionCents) }}</span></template></el-table-column>
              <el-table-column class-name="mobile-wide" label="我的佣金（元）" width="120" align="right"><template #default="{ row }"><b class="lm-money">{{ yuan(row.myCommissionCents) }}</b></template></el-table-column>
              <el-table-column class-name="mobile-wide mobile-actions" label="操作" width="150" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="editSub(row as SubDistributor)">调整比例</el-button>
                  <el-button v-if="row.isDistributor" link type="danger" @click="cancelSub(row as SubDistributor)">取消</el-button>
                  <el-button v-else link type="primary" @click="restoreSub(row as SubDistributor)">恢复</el-button>
                </template>
              </el-table-column>
            </ResponsiveTable>
            <p class="hint">比例从你当前的佣金比例里分出，不能超过它。他名下用户的佣金按他的比例给他，剩下的归你。取消后他不再分成，新产生的部分按你的比例归你；已经归他的用户不会改归属。</p>
          </el-tab-pane>

          <el-tab-pane label="模型明细" name="models">
            <ResponsiveTable :data="overview?.models ?? []" empty-text="这个时间段还没有消费记录">
              <el-table-column class-name="mobile-wide mobile-heading" prop="modelName" label="模型" min-width="200" show-overflow-tooltip />
              <el-table-column label="类型" width="110"><template #default="{ row }">{{ KIND_LABEL[row.kind] }}</template></el-table-column>
              <el-table-column prop="calls" label="调用次数" width="100" align="right" />
              <el-table-column prop="users" label="使用人数" width="100" align="right" />
              <el-table-column label="消费（元）" width="110" align="right"><template #default="{ row }"><span class="lm-money">{{ yuan(row.chargeCents) }}</span></template></el-table-column>
              <el-table-column label="成本（元）" width="110" align="right"><template #default="{ row }"><span class="lm-money">{{ yuan(row.upstreamCents) }}</span></template></el-table-column>
              <el-table-column label="利润（元）" width="110" align="right"><template #default="{ row }"><b class="lm-money profit">{{ yuan(row.profitCents) }}</b></template></el-table-column>
            </ResponsiveTable>
            <p class="hint">按消费从高到低，最多显示 20 个模型。</p>
          </el-tab-pane>

          <el-tab-pane label="模型定价" name="pricing">
            <PriceTable show-cost :rows="pricing" :loading="pricingLoading" />
            <p class="hint">成本价是平台向上游支付的价格，灵米价是用户实际支付的价格，两者之差就是利润。价格来自最近一次询价，加价调整后会立刻反映到灵米价。</p>
          </el-tab-pane>
        </el-tabs>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import ResponsiveTable from '@/components/ResponsiveTable.vue'
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PriceTable from '@/components/PriceTable.vue'
import type { UsageRange } from '@/api/admin'
import {
  appointSubDistributor,
  getDistributorMembers,
  getDistributorOverview,
  getDistributorPricing,
  getSubDistributors,
  updateSubDistributor,
  type DistributorMember,
  type DistributorOverview,
  type SubDistributor,
} from '@/api/distributor'
import type { CostPriceRow, PageResult } from '@/types'
import { askCommissionPercent } from '@/utils/commission'
import { copyText as copy } from '@/utils/clipboard'
import { dateTime, KIND_LABEL, marginRate, yuan } from '@/utils/format'

const RANGES: Array<{ value: UsageRange; label: string }> = [
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'all', label: '全部' },
]
const pageSize = 20

const range = ref<UsageRange>('30d')
const tab = ref('users')
const overview = ref<DistributorOverview | null>(null)
const loading = ref(false)
const members = ref<PageResult<DistributorMember> | null>(null)
const membersLoading = ref(false)
const page = ref(1)
const pricing = ref<CostPriceRow[]>([])
const pricingLoading = ref(false)
const subs = ref<SubDistributor[]>([])
const subsLoading = ref(false)

const link = computed(() => (overview.value ? `${location.origin}/login?ref=${overview.value.code}` : '加载中…'))

const cards = computed(() => {
  const o = overview.value
  if (!o) return []
  const u = o.usage
  return [
    { label: '名下用户', value: o.team.total, hint: `直接邀请 ${o.team.direct} · 今日新增 ${o.team.today}` },
    { label: '用户消费（元）', value: yuan(u.chargeCents), hint: `${u.calls} 次调用` },
    { label: '上游成本（元）', value: yuan(u.upstreamCents), hint: '平台向上游支付的价格' },
    { label: '利润（元）', value: yuan(u.profitCents), hint: `利润率 ${marginRate(u.profitCents, u.chargeCents)}` },
    {
      label: '应得佣金（元）',
      value: yuan(u.commissionCents),
      hint: o.canAppoint ? `当前比例 ${o.commissionPercent}%，已扣除分给下级的部分，线下结算` : `当前比例 ${o.commissionPercent}%，线下结算`,
    },
  ]
})

async function loadOverview() {
  loading.value = true
  try {
    overview.value = await getDistributorOverview(range.value)
    if (overview.value.canAppoint) void loadSubs()
  } finally {
    loading.value = false
  }
}

async function loadMembers() {
  membersLoading.value = true
  try {
    members.value = await getDistributorMembers(page.value, pageSize)
  } finally {
    membersLoading.value = false
  }
}

const personName = (row: { nickname: string | null; loginName: string | null; id: number }) => row.nickname || row.loginName || `#${row.id}`

async function loadSubs() {
  if (!overview.value?.canAppoint) return
  subsLoading.value = true
  try {
    subs.value = await getSubDistributors()
  } finally {
    subsLoading.value = false
  }
}

async function appoint(row: DistributorMember) {
  const cap = overview.value?.commissionPercent ?? 0
  const percent = await askCommissionPercent(
    personName(row),
    0,
    cap,
    `从你当前 ${cap}% 的比例里分给他。他之后带来的用户，佣金按这个比例给他，剩下的归你。`,
  )
  if (percent === undefined) return
  await appointSubDistributor(row.id, percent)
  ElMessage.success('已设为分销商，他用自己的推广链接带来的新用户归他名下')
  await Promise.all([loadMembers(), loadSubs()])
}

async function editSub(row: SubDistributor) {
  const cap = overview.value?.commissionPercent ?? 0
  const percent = await askCommissionPercent(personName(row), row.commissionPercent, cap, '只对之后产生的账单生效，不能超过你当前的比例。')
  if (percent === undefined) return
  await updateSubDistributor(row.id, { commissionPercent: percent })
  ElMessage.success('已保存')
  await loadSubs()
}

async function cancelSub(row: SubDistributor) {
  const confirmed = await ElMessageBox.confirm(
    `确定取消「${personName(row)}」的分销资格？他将不能进入分销后台，不再产生新的佣金。已归他的用户不变，之后这条线的新用户改归你。`,
    '取消分销商',
    { type: 'warning' },
  ).catch(() => undefined)
  if (!confirmed) return
  await updateSubDistributor(row.id, { isDistributor: false })
  ElMessage.success('已取消')
  await Promise.all([loadMembers(), loadSubs()])
}

async function restoreSub(row: SubDistributor) {
  await updateSubDistributor(row.id, { isDistributor: true })
  ElMessage.success('已恢复')
  await Promise.all([loadMembers(), loadSubs()])
}

async function loadPricing() {
  pricingLoading.value = true
  try {
    pricing.value = (await getDistributorPricing()).rows
  } finally {
    pricingLoading.value = false
  }
}

onMounted(() => {
  void loadOverview()
  void loadMembers()
  void loadPricing()
})
</script>

<style scoped>
.wrap { padding-top: 28px; padding-bottom: 48px; max-width: 1280px; }
.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 18px; }
.head h1 { font-size: 24px; font-weight: 800; }
.head p { margin-top: 4px; font-size: 13px; color: var(--color-text-tertiary); }

.share { padding: 20px 24px; margin-bottom: 16px; }
.share label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 600; color: var(--color-text-secondary); }
.link { display: flex; gap: 8px; }

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 16px; }
.card { display: grid; gap: 4px; padding: 18px 20px; }
.card span { font-size: 13px; color: var(--color-text-secondary); }
.card b { font-size: 26px; line-height: 1.2; color: var(--color-primary-dark); }
.card small { font-size: 12px; color: var(--color-text-tertiary); }

.panel { padding: 8px 24px 22px; }
.sub { margin-left: 8px; font-size: 12px; color: var(--color-text-tertiary); }
.tag { margin-left: 6px; }
.profit { color: var(--color-accent); }
.pager { margin-top: 16px; justify-content: flex-end; }
.hint { margin-top: 12px; font-size: 12px; color: var(--color-text-tertiary); }
@media (max-width: 860px) {
  .share { padding: 14px; margin-bottom: 14px; }
  .link { display: grid; grid-template-columns: minmax(0, 1fr); }
  .link .el-input { min-width: 0; }
  .link .el-button { min-height: 42px; }
  .panel { min-width: 0; padding: 8px 12px 12px; }
  .dashboard-tabs :deep(.el-tabs__nav) { display: flex; width: 100%; }
  .dashboard-tabs :deep(.el-tabs__item) {
    flex: 1; min-width: 0; padding-inline: 2px; text-align: center; font-size: clamp(12px, 3.4vw, 14px);
  }
  .dashboard-tabs :deep(.el-tabs__header) { margin-bottom: 10px; }
}
</style>
