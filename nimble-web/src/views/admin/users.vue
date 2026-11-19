<template>
  <div class="lm-page account-page account-dashboard">
    <div class="lm-container wrap">
      <header class="head">
        <div>
          <h1>用户管理</h1>
          <p>查看账号状态、余额和收支流水。余额与流水来自支付服务，加款、扣款请到 nimblePay 后台操作。</p>
        </div>
        <el-input v-model="keyword" clearable placeholder="搜索账号或昵称" class="search" @change="reload" />
      </header>

      <ResponsiveTable v-loading="loading" :data="list" class="lm-card table">
        <el-table-column class-name="mobile-wide mobile-heading" prop="loginName" label="账号" min-width="150" />
        <el-table-column prop="nickname" label="昵称" min-width="120" show-overflow-tooltip />
        <el-table-column label="身份" width="210">
          <template #default="{ row }">
            {{ row.isSuperAdmin ? '默认管理员' : row.isAdmin ? '管理员' : '用户' }}
            <el-tag v-if="row.distributorLevel === 1" size="small" :type="row.isDistributor ? 'warning' : 'info'" effect="light" class="tag">
              {{ row.isDistributor ? '一级分销' : '一级已取消' }}
            </el-tag>
            <el-tag v-else-if="row.distributorLevel === 2" size="small" :type="row.isDistributor ? 'warning' : 'info'" effect="light" class="tag">
              {{ row.isDistributor ? '二级分销' : '二级已取消' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="余额（元）" width="120" align="right">
          <template #default="{ row }"><b class="lm-money">{{ yuan(row.wallet?.balanceCents) }}</b></template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'" effect="light" round>{{ row.status === 1 ? '启用' : '禁用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最近登录" width="150"><template #default="{ row }">{{ dateTime(row.lastLoginAt) }}</template></el-table-column>
        <el-table-column label="加入时间" width="150"><template #default="{ row }">{{ dateTime(row.createdAt) }}</template></el-table-column>
        <el-table-column class-name="mobile-wide mobile-actions" label="操作" width="360" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openOverview(row.id)">详情</el-button>
            <el-button link type="primary" @click="router.push({ path: '/admin/bills', query: { userId: row.id } })">账单</el-button>
            <el-button v-if="authStore.isSuperAdmin && row.distributorLevel === 0" link type="primary" @click="appointDistributor(row as AdminUser)">
              设为一级分销
            </el-button>
            <el-button v-if="authStore.isSuperAdmin && !row.isSuperAdmin" link type="primary" @click="toggleAdmin(row as AdminUser)">
              {{ row.isAdmin ? '取消管理员' : '设为管理员' }}
            </el-button>
            <el-button v-if="!row.isAdmin" link :type="row.status === 1 ? 'danger' : 'primary'" @click="toggle(row as AdminUser)">
              {{ row.status === 1 ? '禁用' : '启用' }}
            </el-button>
          </template>
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

    <el-drawer v-model="drawer" title="用户详情" size="min(820px, 100%)" class="account-user-drawer" destroy-on-close append-to-body>
      <template v-if="overview">
        <p class="who">
          {{ overview.user.nickname || overview.user.loginName }}
          <small>{{ overview.user.loginName }}</small>
          <el-tag v-if="overview.user.distributorLevel === 1" size="small" :type="overview.user.isDistributor ? 'warning' : 'info'" effect="light" class="tag">
            {{ overview.user.isDistributor ? '一级分销' : '一级已取消' }}
          </el-tag>
          <el-tag v-else-if="overview.user.distributorLevel === 2" size="small" :type="overview.user.isDistributor ? 'warning' : 'info'" effect="light" class="tag">
            {{ overview.user.isDistributor ? '二级分销' : '二级已取消' }}
          </el-tag>
        </p>

        <div class="stats">
          <div class="stat"><span>当前余额</span><b class="lm-money">{{ yuan(overview.wallet?.balanceCents) }}</b></div>
          <div class="stat"><span>累计充值</span><b class="lm-money">{{ yuan(overview.wallet?.rechargeCents) }}</b></div>
          <div class="stat"><span>累计消费</span><b class="lm-money">{{ yuan(overview.wallet?.consumeCents) }}</b></div>
        </div>

        <ul class="counts">
          <li>视频制作 <b>{{ overview.counts.videos }}</b></li>
          <li>一键成片 <b>{{ overview.counts.shortVideos }}</b></li>
        </ul>

        <h3>收支流水</h3>
        <LedgerTable v-if="overview.wallet" :key="overview.user.id" :fetch-page="fetchLedgers" />
        <p v-else class="muted">支付服务暂不可用，稍后再试</p>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import ResponsiveTable from '@/components/ResponsiveTable.vue'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import LedgerTable from '@/components/LedgerTable.vue'
import {
  getAccountLedgers,
  getAccountOverview,
  getAccounts,
  setAccountAdmin,
  setAccountDistributor,
  setAccountStatus,
  type AccountOverview,
  type AdminUser,
} from '@/api/admin'
import { useAuthStore } from '@/stores/auth'
import { askCommissionPercent } from '@/utils/commission'
import { dateTime, yuan } from '@/utils/format'

const router = useRouter()
const authStore = useAuthStore()

const list = ref<AdminUser[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const keyword = ref('')
const loading = ref(false)
const drawer = ref(false)
const overview = ref<AccountOverview | null>(null)

async function load() {
  loading.value = true
  try {
    const data = await getAccounts({ page: page.value, pageSize, keyword: keyword.value || undefined })
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  load()
}

async function toggle(row: AdminUser) {
  const next = row.status === 1 ? 0 : 1
  await setAccountStatus(row.id, next)
  ElMessage.success(next === 1 ? '已启用' : '已禁用，对方已被下线')
  await load()
}

async function toggleAdmin(row: AdminUser) {
  const next = !row.isAdmin
  const name = row.nickname || row.loginName
  const confirmed = await ElMessageBox.confirm(
    next
      ? `确定把「${name}」设为管理员？除了指定管理员，他将拥有和你一样的后台权限，并需要重新登录。`
      : `确定取消「${name}」的管理员身份？他将被下线，重新登录后恢复为普通用户。`,
    next ? '设为管理员' : '取消管理员',
    { type: 'warning' },
  ).catch(() => undefined)
  if (!confirmed) return
  await setAccountAdmin(row.id, next)
  ElMessage.success(next ? '已设为管理员' : '已取消管理员')
  await load()
}

/** 任命后对方不用重新登录，刷新页面即可看到分销后台入口。只影响之后注册的用户 */
async function appointDistributor(row: AdminUser) {
  const name = row.nickname || row.loginName || `#${row.id}`
  const percent = await askCommissionPercent(name, row.commissionPercent)
  if (percent === undefined) return
  await setAccountDistributor(row.id, true, percent)
  ElMessage.success('已设为一级分销商。之后通过他的链接来的用户归他名下，他可以再指定下级并分配比例')
  await load()
}

async function openOverview(id: number) {
  overview.value = await getAccountOverview(id)
  drawer.value = true
}

const fetchLedgers = (p: number, size: number) => getAccountLedgers(overview.value!.user.id, p, size)

onMounted(load)
</script>

<style scoped>
.wrap { padding-top: 28px; padding-bottom: 48px; max-width: 1200px; }
.head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-end; margin-bottom: 18px; }
.head h1 { font-size: 24px; font-weight: 800; }
.head p { margin-top: 4px; font-size: 13px; color: var(--color-text-tertiary); }
.search { width: 240px; }
.table { overflow: hidden; }
.pager { margin-top: 16px; justify-content: flex-end; }
.who { margin-bottom: 14px; font-size: 16px; font-weight: 700; }
.who small { margin-left: 8px; font-size: 12px; font-weight: 400; color: var(--color-text-tertiary); }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 10px; }
.stat { display: grid; gap: 4px; padding: 14px 16px; border-radius: var(--radius-md); background: var(--color-primary-soft); }
.stat span { font-size: 12px; color: var(--color-text-secondary); }
.stat b { font-size: 22px; color: var(--color-primary-dark); }
.counts { list-style: none; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 22px; }
.counts li { display: flex; justify-content: space-between; padding: 10px 14px; border-radius: var(--radius-sm); background: var(--color-bg-secondary); font-size: 13px; }
.tag { margin-left: 6px; }
h3 { margin-bottom: 8px; font-size: 15px; font-weight: 800; }
.muted { color: var(--color-text-tertiary); }
@media (max-width: 860px) {
  .search { width: 100%; }
  .who { overflow-wrap: anywhere; }
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .stat { min-width: 0; padding: 10px; text-align: center; }
  .stat:first-child { grid-column: 1 / -1; padding: 14px; }
  .stat:first-child b { font-size: 22px; }
  .stat b { font-size: 17px; overflow-wrap: anywhere; }
  .counts { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .counts li { padding-inline: 8px; }
}
</style>

<style>
@media (max-width: 860px) {
  .account-user-drawer .el-drawer__header { padding: 12px; margin-bottom: 0; }
  .account-user-drawer .el-drawer__body { padding: 8px 12px max(12px, env(safe-area-inset-bottom)); }
  .account-user-drawer .el-pagination { justify-content: center; }
}
</style>
