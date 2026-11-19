<template>
  <div class="lm-page account-page account-dashboard">
    <div class="lm-container wrap">
      <header class="head">
        <div>
          <h1>分销商</h1>
          <p>
            一级由用户管理任命。一级可以自己指定下级，比例从一级的比例里分出。佣金线下结算，扣费当时按比例拆开，之后调整不影响历史。
            一级这一行的消费含其下级名下用户，和下级那一行会有重叠；佣金不重叠。取消一级时，下级一并停用，恢复一级不会自动恢复下级。
          </p>
        </div>
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      </header>

      <ResponsiveTable v-loading="loading" :data="list" class="lm-card table" empty-text="还没有分销商，到用户管理里任命一个吧">
        <el-table-column class-name="mobile-wide mobile-heading" label="分销商" min-width="180">
          <template #default="{ row }">
            <b>{{ row.nickname || row.loginName }}</b>
            <small class="sub">{{ row.loginName }}</small>
          </template>
        </el-table-column>
        <el-table-column label="级别" width="80">
          <template #default="{ row }">{{ row.level === 2 ? '二级' : '一级' }}</template>
        </el-table-column>
        <el-table-column label="上级" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.parentName || '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.isDistributor ? 'success' : 'info'" effect="light" round>{{ row.isDistributor ? '分销中' : '已取消' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="当前比例" width="100" align="right"><template #default="{ row }">{{ row.commissionPercent }}%</template></el-table-column>
        <el-table-column prop="members" label="名下用户" width="100" align="right" />
        <el-table-column prop="calls" label="调用次数" width="100" align="right" />
        <el-table-column label="用户消费（元）" width="130" align="right"><template #default="{ row }"><span class="lm-money">{{ yuan(row.chargeCents) }}</span></template></el-table-column>
        <el-table-column label="上游成本（元）" width="130" align="right"><template #default="{ row }"><span class="lm-money">{{ yuan(row.upstreamCents) }}</span></template></el-table-column>
        <el-table-column label="利润（元）" width="120" align="right"><template #default="{ row }"><b class="lm-money profit">{{ yuan(row.profitCents) }}</b></template></el-table-column>
        <el-table-column label="应得佣金（元）" width="130" align="right"><template #default="{ row }"><b class="lm-money">{{ yuan(row.commissionCents) }}</b></template></el-table-column>
        <el-table-column class-name="mobile-wide mobile-actions" label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="router.push({ path: '/admin/bills', query: { distributorId: row.id } })">账单</el-button>
            <template v-if="authStore.isSuperAdmin">
              <el-button link type="primary" @click="editRate(row as DistributorRow)">调整比例</el-button>
              <el-button v-if="row.isDistributor" link type="danger" @click="cancel(row as DistributorRow)">取消分销商</el-button>
              <el-button v-else link type="primary" @click="restore(row as DistributorRow)">恢复</el-button>
            </template>
          </template>
        </el-table-column>
      </ResponsiveTable>
    </div>
  </div>
</template>

<script setup lang="ts">
import ResponsiveTable from '@/components/ResponsiveTable.vue'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { getDistributors, setAccountDistributor, type DistributorRow } from '@/api/admin'
import { useAuthStore } from '@/stores/auth'
import { askCommissionPercent } from '@/utils/commission'
import { yuan } from '@/utils/format'

const router = useRouter()
const authStore = useAuthStore()
const list = ref<DistributorRow[]>([])
const loading = ref(false)

const nameOf = (row: DistributorRow) => row.nickname || row.loginName || `#${row.id}`

async function load() {
  loading.value = true
  try {
    list.value = await getDistributors()
  } finally {
    loading.value = false
  }
}

async function editRate(row: DistributorRow) {
  const percent = await askCommissionPercent(nameOf(row), row.commissionPercent, row.rateCap)
  if (percent === undefined) return
  await setAccountDistributor(row.id, row.isDistributor, percent)
  ElMessage.success('已保存')
  await load()
}

async function cancel(row: DistributorRow) {
  const text = row.level === 1
    ? `确定取消「${nameOf(row)}」的一级分销？他和下级都将无法进入分销后台，不再产生新的佣金。已有用户、业绩和已产生的佣金保留。之后恢复一级时，下级需要单独恢复。`
    : `确定取消「${nameOf(row)}」的分销资格？他将无法进入分销后台，不再产生新的佣金；之后他这条线的新用户改归上级。已有用户和已产生的佣金保留。`
  const confirmed = await ElMessageBox.confirm(text, '取消分销商', { type: 'warning' }).catch(() => undefined)
  if (!confirmed) return
  await setAccountDistributor(row.id, false)
  ElMessage.success('已取消')
  await load()
}

async function restore(row: DistributorRow) {
  await setAccountDistributor(row.id, true)
  ElMessage.success('已恢复分销商身份')
  await load()
}

onMounted(load)
</script>

<style scoped>
.wrap { padding-top: 28px; padding-bottom: 48px; max-width: 1280px; }
.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 18px; }
.head h1 { font-size: 24px; font-weight: 800; }
.head p { margin-top: 4px; font-size: 13px; line-height: 1.7; color: var(--color-text-tertiary); }
.table { overflow: hidden; }
.sub { margin-left: 8px; font-size: 12px; color: var(--color-text-tertiary); }
.profit { color: var(--color-accent); }
</style>
