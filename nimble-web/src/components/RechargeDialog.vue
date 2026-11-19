<template>
  <el-dialog
    v-model="wallet.rechargeOpen"
    :title="step === 'form' ? '充值' : '等待支付结果'"
    width="min(480px, 94vw)"
    top="min(15vh, 48px)"
    :close-on-click-modal="false"
    destroy-on-close
    @closed="reset"
  >
    <template v-if="step === 'form'">
      <p v-if="wallet.rechargeHint" class="hint"><el-icon><WarningFilled /></el-icon>{{ wallet.rechargeHint }}</p>
      <p class="balance">当前余额 <b class="lm-money">¥ {{ yuan(wallet.balanceCents) }}</b></p>

      <div class="presets">
        <button
          v-for="value in PRESETS"
          :key="value"
          type="button"
          class="preset"
          :class="{ 'is-active': !custom && amount === value }"
          @click="pick(value)"
        >
          <b>{{ value }}</b><span>元</span>
        </button>
      </div>
      <el-input v-model="custom" placeholder="其他金额" inputmode="decimal" class="custom" @input="customChanged">
        <template #prefix>¥</template>
      </el-input>

      <p v-if="estimate" class="estimate">{{ estimate }}</p>
      <p class="note">充多少用多少，1 元 = 1 元额度，无手续费；用多少扣多少，生成失败会自动退回。</p>
    </template>

    <div v-else class="waiting">
      <el-icon class="spin" :size="34"><Loading /></el-icon>
      <p>请在新打开的支付宝页面完成付款</p>
      <small>付款成功后这里会自动更新，不需要手动刷新</small>
      <a v-if="payUrl" class="link" :href="payUrl" target="_blank" rel="noopener">没有弹出页面？点这里前往支付</a>
    </div>

    <template #footer>
      <div class="recharge-actions">
        <template v-if="step === 'form'">
          <el-button @click="wallet.rechargeOpen = false">取消</el-button>
          <el-button type="primary" :loading="creating" :disabled="!validAmount" @click="submit">
            支付宝支付 ¥ {{ validAmount ? finalAmount.toFixed(2) : '—' }}
          </el-button>
        </template>
        <template v-else>
          <el-button @click="wallet.rechargeOpen = false">稍后再说</el-button>
          <el-button type="primary" :loading="checking" @click="check">我已完成支付</el-button>
        </template>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading, WarningFilled } from '@element-plus/icons-vue'
import { getGenerationModels, type GenerationModels } from '@/api/generation'
import { getRechargeOrder, rechargeWallet } from '@/api/wallet'
import { usePricingStore } from '@/stores/pricing'
import { useWalletStore } from '@/stores/wallet'
import { modelName, yuan } from '@/utils/format'

const PRESETS = [10, 30, 50, 100, 200, 500]
const POLL_MS = 3000
const POLL_MAX = 200 // 约 10 分钟，和支付订单有效期一致

const wallet = useWalletStore()
const pricing = usePricingStore()
const genModels = ref<GenerationModels>()
const step = ref<'form' | 'pay'>('form')
const amount = ref(50)
const custom = ref('')
const creating = ref(false)
const checking = ref(false)
const payUrl = ref('')
let orderNo = ''
let timer: number | undefined
let polls = 0

const finalAmount = computed(() => (custom.value ? Number(custom.value) : amount.value))
const validAmount = computed(() => Number.isFinite(finalAmount.value) && finalAmount.value >= 1 && finalAmount.value <= 50000)

/** 比实际可生成数量多约一成，并至少多 1，避免写得刚好让人觉得被卡额度 */
function generous(count: number) {
  if (!Number.isFinite(count) || count < 1) return 0
  const whole = Math.floor(count)
  return Math.max(whole + 1, Math.ceil(count * 1.1))
}

const estimate = computed(() => {
  if (!validAmount.value || !genModels.value) return ''
  const amount = finalAmount.value
  const parts: string[] = []
  const image = genModels.value.image.find((model) => model.isDefault)
  const imageRow = image ? pricing.byId.get(image.id) : undefined
  if (image && imageRow?.price) {
    const n = generous(amount / imageRow.price)
    if (n) parts.push(`图片用「${imageRow.name}」约 ${n} 张`)
  }
  const video = genModels.value.video.find((model) => model.isDefault)
  const videoRow = video ? pricing.byId.get(video.id) : undefined
  if (video && videoRow?.price) {
    const perClip = videoRow.unit === '秒' ? videoRow.price * 5 : videoRow.price
    const n = generous(amount / perClip)
    if (n) parts.push(`视频用「${modelName(videoRow)}」约 ${n} 条 5 秒视频`)
  }
  if (!parts.length) return ''
  return `${parts.join('；')}。仅供预估，实际以所选模型和生成参数为准。`
})

