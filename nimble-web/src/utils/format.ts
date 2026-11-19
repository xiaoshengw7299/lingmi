import dayjs from 'dayjs'

/** 分 → 元，两位小数 */
export const yuan = (cents: number | null | undefined) => (cents == null ? '—' : (cents / 100).toFixed(2))

/**
 * 单价（元）。大于 1 元保留两位，更小的价格多留几位有效数字，
 * 否则 0.0072 元 / 千字 会被显示成 0.01。
 */
export function price(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value >= 100) return value.toFixed(0)
  if (value >= 1) return value.toFixed(2)
  if (value >= 0.1) return value.toFixed(3)
  return value.toFixed(4)
}

/**
 * 灵米价与官方价的差价。两个价格先取整到页面显示的精度再比较：
 * 页面上看起来一样的价格就是持平，不会出现"都是 2.53，却省 0.0081"。
 * label 是省下的百分比，不足 1% 显示 "<1%"，不会显示成 "-0%"。
 */
export function priceDiff(ours: number | null | undefined, official: number | null | undefined) {
  if (ours == null || official == null) return { kind: 'none' as const, amount: 0, label: '' }
  const shownOurs = Number(price(ours))
  const shownOfficial = Number(price(official))
  const amount = Number((shownOfficial - shownOurs).toFixed(4))
  if (amount === 0) return { kind: 'same' as const, amount: 0, label: '' }
  if (amount < 0) return { kind: 'more' as const, amount: -amount, label: '' }
  const percent = (amount / shownOfficial) * 100
  return { kind: 'save' as const, amount, label: percent < 1 ? '<1%' : `-${Math.round(percent)}%` }
}

/** 模型展示名：厂商 + 型号，如"豆包 Seedance 2.5"。配置里型号部分有时不带系列名（FLUX 2 Pro），合起来才完整 */
export const modelName = (row: { vendor: string; name: string }) => (row.vendor ? `${row.vendor} ${row.name}` : row.name)

/** 账单里调用类型的展示名 */
export const KIND_LABEL: Record<string, string> = { video: '视频生成', image: '图片生成', audio: '音频生成', llm: '文本模型', tool: '智能工具' }

/** 利润率：利润占用户实付的百分比，没有消费时显示 — */
export const marginRate = (profitCents: number, chargeCents: number) =>
  chargeCents > 0 ? `${((profitCents / chargeCents) * 100).toFixed(1)}%` : '—'

export const dateTime = (value?: string | null) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—')
