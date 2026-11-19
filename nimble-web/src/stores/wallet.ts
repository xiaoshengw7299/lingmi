import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getWallet } from '@/api/wallet'
import { useAuthStore } from '@/stores/auth'

/** 余额与充值弹窗。顶栏、用户中心、余额不足拦截共用同一份状态 */
export const useWalletStore = defineStore('wallet', () => {
  const balanceCents = ref<number | null>(null)
  const rechargeOpen = ref(false)
  /** 余额不足时的提示语，普通充值入口为空 */
  const rechargeHint = ref('')

  async function refresh() {
    if (!useAuthStore().isLoggedIn) {
      balanceCents.value = null
      return
    }
    try {
      balanceCents.value = (await getWallet()).balanceCents
    } catch {
      // 支付服务没配或暂时不可用：余额显示为 —，不影响其他功能
      balanceCents.value = null
    }
  }

  function openRecharge(hint = '') {
    rechargeHint.value = hint
    rechargeOpen.value = true
  }

  return { balanceCents, rechargeOpen, rechargeHint, refresh, openRecharge }
})
