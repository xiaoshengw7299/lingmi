<template>
  <div>
    <div class="page-head">
      <div><h1>分账</h1><p>接收方比例合计不能超过 100%。支付成功后按默认模式自动或手工分账。</p></div>
      <el-button v-if="auth.can('division:edit')" type="primary" @click="visible = true">添加接收方</el-button>
    </div>
    <el-table :data="list">
      <el-table-column prop="name" label="名称" />
      <el-table-column prop="accountNo" label="账号" min-width="160" />
      <el-table-column prop="accountName" label="姓名" />
      <el-table-column label="比例"><template #default="{ row }">{{ (row.ratioBps / 100).toFixed(2) }}%</template></el-table-column>
      <el-table-column prop="bindStatus" label="绑定" width="110" />
      <el-table-column label="启用" width="80"><template #default="{ row }">{{ row.enabled ? '是' : '否' }}</template></el-table-column>
      <el-table-column label="操作" min-width="200" fixed="right">
        <template #default="{ row }">
          <el-button v-if="auth.can('division:edit') && row.bindStatus !== 'BOUND'" link type="primary" @click="bind(row.id)">绑定</el-button>
          <el-button v-if="auth.can('division:edit') && row.bindStatus === 'BOUND'" link @click="unbind(row.id)">解绑</el-button>
          <el-button v-if="auth.can('division:edit')" link @click="toggle(row)">{{ row.enabled ? '停用' : '启用' }}</el-button>
        </template>
      </el-table-column>
    </el-table>
    <h3 style="margin: 24px 0 12px">分账记录</h3>
    <el-table :data="records">
      <el-table-column prop="batchNo" label="批次" min-width="180" />
      <el-table-column label="订单"><template #default="{ row }">{{ row.payOrder?.orderNo }}</template></el-table-column>
      <el-table-column label="接收方"><template #default="{ row }">{{ row.receiver?.name }}</template></el-table-column>
      <el-table-column label="金额（元）"><template #default="{ row }">{{ yuan(row.amountCents) }}</template></el-table-column>
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column label="操作" width="110" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="query(row.batchNo)">查渠道</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-dialog v-model="visible" title="分账接收方" width="min(420px, 92vw)">
      <el-form label-position="top">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="支付宝账号"><el-input v-model="form.accountNo" /></el-form-item>
        <el-form-item label="真实姓名"><el-input v-model="form.accountName" /></el-form-item>
        <el-form-item label="比例（基点，1000 = 10%）"><el-input v-model="form.ratioBps" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="visible=false">取消</el-button><el-button type="primary" @click="submit">保存并绑定</el-button></template>
    </el-dialog>
  </div>
</template>
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { bindReceiver, createReceiver, divisionRecords, patchReceiver, queryDivision, receivers, unbindReceiver } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { yuan } from '@/utils/format';
const auth = useAuthStore();
const list = ref<any[]>([]); const records = ref<any[]>([]); const visible = ref(false);
const form = reactive({ name: '', accountNo: '', accountName: '', ratioBps: '1000' });
async function load() {
  list.value = (await receivers()) as any[];
  const data = (await divisionRecords({ page: 1, pageSize: 30 })) as any;
  records.value = data.items;
}
async function submit() {
  await createReceiver({ ...form, ratioBps: Number(form.ratioBps) });
  visible.value = false; ElMessage.success('已保存'); await load();
}
async function bind(id: string) { await bindReceiver(id); ElMessage.success('已绑定'); await load(); }
async function unbind(id: string) { await unbindReceiver(id); ElMessage.success('已解绑'); await load(); }
async function toggle(row: any) { await patchReceiver(row.id, { enabled: !row.enabled }); ElMessage.success(row.enabled ? '已停用' : '已启用'); await load(); }
async function query(batchNo: string) { await queryDivision(batchNo); ElMessage.success('已向支付宝查询'); await load(); }
onMounted(load);
</script>
