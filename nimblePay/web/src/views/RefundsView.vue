<template>
  <div>
    <div class="page-head">
      <div><h1>退款</h1><p>退款前会预扣余额。余额不足不能退。渠道失败会把余额退回。</p></div>
      <el-button v-if="auth.can('refund:create')" type="primary" @click="visible = true">发起退款</el-button>
    </div>
    <el-table :data="list" v-loading="loading">
      <el-table-column prop="refundNo" label="退款单" min-width="180" />
      <el-table-column label="原订单" min-width="180"><template #default="{ row }">{{ row.payOrder?.orderNo }}</template></el-table-column>
      <el-table-column label="金额（元）"><template #default="{ row }">{{ yuan(row.amountCents) }}</template></el-table-column>
      <el-table-column prop="status" label="状态" width="120" />
      <el-table-column prop="reason" label="原因" />
      <el-table-column label="操作" width="90"><template #default="{ row }"><el-button v-if="row.status !== 'SUCCESS'" link type="primary" @click="sync(row.refundNo)">查单</el-button></template></el-table-column>
    </el-table>
    <el-pagination class="pager" background layout="prev, pager, next" :total="total" :page-size="20" :current-page="page" @current-change="(p:number)=>{page=p;load()}" />
    <el-dialog v-model="visible" title="发起退款" width="min(420px, 92vw)">
      <el-form label-position="top">
        <el-form-item label="支付订单号"><el-input v-model="form.orderNo" /></el-form-item>
        <el-form-item label="金额（元，空则全额）"><el-input v-model="form.yuan" /></el-form-item>
        <el-form-item label="原因"><el-input v-model="form.reason" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="visible=false">取消</el-button><el-button type="primary" @click="submit">提交</el-button></template>
    </el-dialog>
  </div>
</template>
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { createRefund, refunds, syncRefund } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { yuan } from '@/utils/format';
const auth = useAuthStore();
const list = ref<any[]>([]); const total = ref(0); const page = ref(1); const loading = ref(false); const visible = ref(false);
const form = reactive({ orderNo: '', yuan: '', reason: '充值退款' });
async function load() {
  loading.value = true;
  try { const data = (await refunds({ page: page.value, pageSize: 20 })) as any; list.value = data.items; total.value = data.total; }
  finally { loading.value = false; }
}
async function submit() {
  await createRefund({ orderNo: form.orderNo.trim(), amount: form.yuan.trim() || undefined, reason: form.reason });
  visible.value = false; ElMessage.success('已提交'); await load();
}
async function sync(no: string) { await syncRefund(no); ElMessage.success('已查单'); await load(); }
onMounted(load);
</script>
