<template>
  <div class="price-table" :class="{ 'with-cost': showCost }">
    <div class="tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        role="tab"
        class="tab"
        :class="{ 'is-active': tab.key === active }"
        :aria-selected="tab.key === active"
        @click="active = tab.key"
      >
        {{ tab.label }}<span class="count">{{ tab.rows.length }}</span>
      </button>
    </div>

    <div v-loading="loading" class="table-wrap">
      <table v-if="shown.length">
        <thead>
          <tr>
            <th>模型</th>
            <th>计价单位</th>
            <th v-if="showCost" class="num">成本价</th>
            <th class="num">灵米价</th>
            <th class="num">官方价</th>
            <th class="num">差价</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in shown" :key="row.id">
            <td data-label="模型">
              <div class="model"><b>{{ modelName(row) }}</b></div>
              <p class="scenario">{{ row.scenario }}</p>
            </td>
            <td class="unit" data-label="计价单位">元 / {{ row.unit }}</td>
            <td v-if="showCost" class="num lm-money cost" data-label="成本价">{{ priceText(row.costPrice) }}</td>
            <td class="num lm-money" data-label="灵米价">
              <b class="ours">{{ priceText(row.price) }}</b>
              <small v-if="row.outputPrice != null">输出 {{ priceText(row.outputPrice) }}</small>
            </td>
            <td class="num lm-money" data-label="官方价">
              <span class="official">{{ priceText(row.officialPrice) }}</span>
              <small v-if="row.outputOfficialPrice != null">输出 {{ priceText(row.outputOfficialPrice) }}</small>
            </td>
            <td class="num" data-label="差价">
              <span v-if="diff(row).kind === 'save'" class="save lm-money">
                省 {{ priceText(diff(row).amount) }}<em>{{ diff(row).label }}</em>
              </span>
              <span v-else-if="diff(row).kind === 'same'" class="same">与官方持平</span>
              <span v-else-if="diff(row).kind === 'more'" class="more lm-money">+{{ priceText(diff(row).amount) }}</span>
              <span v-else class="same">—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="!loading" class="empty">暂时没有已发布的价格</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PriceRow } from '@/types'
import { modelName, price as priceText, priceDiff } from '@/utils/format'

const props = withDefaults(
  defineProps<{
    rows: Array<PriceRow & { costPrice?: number | null }>
    loading?: boolean
    /** 多显示一列上游成本价，只给分销商和管理员看 */
    showCost?: boolean
    /** 每个分类最多展示几行，首页用来做精简预览 */
    limit?: number
  }>(),
  { loading: false, showCost: false, limit: 0 },
)

const TABS = [
  { key: 'video', label: '视频生成', kinds: ['video'] },
  { key: 'image', label: '图片生成', kinds: ['image'] },
  { key: 'audio', label: '配音 / 配乐', kinds: ['audio'] },
  { key: 'text', label: '文本 / 视觉理解', kinds: ['llm', 'vision'] },
  { key: 'tool', label: '智能工具', kinds: ['tool'] },
] as const

const tabs = computed(() =>
  TABS.map((tab) => ({ ...tab, rows: props.rows.filter((row) => (tab.kinds as readonly string[]).includes(row.kind)) })).filter(
    (tab) => tab.rows.length,
  ),
)
const active = ref<string>('video')
const shown = computed(() => {
  const rows = (tabs.value.find((tab) => tab.key === active.value) ?? tabs.value[0])?.rows ?? []
  return props.limit ? rows.slice(0, props.limit) : rows
})

const diff = (row: PriceRow) => priceDiff(row.price, row.officialPrice)
</script>

<style scoped>
.tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.tab {
  display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 16px; border-radius: 999px;
  border: 1px solid var(--color-border); background: var(--color-card); color: var(--color-text-secondary);
  font-size: 14px; font-weight: 600; cursor: pointer; transition: var(--transition);
}
.tab:hover { border-color: var(--color-primary-line); color: var(--color-primary); }
.tab.is-active { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
.count { font-size: 12px; opacity: 0.75; }

.table-wrap { min-height: 120px; overflow-x: auto; background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
table { width: 100%; border-collapse: collapse; min-width: 720px; }
th { padding: 14px 18px; text-align: left; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; color: var(--color-text-tertiary); background: var(--color-bg-secondary); }
td { padding: 16px 18px; border-top: 1px solid var(--color-divider); vertical-align: middle; }
tbody tr:hover { background: var(--color-bg-secondary); }
.num { text-align: right; white-space: nowrap; }
td.num small { display: block; margin-top: 2px; font-size: 12px; color: var(--color-text-tertiary); font-weight: 400; }

.model b { font-size: 15px; }
.scenario { margin-top: 3px; font-size: 12px; color: var(--color-text-tertiary); }
.unit { color: var(--color-text-secondary); white-space: nowrap; }
.ours { font-size: 17px; color: var(--color-primary); }
.cost { color: var(--color-text-secondary); }
.official { color: var(--color-text-tertiary); text-decoration: line-through; text-decoration-color: rgba(23, 35, 29, 0.3); }
.official small { text-decoration: none; }

.save { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: var(--color-accent-soft); color: var(--color-warning); font-weight: 700; font-size: 13px; }
.save em { font-style: normal; font-size: 12px; padding: 1px 6px; border-radius: 999px; background: var(--color-card); }
.same { font-size: 13px; color: var(--color-text-tertiary); }
.more { font-size: 13px; color: var(--color-text-tertiary); }
.empty { padding: 36px; text-align: center; color: var(--color-text-tertiary); }
@media (max-width: 860px) {
  .with-cost .tabs { gap: 6px; margin-bottom: 10px; }
  .with-cost .tab { flex: 1 1 auto; justify-content: center; min-height: 40px; padding-inline: 10px; }
  .with-cost .table-wrap { border: 0; background: transparent; }
  .with-cost table, .with-cost tbody { display: block; min-width: 0; }
  .with-cost thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .with-cost tr { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; padding: 12px; margin-bottom: 8px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); }
  .with-cost td { min-width: 0; padding: 0; border: 0; text-align: left; white-space: normal; overflow-wrap: anywhere; }
  .with-cost td:first-child { grid-column: 1 / -1; padding-bottom: 8px; border-bottom: 1px solid var(--color-divider); }
  .with-cost td:last-child { grid-column: 1 / -1; }
  .with-cost td::before { display: block; content: attr(data-label); font-size: 12px; color: var(--color-text-tertiary); }
  .with-cost .save { flex-wrap: wrap; padding-inline: 6px; }
}
</style>
