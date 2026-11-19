<template>
  <div>
    <div class="page-head">
      <div><h1>转账</h1><p>从商户支付宝账户打款。系统繁忙时保持处理中，不会误标失败。</p></div>
      <el-button v-if="auth.can('transfer:create')" type="primary" @click="visible = true">发起转账</el-button>
    </div>
    <el-table :data="list">
      <el-table-column prop="transferNo" label="单号" min-width="180" />
      <el-table-column prop="accountNo" label="收款账号" min-width="160" />
      <el-table-column label="金额（元）"><template #default="{ row }">{{ yuan(row.amountCents) }}</template></el-table-column>
      <el-table-column prop="status" label="状态" width="120" />
      <el-table-column prop="failReason" label="说明" />
      <el-table-column label="操作" width="80"><template #default="{ row }"><el-button link type="primary" @click="sync(row.transferNo)">查单</el-button></template></el-table-column>
    </el-table>
    <el-dialog v-model="visible" title="转账" width="min(420px, 92vw)">
      <el-form label-position="top">
        <el-form-item label="金额（元）"><el-input v-model="form.yuan" /></el-form-item>
        <el-form-item label="支付宝账号"><el-input v-model="form.accountNo" placeholder="手机号、邮箱或 2088 userId" /></el-form-item>
        <el-form-item label="真实姓名"><el-input v-model="form.accountName" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="visible=false">取消</el-button><el-button type="primary" @click="submit">提交</el-button></template>
    </el-dialog>
  </div>
</template>
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { createTransfer, syncTransfer, transfers } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { yuan } from '@/utils/format';
const auth = useAuthStore();
const list = ref<any[]>([]); const visible = ref(false);
const form = reactive({ yuan: '', accountNo: '', accountName: '', remark: '' });
async function load() { const data = (await transfers({ page: 1, pageSize: 50 })) as any; list.value = data.items; }
async function submit() {
  await createTransfer({ amount: form.yuan.trim(), accountNo: form.accountNo.trim(), accountName: form.accountName.trim(), remark: form.remark });
  visible.value = false; ElMessage.success('已提交'); await load();
}
async function sync(no: string) { await syncTransfer(no); await load(); }
onMounted(load);
</script>
