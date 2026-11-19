export interface MentionHit {
  name: string
  /** 原文里 @ / ＠ 的下标 */
  start: number
  /** 名称结束位置（不含） */
  end: number
  /** 命中了已知名称；否则是按标点切开的未知 @token */
  known: boolean
}

/**
 * 识别提示词里的 @引用。
 * 已知名称按最长前缀匹配，名称后面不必有空格或标点，复制进来粘在一起的「@产品图让模特拿着」也能对上「产品图」。
 * @ 和名称之间的零宽字符、普通空格会被跳过；名称内部的零宽字符同样忽略。
 * 没有命中已知名称时，仍按分隔符切出未知 token，方便校验报错。
 * 规则需与 nimble-ai/src/modules/video/mention.util.ts 保持一致。
 */
export function scanMentions(text: string, knownNames?: readonly string[]): MentionHit[] {
  const names = [...new Set((knownNames ?? []).map((name) => name.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
  const hits: MentionHit[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch !== '@' && ch !== '＠') {
      i += 1
      continue
    }
    const start = i
    const afterAt = skipInvisible(text, i + 1)
    const nameAt = skipGap(text, afterAt)
    const matched = matchLongest(text, nameAt, names)
    if (matched) {
      hits.push({ name: matched.name, start, end: matched.end, known: true })
      i = matched.end
      continue
    }
    const raw = RAW_TOKEN.exec(text.slice(afterAt))
    if (raw?.[0]) {
      hits.push({ name: raw[0], start, end: afterAt + raw[0].length, known: false })
      i = afterAt + raw[0].length
      continue
    }
    i += 1
  }
  return hits
}

const RAW_TOKEN = /^[^\s,，。!！?？、@＠：:；;（）()【】[\]“”"'‘’]+/

function matchLongest(text: string, from: number, names: string[]): { name: string; end: number } | null {
  for (const name of names) {
    const end = matchExact(text, from, name)
    // 后面紧挨着英文或数字时，不把更短的名字认进去，避免 @图片1 被当成 @图片
    if (end != null && boundaryOk(text, end)) return { name, end }
  }
  return null
}

function boundaryOk(text: string, end: number): boolean {
  let i = end
  while (i < text.length && isInvisible(text[i]!)) i += 1
  if (i >= text.length) return true
  return !/[A-Za-z0-9_-]/.test(text[i]!)
}

/** 按 UTF-16 码元比较，名称中间允许夹着零宽字符 */
function matchExact(text: string, from: number, name: string): number | null {
  let i = from
  let j = 0
  while (j < name.length) {
    while (i < text.length && isInvisible(text[i]!)) i += 1
    if (text[i] !== name[j]) return null
    i += 1
    j += 1
  }
  return i
}

function skipInvisible(text: string, index: number): number {
  let i = index
  while (i < text.length && isInvisible(text[i]!)) i += 1
  return i
}

/** @ 和名称之间可以有空格或零宽字符，但不能跨行 */
function skipGap(text: string, index: number): number {
  let i = index
  while (i < text.length && isGap(text[i]!)) i += 1
  return i
}

function isInvisible(ch: string): boolean {
  const c = ch.charCodeAt(0)
  return c === 0x200b || c === 0x200c || c === 0x200d || c === 0x2060 || c === 0xfeff || c === 0xad
}

function isGap(ch: string): boolean {
  if (isInvisible(ch)) return true
  return ch === ' ' || ch === '\t' || ch === '\u00a0' || ch === '\u3000'
    || (ch >= '\u2000' && ch <= '\u200a') || ch === '\u202f' || ch === '\u205f'
}
