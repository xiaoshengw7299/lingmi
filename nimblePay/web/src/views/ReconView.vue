<template>
  <div>
    <div class="page-head">
      <div><h1>对账</h1><p>只能对昨天及更早的账单，一次最多 31 天。重跑会覆盖当天结果。</p></div>
      <div class="page-tools">
        <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" />
        <el-button v-if="auth.can('recon:exec')" type="primary" :loading="running" @click="run">开始对账</el-button>
      </div>
    </div>
    <el-table :data="batches" @row-click="open">
      <el-table-column prop="billDate" label="日期" width="120" />
      <el-table-column prop="billType" label="账单" width="140" />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column prop="matchedCount" label="一致" width="80" />
      <el-table-column prop="diffCount" label="差异" width="80" />
      <el-table-column prop="errorMsg" label="说明" />
    </el-table>
    <el-drawer v-model="drawer" title="对账明细" size="min(720px, 100%)">
      <el-table :data="items">
        <el-table-column prop="bizType" label="类型" width="90" />
        <el-table-column prop="diffType" label="差异" width="140" />
        <el-table-column prop="localOrderNo" label="本地单号" min-width="160" />
        <el-table-column label="渠道金额（元）"><template #default="{ row }">{{ yuan(row.channelAmountCents) }}</template></el-table-column>
        <el-table-column prop="handleStatus" label="处理" width="120" />
        <el-table-column label="操作" width="140">
          <template #default="{ row }">
            <el-button v-if="auth.can('recon:exec') && row.handleStatus === 'OPEN'" link type="primary" @click.stop="act(row.id, 'sync')">同步</el-button>
            <el-button v-if="auth.can('recon:exec') && row.handleStatus === 'OPEN'" link @click.stop="act(row.id, 'fixed')">已处理</el-button>
            <el-button v-if="auth.can('recon:exec') && row.handleStatus === 'OPEN'" link @click.stop="act(row.id, 'ignore')">忽略</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-drawer>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { handleRecon, reconBatches, reconItems, runRecon } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { yuan } from '@/utils/format';
const auth = useAuthStore();
const range = ref<string[]>([]);
const batches = ref<any[]>([]);
const items = ref<any[]>([]);
const drawer = ref(false);
const running = ref(false);
const batchId = ref('');
async function load() { const data = (await reconBatches({ page: 1, pageSize: 40 })) as any; batches.value = data.items; }
async function run() {
  if (!range.value?.[0]) return ElMessage.warning('请选择日期');
  running.value = true;
  try { await runRecon(range.value[0], range.value[1]); ElMessage.success('对账完成'); await load(); }
  finally { running.value = false; }
}
async function open(row: any) {
  batchId.value = row.id;
  const data = (await reconItems({ batchId: row.id, page: 1, pageSize: 100, onlyDiffs: true })) as any;
  items.value = data.items; drawer.value = true;
}
async function act(id: string, action: string) {
  await handleRecon(id, action);
  const data = (await reconItems({ batchId: batchId.value, page: 1, pageSize: 100, onlyDiffs: true })) as any;
  items.value = data.items;
}
onMounted(load);
</script>
