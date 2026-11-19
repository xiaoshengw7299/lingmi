<template>
  <div class="lm-page account-page account-dashboard">
    <div class="lm-container wrap">
      <header class="head">
        <div>
          <h1>模型定价</h1>
          <p>每个模型只展示一个单价。视频显示的是默认清晰度，例如 Seedance 2.5 为 720p。售价不能低于成本。海外版图片和视频要点「重新询价」后才有价格。</p>
        </div>
        <el-button :icon="Refresh" :loading="refreshing" @click="refresh">重新询价</el-button>
      </header>

      <section class="lm-card settings">
        <el-form inline label-position="left" @submit.prevent="saveSettings">
          <el-form-item label="美元兑人民币汇率">
            <b class="fx">{{ settings.usdCny ? settings.usdCny.toFixed(4) : '—' }}</b>
            <span v-if="settings.fxUpdatedAt" class="fx-meta">更新于 {{ settings.fxUpdatedAt }}</span>
          </el-form-item>
          <el-form-item label="全局加价系数">
            <el-input-number v-model="settings.markup" :min="0.1" :max="10" :step="0.05" :precision="4" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="savingSettings" native-type="submit">保存</el-button>
          </el-form-item>
        </el-form>
        <p class="hint">汇率每个工作日更新。视频售价系数 1 表示按官方价出售，0.8 表示八折，不能低于成本。图片、文本和智能工具的加价系数 1 表示按成本出售。智能工具的官方价是火山 MediaKit 刊例价（即成本），可手填覆盖。改完立刻生效。</p>
      </section>

      <ResponsiveTable v-loading="loading" :data="rows" class="lm-card table">
        <el-table-column class-name="mobile-wide mobile-heading" label="模型" min-width="220">
          <template #default="{ row }">
            <b>{{ modelName(row as AdminPriceRow) }}</b>
            <p class="scenario">{{ row.scenario }}</p>
            <p v-if="row.quoteError" class="quote-error">{{ row.quoteError }}</p>
          </template>
        </el-table-column>
        <el-table-column label="单位" width="110"><template #default="{ row }">元 / {{ row.unit }}</template></el-table-column>
        <el-table-column label="成本" width="100" align="right"><template #default="{ row }">{{ price(row.costPrice) }}</template></el-table-column>
        <el-table-column label="系数" width="120" align="right">
          <template #default="{ row }">
            <template v-if="row.pricingMode === 'video'">×{{ row.discount ?? 1 }}</template>
            <template v-else>
              ×{{ row.markup }}<el-tag v-if="row.markupOverride != null" size="small" type="warning" class="vendor">单独</el-tag>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="灵米价" width="110" align="right">
          <template #default="{ row }"><b class="ours lm-money">{{ price(row.price) }}</b></template>
        </el-table-column>
        <el-table-column label="官方价" width="130" align="right">
          <template #default="{ row }">
            <span class="lm-money">{{ price(row.officialPrice) }}</span>
            <el-tag v-if="row.officialOverride != null" size="small" type="info" class="vendor">手填</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="差价" width="100" align="right">
          <template #default="{ row }">
            <span :class="diff(row as AdminPriceRow).kind === 'save' ? 'save' : 'flat'" class="lm-money">{{ diffText(row as AdminPriceRow) }}</span>
          </template>
        </el-table-column>
        <el-table-column class-name="mobile-wide" label="询价时间" width="150">
          <template #default="{ row }">
            {{ row.pricingMode === 'video' || row.kind === 'tool' ? '—' : (row.quotedAt ? dateTime(row.quotedAt) : '未询价') }}
          </template>
        </el-table-column>
        <el-table-column class-name="mobile-wide mobile-actions" label="操作" width="90" fixed="right">
          <template #default="{ row }"><el-button link type="primary" @click="edit(row as AdminPriceRow)">调整</el-button></template>
        </el-table-column>
      </ResponsiveTable>
    </div>

    <el-dialog v-model="dialog" :title="`调整 · ${current ? modelName(current) : ''}`" width="min(460px, 94vw)" top="min(15vh, 48px)" append-to-body>
      <el-form label-position="top">
        <el-form-item v-if="current?.pricingMode === 'video'" label="售价系数（1 为官方价，0.8 为八折）">
          <el-input-number v-model="form.discount" :min="0.05" :max="3" :step="0.05" :precision="4" :controls="false" class="full" />
        </el-form-item>
        <el-form-item v-else label="加价系数（留空沿用全局）">
          <el-input-number v-model="form.markup" :min="0.1" :max="10" :step="0.05" :precision="4" :controls="false" placeholder="全局" class="full" />
        </el-form-item>
        <el-form-item v-if="current && current.kind !== 'llm' && current.kind !== 'vision'" :label="`官方单价（元 / ${current.unit}，留空则自动计算）`">
          <el-input-number v-model="form.officialUnitCny" :min="0" :precision="6" :controls="false" placeholder="取接口" class="full" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="savingModel" @click="saveModel">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import ResponsiveTable from '@/components/ResponsiveTable.vue'
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { getAdminPricing, refreshPricing, saveModelPricing, savePricingSettings } from '@/api/pricing'
import { usePricingStore } from '@/stores/pricing'
import type { AdminPriceRow } from '@/types'
import { dateTime, modelName, price, priceDiff } from '@/utils/format'

