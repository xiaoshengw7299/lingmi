import { ElMessageBox } from 'element-plus'

/** 询问佣金比例（%），取消或关闭时返回 undefined。 */
export async function askCommissionPercent(name: string, current = 0, max = 100, hint?: string): Promise<number | undefined> {
  const cap = Math.round(Math.min(100, Math.max(0, max)) * 100) / 100
  const result = await ElMessageBox.prompt(
    hint ?? `佣金 = 每笔扣费的利润 × 这个比例，只对之后产生的账单生效，已产生的佣金不变。可填 0～${cap}`,
    `「${name}」的佣金比例（%）`,
    {
      inputValue: String(Math.min(current, cap)),
      inputValidator: (raw) => {
        const text = String(raw ?? '').trim()
        if (!/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/.test(text)) return '请输入数字，最多两位小数'
        if (Number(text) - cap > 1e-9) return `不能超过 ${cap}%`
        return true
      },
    },
  ).catch(() => undefined)
  return result === undefined ? undefined : Number(result.value)
}
