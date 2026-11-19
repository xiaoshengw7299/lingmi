/**
 * 分镜 @ 提及（mention）解析工具
 *
 * 分镜的 videoPrompt 文本中通过 `@素材名`/`@分镜名` 引用参考图、参考视频与参考音频，
 * 例如："@女主角 走进 @咖啡厅，全程以 @片尾曲 作为背景音乐"。
 *
 * 生成视频时需要：
 * 1. 按文本中首次出现的顺序，将提及的名称解析为实际素材 URL（resolveMentionRefs）；
 * 2. 按目标模型约定改写 `@名称`：MiniMax 为 `<Picture N>` / `<Video N>` / `<Audio N>`，
 *    Seedance 为 `@ImageN` / `@VideoN` / `@AudioN`，其余 Atlas 模型为 `图片N` / `视频N` / `音频N`。
 */

export type MentionType = 'image' | 'video' | 'audio' | 'text';

export interface MentionRef {
  name: string;
  type: MentionType;
  /** 图片 / 视频 / 音频的地址。文本引用没有地址 */
  url?: string;
  /** 文本引用的正文，生成时附在提示词后面 */
  text?: string;
  /** 视频/音频参考素材的时长（秒），用于参考素材时长上限校验 */
  durationSec?: number;
}

export type MentionRewriteStyle = 'atlas' | 'minimax' | 'seedance';

export interface MentionHit {
  name: string;
  start: number;
  end: number;
  known: boolean;
}

/**
 * 识别 @引用。已知名称按最长前缀匹配，后面不必有空格；
 * 复制进来粘在一起的「@产品图让模特拿着」也能对上「产品图」。
 * @ 与名称之间的空格、零宽字符，以及名称内部的零宽字符会被跳过。
 * 未传 knownNames 时只按分隔符切出 token，保持旧的未知引用校验。
 * 规则需与 nimble-web/src/utils/mentions.ts 保持一致。
 */