const rows = ref<AdminPriceRow[]>([])
const pricing = usePricingStore()
const loading = ref(false)
const refreshing = ref(false)
const savingSettings = ref(false)
const savingModel = ref(false)
const settings = reactive({ usdCny: 0, fxUpdatedAt: '', markup: 1 })

const dialog = ref(false)
const current = ref<AdminPriceRow | null>(null)
const form = reactive<{ markup: number | null | undefined; officialUnitCny: number | null | undefined; discount: number | null | undefined }>({
  markup: null,
  officialUnitCny: null,
  discount: 1,
})

async function load() {
  loading.value = true
  try {
    const data = await getAdminPricing()
    rows.value = data.rows
    Object.assign(settings, data.settings)
  } finally {
    loading.value = false
  }
}

async function refresh() {
  refreshing.value = true
  try {
    const data = await refreshPricing()
    rows.value = data.rows
    Object.assign(settings, data.settings)
    void pricing.load(true).catch(() => undefined)
    if (data.failed.length) {
      ElMessage.warning(`有 ${data.failed.length} 个模型这次没直接询到，表格里标出了原因`)
    } else {
      ElMessage.success('已重新询价')
    }
  } finally {
    refreshing.value = false
  }
}

async function saveSettings() {
  savingSettings.value = true
  try {
    await savePricingSettings({ markup: settings.markup })
    ElMessage.success('已保存，价格表已更新')
    await Promise.all([load(), pricing.load(true).catch(() => undefined)])
  } finally {
    savingSettings.value = false
  }
}

const diff = (row: AdminPriceRow) => priceDiff(row.price, row.officialPrice)

function diffText(row: AdminPriceRow) {
  const d = diff(row)
  return { none: '—', same: '持平', save: d.label, more: `+${price(d.amount)}` }[d.kind]
}

function edit(row: AdminPriceRow) {
  current.value = row
  form.markup = row.markupOverride
  form.officialUnitCny = row.officialOverride
  form.discount = row.discount ?? 1
  dialog.value = true
}

async function saveModel() {
  if (!current.value) return
  savingModel.value = true
  try {
    await saveModelPricing(current.value.id, current.value.pricingMode === 'video'
      ? { discount: form.discount ?? 1, officialUnitCny: form.officialUnitCny ?? null }
      : { markup: form.markup ?? null, officialUnitCny: form.officialUnitCny ?? null })
    dialog.value = false
    ElMessage.success('已保存')
    await Promise.all([load(), pricing.load(true).catch(() => undefined)])
  } finally {
    savingModel.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.wrap { padding-top: 28px; padding-bottom: 48px; max-width: 1380px; }
.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 18px; }
.head h1 { font-size: 24px; font-weight: 800; }
.head p { margin-top: 4px; font-size: 13px; color: var(--color-text-tertiary); }
.settings { padding: 18px 22px 12px; margin-bottom: 16px; }
.settings .el-form { display: flex; flex-wrap: wrap; gap: 4px 20px; }
.hint { font-size: 12px; color: var(--color-text-tertiary); }
.fx { font-size: 16px; color: var(--color-primary-dark); }
.fx-meta { margin-left: 10px; font-size: 12px; color: var(--color-text-tertiary); }
.table { overflow: hidden; }
.vendor { margin-left: 8px; }
.scenario { margin-top: 2px; font-size: 12px; color: var(--color-text-tertiary); }
.quote-error { margin-top: 2px; font-size: 12px; line-height: 1.5; color: var(--el-color-warning); }
.ours { color: var(--color-primary); }
.save { color: var(--color-accent); font-weight: 700; }
.flat { color: var(--color-text-tertiary); }
.full { width: 100%; }
@media (max-width: 860px) {
  .settings { padding: 14px; }
  .settings .el-form { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .settings .el-form-item { display: grid; height: auto; margin: 0; }
  .settings :deep(.el-form-item__label) { justify-content: flex-start; height: auto; padding: 0 0 4px; }
  .settings :deep(.el-form-item__content) { min-width: 0; flex-wrap: wrap; gap: 4px 8px; }
  .settings .el-input-number, .settings .el-button { width: 100%; }
  .settings .el-button, .settings :deep(.el-input__wrapper) { min-height: 42px; }
  .fx-meta { margin-left: 0; line-height: 1.5; overflow-wrap: anywhere; }
  .hint { margin-top: 12px; line-height: 1.65; }
}
</style>
