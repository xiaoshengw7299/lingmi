import { computed, onMounted, onUnmounted, shallowRef } from 'vue'
import { getShortVideoPricing, type ShortVideoQuote } from '@/api/short-video'

const beijingTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

export function useShortVideoPricing() {
  const quote = shallowRef<ShortVideoQuote>()
  let active = false
  let boundaryTimer: ReturnType<typeof setTimeout> | undefined
  let refreshTimer: ReturnType<typeof setInterval> | undefined
  let nextBoundary = Infinity
  let revision = 0

  function setQuote(value: ShortVideoQuote) {
    revision++
    quote.value = value
    const boundary = value.mode === 'promotion' ? value.endsAt : value.startsAt
    const wait = boundary ? Date.parse(boundary) - Date.parse(value.serverTime) : Infinity
    nextBoundary = wait > 0 ? performance.now() + wait : Infinity
    clearTimeout(boundaryTimer)
    if (active && wait > 0 && wait <= 2_147_483_647) {
      boundaryTimer = setTimeout(() => void refresh(), Math.ceil(wait))
    }
  }

  async function refresh() {
    if (performance.now() >= nextBoundary) {
      quote.value = undefined
      nextBoundary = Infinity
    }
    const request = ++revision
    try {
      const current = await getShortVideoPricing()
      if (active && request === revision) setQuote(current)
    } catch {
      // 定时刷新或回到页面时再试。
    }
  }

  function onVisibility() {
    if (!document.hidden) void refresh()
  }

  onMounted(() => {
    active = true
    void refresh()
    refreshTimer = setInterval(() => void refresh(), 30_000)
    document.addEventListener('visibilitychange', onVisibility)
  })
  onUnmounted(() => {
    active = false
    clearTimeout(boundaryTimer)
    clearInterval(refreshTimer)
    document.removeEventListener('visibilitychange', onVisibility)
  })

  return {
    quote,
    setQuote,
    deadline: computed(() => quote.value?.mode === 'promotion' && quote.value.endsAt
      ? `北京时间 ${beijingTime.format(Date.parse(quote.value.endsAt))} 截止`
      : ''),
  }
}
