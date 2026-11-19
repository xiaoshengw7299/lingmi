<template>
  <div>
    <div class="page-head">
      <div><h1>充值订单</h1><p>支付宝电脑网站支付。支付成功后余额入账，测试单不入账。</p></div>
      <div class="page-tools">
        <el-input v-model="keyword" clearable placeholder="订单号 / 用户" @change="load" />
        <el-select v-model="status" clearable placeholder="状态" @change="load">
          <el-option v-for="s in ['PAYING','SUCCESS','FAIL','REFUNDED']" :key="s" :label="s" :value="s" />
        </el-select>
      </div>
    </div>
    <el-table :data="list" v-loading="loading">
      <el-table-column prop="orderNo" label="订单号" min-width="190" />
      <el-table-column label="用户" min-width="140"><template #default="{ row }">{{ row.user?.nickname || row.user?.email || row.user?.externalUserId }}</template></el-table-column>
      <el-table-column label="金额（元）" width="110"><template #default="{ row }"><span class="money">{{ yuan(row.amountCents) }}</span></template></el-table-column>
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column label="测试" width="70"><template #default="{ row }">{{ row.testPay ? '是' : '' }}</template></el-table-column>
      <el-table-column label="时间" width="160"><template #default="{ row }">{{ time(row.createdAt) }}</template></el-table-column>
      <el-table-column label="操作" min-width="220" fixed="right">
        <template #default="{ row }">
          <el-button v-if="auth.can('order:operate')" link type="primary" @click="sync(row.orderNo)">查单</el-button>
          <el-button v-if="auth.can('order:operate') && row.status === 'PAYING'" link @click="close(row.orderNo)">关单</el-button>
          <el-button v-if="auth.can('refund:create') && (row.status === 'SUCCESS' || row.status === 'REFUNDED')" link type="danger" @click="openRefund(row)">退款</el-button>
          <el-button v-if="auth.can('division:exec') && row.status === 'SUCCESS' && row.divisionMode !== 'FORBID' && row.divisionState !== 'FINISH'" link @click="divide(row.orderNo)">分账</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination class="pager" background layout="prev, pager, next" :total="total" :page-size="20" :current-page="page" @current-change="(p:number)=>{page=p;load()}" />
    <el-dialog v-model="refundOpen" title="退款" width="min(420px, 92vw)">
      <el-form label-position="top">
        <el-form-item label="订单">{{ refundForm.orderNo }}</el-form-item>
        <el-form-item label="金额（元，空则剩余全额）"><el-input v-model="refundForm.yuan" /></el-form-item>
        <el-form-item label="原因"><el-input v-model="refundForm.reason" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="refundOpen = false">取消</el-button>
        <el-button type="primary" @click="submitRefund">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { closeOrder, createRefund, execDivision, orders, syncOrder } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { time, yuan } from '@/utils/format';
const auth = useAuthStore();
const list = ref<any[]>([]); const total = ref(0); const page = ref(1); const keyword = ref(''); const status = ref(''); const loading = ref(false);
const refundOpen = ref(false);
const refundForm = reactive({ orderNo: '', yuan: '', reason: '充值退款' });
async function load() {
  loading.value = true;
  try {
    const data = (await orders({ page: page.value, pageSize: 20, keyword: keyword.value || undefined, status: status.value || undefined })) as any;
    list.value = data.items; total.value = data.total;
  } finally { loading.value = false; }
}
async function sync(orderNo: string) { await syncOrder(orderNo); ElMessage.success('已向支付宝查单'); await load(); }
async function close(orderNo: string) { await closeOrder(orderNo); ElMessage.success('已关闭'); await load(); }
function openRefund(row: any) {
  refundForm.orderNo = row.orderNo;
  refundForm.yuan = '';
  refundForm.reason = '充值退款';
  refundOpen.value = true;
}
async function submitRefund() {
  await createRefund({ orderNo: refundForm.orderNo, amount: refundForm.yuan.trim() || undefined, reason: refundForm.reason });
  refundOpen.value = false;
  ElMessage.success('已提交退款');
  await load();
}
async function divide(orderNo: string) { await execDivision(orderNo); ElMessage.success('已提交分账'); await load(); }
onMounted(load);
</script>