watch(() => wallet.rechargeOpen, (open) => {
  if (!open) return
  void pricing.load().catch(() => undefined)
  if (!genModels.value) {
    getGenerationModels().then((models) => { genModels.value = models }).catch(() => undefined)
  }
}, { immediate: true })

function pick(value: number) {
  amount.value = value
  custom.value = ''
}

function customChanged(value: string) {
  // 只保留数字和最多两位小数
  custom.value = value.replace(/[^\d.]/g, '').replace(/^(\d*\.\d{0,2}).*$/, '$1')
}

async function submit() {
  creating.value = true
  // 必须在点击的同一时刻打开窗口，等接口返回再打开会被浏览器当成弹窗拦截
  const popup = window.open('', '_blank')
  try {
    const order = await rechargeWallet(Number(finalAmount.value.toFixed(2)))
    orderNo = order.orderNo
    payUrl.value = order.payUrl
    if (popup) popup.location.href = order.payUrl
    step.value = 'pay'
    polls = 0
    schedule()
  } catch {
    popup?.close()
  } finally {
    creating.value = false
  }
}

function schedule() {
  window.clearTimeout(timer)
  timer = window.setTimeout(check, POLL_MS)
}

async function check() {
  if (!orderNo) return
  checking.value = true
  try {
    const order = await getRechargeOrder(orderNo)
    if (order.status === 'SUCCESS' || order.status === 'REFUNDED') {
      ElMessage.success(`充值成功，已到账 ¥ ${yuan(order.amountCents)}`)
      await wallet.refresh()
      wallet.rechargeOpen = false
      return
    }
    if (order.status === 'CLOSED' || order.status === 'FAIL') {
      ElMessage.warning('订单已关闭，请重新发起充值')
      step.value = 'form'
      return
    }
  } catch {
    // 查询失败不打断，下一轮继续
  } finally {
    checking.value = false
  }
  if (++polls < POLL_MAX && step.value === 'pay') schedule()
}

function reset() {
  window.clearTimeout(timer)
  step.value = 'form'
  orderNo = ''
  payUrl.value = ''
  custom.value = ''
  // 关闭时再刷一次，用户可能在支付页已经付完
  void wallet.refresh()
}

onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<style scoped>
.hint { display: flex; align-items: center; gap: 6px; padding: 10px 12px; margin-bottom: 14px; border-radius: var(--radius-sm); background: var(--color-accent-soft); color: var(--color-warning); font-size: 13px; }
.balance { margin-bottom: 14px; color: var(--color-text-secondary); }
.balance b { font-size: 20px; color: var(--color-text-primary); margin-left: 4px; }
.presets { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
.preset {
  display: flex; align-items: center; justify-content: center; gap: 2px; height: 52px; border-radius: var(--radius-md);
  border: 1.5px solid var(--color-border); background: var(--color-card); cursor: pointer; transition: var(--transition);
}
.preset b { font-size: 20px; line-height: 1; color: var(--color-text-primary); }
.preset span { font-size: 12px; line-height: 1; color: var(--color-text-tertiary); }
.preset:hover { border-color: var(--color-primary-line); }
.preset.is-active { border-color: var(--color-primary); background: var(--color-primary-soft); }
.preset.is-active b { color: var(--color-primary); }
.estimate { margin: 14px 0 0; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--color-primary-soft); font-size: 13px; line-height: 1.7; color: var(--color-text-secondary); }
.note { margin-top: 14px; font-size: 12px; line-height: 1.7; color: var(--color-text-tertiary); }
.waiting { display: grid; justify-items: center; gap: 8px; padding: 18px 0 8px; text-align: center; }
.waiting p { font-size: 16px; font-weight: 600; }
.waiting small { color: var(--color-text-tertiary); }
.spin { color: var(--color-primary); animation: spin 1.1s linear infinite; }
.link { margin-top: 8px; font-size: 13px; color: var(--color-primary); }
@media (max-width: 640px) {
  .presets { gap: 6px; }
  .preset { height: 44px; }
  .custom :deep(.el-input__inner) { font-size: 16px; }
  .recharge-actions { display: grid; grid-template-columns: 1fr minmax(max-content, 1.8fr); gap: 8px; }
  .recharge-actions .el-button { min-height: 42px; margin: 0; }
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
