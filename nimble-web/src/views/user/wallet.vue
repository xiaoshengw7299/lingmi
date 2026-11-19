<template>
  <section class="lm-card panel">
    <div class="title">
      <h2>收支明细</h2>
      <el-button text :icon="Refresh" :loading="table?.loading" @click="table?.reload()">刷新</el-button>
    </div>

    <LedgerTable ref="table" :fetch-page="getLedgers" />
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import LedgerTable from '@/components/LedgerTable.vue'
import { getLedgers } from '@/api/wallet'
import { useWalletStore } from '@/stores/wallet'

const wallet = useWalletStore()
const table = ref<InstanceType<typeof LedgerTable>>()

// 充值完成关闭弹窗后，明细要跟着刷新
watch(() => wallet.rechargeOpen, (open) => !open && table.value?.reload())
onMounted(() => void wallet.refresh())
</script>

<style scoped>
.panel { padding: 22px 26px 26px; }
.title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
h2 { font-size: 18px; font-weight: 800; }
@media (max-width: 860px) {
  .panel { padding: 14px; }
  .title { margin-bottom: 12px; }
  .title .el-button { min-height: 40px; }
}
</style>