export function scanMentions(text: string, knownNames?: readonly string[]): MentionHit[] {
  const names = [...new Set((knownNames ?? []).map((name) => name.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  const hits: MentionHit[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== '@' && ch !== '＠') {
      i += 1;
      continue;
    }
    const start = i;
    const afterAt = skipInvisible(text, i + 1);
    const matched = matchLongest(text, skipGap(text, afterAt), names);
    if (matched) {
      hits.push({ name: matched.name, start, end: matched.end, known: true });
      i = matched.end;
      continue;
    }
    const raw = RAW_TOKEN.exec(text.slice(afterAt));
    if (raw?.[0]) {
      hits.push({ name: raw[0], start, end: afterAt + raw[0].length, known: false });
      i = afterAt + raw[0].length;
      continue;
    }
    i += 1;
  }
  return hits;
}

const RAW_TOKEN = /^[^\s,，。!！?？、@＠：:；;（）()【】[\]“”"'‘’]+/;

/** 从文本中按首次出现顺序提取被 @ 引用的名称（去重）。传入已知名称时按最长前缀识别。 */
export function extractMentionNames(text: string, knownNames?: readonly string[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const hit of scanMentions(text, knownNames)) {
    if (seen.has(hit.name)) continue;
    seen.add(hit.name);
    names.push(hit.name);
  }
  return names;
}

/** 精确重命名 mention。传入全部已知名称，避免把 @图片10 误改成 @新名10。 */
export function replaceMentionName(
  text: string,
  oldName: string,
  newName: string,
  knownNames?: readonly string[],
): string {
  const names = [...new Set([...(knownNames ?? []), oldName].filter(Boolean))];
  return mapKnownMentions(text, names, (hit) => (hit.name === oldName ? `@${newName}` : null));
}

/** 删除 mention，并收敛多余空格，避免素材删除后留下悬空 @。 */
export function removeMentionName(text: string, name: string, knownNames?: readonly string[]): string {
  const names = [...new Set([...(knownNames ?? []), name].filter(Boolean))];
  return mapKnownMentions(text, names, (hit) => (hit.name === name ? '' : null))
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/^[^\S\n]+|[^\S\n]+$/gm, '');
}

/** 将文本中提及的名称解析为参考池里的条目，按首次出现顺序、去重 */
export function resolveMentionRefs(text: string, pool: MentionRef[]): MentionRef[] {
  const byName = new Map(pool.map((p) => [p.name, p]));
  return extractMentionNames(text, pool.map((item) => item.name))
    .map((name) => byName.get(name))
    .filter((ref): ref is MentionRef => !!ref);
}

function mapKnownMentions(
  text: string,
  knownNames: readonly string[],
  replace: (hit: MentionHit) => string | null,
): string {
  const hits = scanMentions(text, knownNames).filter((hit) => hit.known);
  let out = '';
  let cursor = 0;
  for (const hit of hits) {
    out += text.slice(cursor, hit.start);
    out += replace(hit) ?? text.slice(hit.start, hit.end);
    cursor = hit.end;
  }
  return out + text.slice(cursor);
}

function matchLongest(text: string, from: number, names: string[]): { name: string; end: number } | null {
  for (const name of names) {
    const end = matchExact(text, from, name);
    // 后面紧挨着英文或数字时，不把更短的名字认进去，避免 @图片1 被当成 @图片
    if (end != null && boundaryOk(text, end)) return { name, end };
  }
  return null;
}

function boundaryOk(text: string, end: number): boolean {
  let i = end;
  while (i < text.length && isInvisible(text[i]!)) i += 1;
  if (i >= text.length) return true;
  return !/[A-Za-z0-9_-]/.test(text[i]!);
}

function matchExact(text: string, from: number, name: string): number | null {
  let i = from;
  let j = 0;
  while (j < name.length) {
    while (i < text.length && isInvisible(text[i]!)) i += 1;
    if (text[i] !== name[j]) return null;
    i += 1;
    j += 1;
  }
  return i;
}

function skipInvisible(text: string, index: number): number {
  let i = index;
  while (i < text.length && isInvisible(text[i]!)) i += 1;
  return i;
}

function skipGap(text: string, index: number): number {
  let i = index;
  while (i < text.length && isGap(text[i]!)) i += 1;
  return i;
}

function isInvisible(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c === 0x200b || c === 0x200c || c === 0x200d || c === 0x2060 || c === 0xfeff || c === 0xad;
}

function isGap(ch: string): boolean {
  if (isInvisible(ch)) return true;
  return ch === ' ' || ch === '\t' || ch === '\u00a0' || ch === '\u3000'
    || (ch >= '\u2000' && ch <= '\u200a') || ch === '\u202f' || ch === '\u205f';
}

/**
 * 每类参考素材各自从 1 开始编号。
 * `resolvedRefs` 的同类内部顺序必须与提交给上游的素材顺序一致，否则提示词里的编号会指错素材。
 */
function rewriteMentionsWith(
  text: string,
  resolvedRefs: MentionRef[],
  labelFor: (type: MentionType, index: number) => string,
): string {
  const indexes: Record<MentionType, number> = { image: 0, video: 0, audio: 0, text: 0 };
  const labels = new Map<string, string>();
  resolvedRefs.forEach((ref) => {
    const index = (indexes[ref.type] += 1);
    // 文本不是上游的媒体槽位，各家模型都写成「文本N」，再把正文附在提示词后面
    labels.set(ref.name, ref.type === 'text' ? `文本${index}` : labelFor(ref.type, index));
  });
  return mapKnownMentions(text, [...labels.keys()], (hit) => labels.get(hit.name) ?? null);
}

const ATLAS_LABELS: Record<MentionType, string> = { image: '图片', video: '视频', audio: '音频', text: '文本' };
const MINIMAX_LABELS: Record<MentionType, string> = { image: 'Picture', video: 'Video', audio: 'Audio', text: '文本' };
const SEEDANCE_LABELS: Record<MentionType, string> = { image: 'Image', video: 'Video', audio: 'Audio', text: '文本' };

/** 非 MiniMax / Seedance 的 Atlas 模型：图片N、视频N、音频N */
export function rewriteMentionsForAtlas(text: string, resolvedRefs: MentionRef[]): string {
  return rewriteMentionsWith(text, resolvedRefs, (type, index) => `${ATLAS_LABELS[type]}${index}`);
}

/** MiniMax-H3：与官方提示词标签一致 */
export function rewriteMentionsForMiniMax(text: string, resolvedRefs: MentionRef[]): string {
  return rewriteMentionsWith(text, resolvedRefs, (type, index) => `<${MINIMAX_LABELS[type]} ${index}>`);
}

/** Seedance 2.5 官方引用语法：@Image1 / @Video1 / @Audio1 */
export function rewriteMentionsForSeedance(text: string, resolvedRefs: MentionRef[]): string {
  return rewriteMentionsWith(text, resolvedRefs, (type, index) => `@${SEEDANCE_LABELS[type]}${index}`);
}

/** 按厂商选择提及改写格式。Seedance 国内版和海外版都用 @Image1 */
export function mentionRewriteStyleFor(provider: string): MentionRewriteStyle {
  if (provider === 'minimax') return 'minimax';
  if (provider === 'bytedance' || provider === 'ark') return 'seedance';
  return 'atlas';
}

/**
 * 改写 @名称，并把文本引用的正文附在提示词后面。
 * 文本编号与改写结果一致（文本1、文本2…），模型才对得上说的是哪一段。
 */
export function composeMentionPrompt(
  prompt: string,
  refs: MentionRef[],
  style: MentionRewriteStyle = 'atlas',
): string {
  const rewritten = rewriteMentions(prompt, refs, style).trim();
  let index = 0;
  const lines = refs.flatMap((ref) => {
    if (ref.type !== 'text' || !ref.text?.trim()) return [];
    index += 1;
    return [`文本${index}：${ref.text.trim()}`];
  });
  return [rewritten, ...lines].filter(Boolean).join('\n\n');
}

/** 按视频模型 Provider 选择提及改写格式；图片生成仍走 rewriteMentionsForAtlas */
export function rewriteMentions(
  text: string,
  resolvedRefs: MentionRef[],
  style: MentionRewriteStyle = 'atlas',
): string {
  if (style === 'minimax') return rewriteMentionsForMiniMax(text, resolvedRefs);
  if (style === 'seedance') return rewriteMentionsForSeedance(text, resolvedRefs);
  return rewriteMentionsForAtlas(text, resolvedRefs);
}
