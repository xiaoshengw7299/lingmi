import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getPriceBoard } from '@/api/pricing'
import type { PriceRow } from '@/types'

/** 打开过的页面在这一小段时间内复用上次结果，避免同一屏多个模型选择器各打一遍 */
const FRESH_MS = 60_000

let visibilityBound = false

/** 公开价目表。首页、价格页、模型选择器共用；过期或切回标签页时重新拉取 */
export const usePricingStore = defineStore('pricing', () => {
  const rows = ref<PriceRow[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  let pending: Promise<void> | null = null
  let fetchedAt = 0
  let requestId = 0

  const byId = computed(() => new Map(rows.value.map((row) => [row.id, row])))

  function load(force = false): Promise<void> {
    const fresh = fetchedAt > 0 && Date.now() - fetchedAt < FRESH_MS
    if (!force && fresh) return Promise.resolve()
    if (!force && pending) return pending

    const id = ++requestId
    const task = (async () => {
      if (rows.value.length === 0) loading.value = true
      try {
        const next = (await getPriceBoard()).rows
        if (id !== requestId) return
        rows.value = next
        loaded.value = true
        fetchedAt = Date.now()
      } finally {
        if (id === requestId) {
          pending = null
          loading.value = false
        }
      }
    })()
    pending = task
    return task
  }

  if (!visibilityBound && typeof document !== 'undefined') {
    visibilityBound = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !loaded.value) return
      void load(true).catch(() => undefined)
    })
  }

  return { rows, loaded, loading, byId, load }
})
