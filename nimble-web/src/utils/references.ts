import { scanMentions } from './mentions'

export type RefKind = 'image' | 'video' | 'audio' | 'text'

export interface RefItem {
  /** 提示词里 @ 用的名字 */
  name: string
  kind: RefKind
  url?: string
  text?: string
}

/** 与 MentionInput 里"不能出现在引用名中的字符"保持一致，否则 @名称 无法被识别 */
export const MENTION_FORBIDDEN = /[\s,，。!！?？、@＠：:；;（）()【】[\]“”"'‘’]/g

const LABEL: Record<RefKind, string> = { image: '参考图', video: '参考视频', audio: '参考音频', text: '文本' }

/**
 * 把"带 @名称 的提示词 + 一组参考"整理成可交给模型的请求内容：
 * 同类参考按顺序编号，提示词里的 @名称 换成"参考图1 / 参考视频1…"，
 * 图片 / 视频 / 音频地址分别归入对应的参考数组（顺序与编号一致），文本参考作为上下文附在后面。
 * 画布节点生成和提示词库发布示例共用这一套，两处的 @ 含义完全一致。
 */
export function compileReferences(prompt: string, refs: RefItem[]) {
  const usable = refs.filter((r) => (r.kind === 'text' ? !!r.text?.trim() : !!r.url))
  const counter = new Map<RefKind, number>()
  const labelOf = new Map<RefItem, string>()
  for (const r of usable) {
    const n = (counter.get(r.kind) ?? 0) + 1
    counter.set(r.kind, n)
    labelOf.set(r, `${LABEL[r.kind]}${n}`)
  }

  // 先换长名字，避免 @图片1 抢先吃掉 @图片10；名称后面没有空格也要换掉
  let text = prompt.trim()
  const hits = scanMentions(text, usable.map((item) => item.name)).filter((hit) => hit.known)
  let rewritten = ''
  let cursor = 0
  for (const hit of hits) {
    rewritten += text.slice(cursor, hit.start)
    const ref = usable.find((item) => item.name === hit.name)
    rewritten += (ref && labelOf.get(ref)) || text.slice(hit.start, hit.end)
    cursor = hit.end
  }
  text = rewritten + text.slice(cursor)
  const context = usable.filter((r) => r.kind === 'text').map((r) => `${labelOf.get(r)}：${r.text!.trim()}`)
  const urls = (kind: RefKind) => usable.filter((r) => r.kind === kind).map((r) => r.url!)

  return {
    prompt: [text, ...context].filter(Boolean).join('\n\n'),
    refImages: urls('image'),
    refVideos: urls('video'),
    refAudios: urls('audio'),
  }
}
