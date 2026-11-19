<template>
  <div>
    <div class="page-head"><div><h1>工作台</h1><p>今日充值与待处理</p></div></div>
    <div class="cards">
      <div class="panel" v-for="c in cards" :key="c.label"><div class="card-k">{{ c.label }}</div><div class="card-v">{{ c.value }}</div></div>
    </div>
    <div class="panel">
      <h2 class="section-title">最近订单</h2>
      <el-table :data="stats?.recent || []">
        <el-table-column prop="orderNo" label="订单号" min-width="180" />
        <el-table-column label="用户" min-width="140"><template #default="{ row }">{{ row.user?.nickname || row.user?.email || row.user?.externalUserId }}</template></el-table-column>
        <el-table-column label="金额（元）"><template #default="{ row }"><span class="money">{{ yuan(row.amountCents) }}</span></template></el-table-column>
        <el-table-column prop="status" label="状态" width="110" />
        <el-table-column label="时间" width="160"><template #default="{ row }">{{ time(row.createdAt) }}</template></el-table-column>
      </el-table>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { dashboard } from '@/api';
import { time, yuan } from '@/utils/format';
const stats = ref<any>(null);
const cards = computed(() => [
  { label: '钱包用户', value: stats.value?.walletTotal ?? '—' },
  { label: '余额合计（元）', value: yuan(stats.value?.balanceCents) },
  { label: '今日实收（元）', value: yuan(stats.value?.todayPaidCents) },
  { label: '支付中 / 昨日差异', value: `${stats.value?.paying ?? 0} / ${stats.value?.reconOpenDiffs ?? 0}` },
]);
onMounted(async () => { stats.value = await dashboard(); });
</script>
