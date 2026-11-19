<template>
  <div>
    <ResponsiveTable v-loading="loading" :data="items" empty-text="还没有收支记录">
      <el-table-column label="时间" width="170">
        <template #default="{ row }">{{ dateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="类型" width="120">
        <template #default="{ row }">
          <el-tag :type="LEDGER_TYPES[row.type]?.tag ?? 'info'" effect="light" round>{{ LEDGER_TYPES[row.type]?.label ?? row.type }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column class-name="mobile-wide" prop="remark" label="说明" min-width="200" show-overflow-tooltip />
      <el-table-column label="金额" width="120" align="right">
        <template #default="{ row }">
          <b class="lm-money" :class="row.amountCents > 0 ? 'in' : 'out'">
            {{ row.amountCents > 0 ? '+' : '-' }}{{ yuan(Math.abs(row.amountCents)) }}
          </b>
        </template>
      </el-table-column>
      <el-table-column label="余额" width="110" align="right">
        <template #default="{ row }"><span class="lm-money muted">{{ yuan(row.balanceAfter) }}</span></template>
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
      @current-change="(p: number) => { page = p; reload() }"
    />
  </div>
</template>

<script setup lang="ts">
import ResponsiveTable from '@/components/ResponsiveTable.vue'
import { onMounted, ref } from 'vue'
import type { LedgerItem, Paged } from '@/types'
import { dateTime, yuan } from '@/utils/format'
import { LEDGER_TYPES } from '@/utils/ledger'

const props = withDefaults(
  defineProps<{
    /** 取一页流水，用户自己的钱包和管理员看某个用户走不同接口，由调用方决定 */
    fetchPage: (page: number, pageSize: number) => Promise<Paged<LedgerItem>>
    pageSize?: number
  }>(),
  { pageSize: 20 },
)

const items = ref<LedgerItem[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)

async function reload() {
  loading.value = true
  try {
    const data = await props.fetchPage(page.value, props.pageSize)
    items.value = data.items
    total.value = data.total
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}

onMounted(reload)
defineExpose({ reload, loading })
</script>

<style scoped>
.in { color: var(--color-primary); }
.out { color: var(--color-text-primary); }
.muted { color: var(--color-text-tertiary); }
.pager { margin-top: 18px; justify-content: flex-end; }
</style>
