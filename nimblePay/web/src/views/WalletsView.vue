<template>
  <div>
    <div class="page-head">
      <div><h1>用户余额</h1><p>用户在 nimble 注册。这里查看余额、流水，必要时手工加减款。</p></div>
      <div class="page-tools">
        <el-input v-model="keyword" clearable placeholder="邮箱 / 昵称 / 用户 ID" @change="load" />
      </div>
    </div>
    <el-table :data="list" v-loading="loading">
      <el-table-column prop="externalUserId" label="nimble 用户" width="120" />
      <el-table-column prop="email" label="邮箱" min-width="180" />
      <el-table-column prop="nickname" label="昵称" width="120" />
      <el-table-column label="余额（元）"><template #default="{ row }"><span class="money">{{ yuan(row.balanceCents) }}</span></template></el-table-column>
      <el-table-column prop="status" label="状态" width="90" />
      <el-table-column label="操作" min-width="260" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="open(row)">流水</el-button>
          <el-button v-if="auth.can('wallet:edit')" link type="primary" @click="adjust(row, 'grant')">加款</el-button>
          <el-button v-if="auth.can('wallet:edit')" link type="danger" @click="adjust(row, 'revoke')">扣款</el-button>
          <el-button v-if="auth.can('wallet:edit') && row.externalUserId !== '__alipay_test__'" link @click="toggle(row)">
            {{ row.status === 'ACTIVE' ? '停用' : '启用' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination class="pager" background layout="prev, pager, next" :total="total" :page-size="20" :current-page="page" @current-change="(p:number)=>{page=p;load()}" />
    <el-drawer v-model="drawer" title="余额流水" size="min(480px, 100%)">
      <p v-if="detail">{{ detail.nickname || detail.email }} · {{ yuan(detail.balanceCents) }} 元</p>
      <el-table :data="detail?.ledgers || []" size="small">
        <el-table-column label="类型" width="130"><template #default="{ row }">{{ TYPE_LABEL[row.type] || row.type }}</template></el-table-column>
        <el-table-column label="金额（元）"><template #default="{ row }">{{ yuan(row.amountCents) }}</template></el-table-column>
        <el-table-column label="余额（元）"><template #default="{ row }">{{ yuan(row.balanceAfter) }}</template></el-table-column>
        <el-table-column prop="remark" label="备注" />
      </el-table>
    </el-drawer>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { adjustWallet, patchWallet, walletDetail, wallets } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { yuan } from '@/utils/format';
const auth = useAuthStore();
const TYPE_LABEL: Record<string, string> = {
  RECHARGE: '充值', REFUND_DEDUCT: '退款预扣', REFUND_RESTORE: '退款回退', ADMIN_GRANT: '后台加款', ADMIN_REVOKE: '后台扣款',
  CONSUME: '消费', CONSUME_REFUND: '消费退回', REFERRAL_REWARD: '邀请奖励', SIGNUP_GIFT: '新用户赠送', SHARE_REWARD: '分享奖励',
};
const list = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const keyword = ref('');
const loading = ref(false);
const drawer = ref(false);
const detail = ref<any>(null);
async function load() {
  loading.value = true;
  try {
    const data = (await wallets({ page: page.value, pageSize: 20, keyword: keyword.value || undefined })) as any;
    list.value = data.items; total.value = data.total;
  } finally { loading.value = false; }
}
async function open(row: any) { detail.value = await walletDetail(row.id); drawer.value = true; }
async function adjust(row: any, direction: 'grant' | 'revoke') {
  const { value } = await ElMessageBox.prompt(direction === 'grant' ? '加款金额（元）' : '扣款金额（元）', '调整余额', { inputPattern: /^\d+(\.\d{1,2})?$/, inputErrorMessage: '最多两位小数' });
  await adjustWallet(row.id, { amount: value, direction, remark: direction === 'grant' ? '后台加款' : '后台扣款' });
  ElMessage.success('已调整');
  await load();
}
async function toggle(row: any) {
  await patchWallet(row.id, { status: row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' });
  ElMessage.success(row.status === 'ACTIVE' ? '已停用' : '已启用');
  await load();
}
onMounted(load);
</script>
