/**
 * 免费素材检索的统一形状。各源都归一成这个结构，
 * 选片引擎按 title/tags 做关键词启发或 LLM 语义重排，调用方不再关心每个站的原始字段。
 */
export type StockSourceId = 'pexels' | 'pixabay' | 'coverr' | 'wikimedia' | 'openverse';
export type StockMediaType = 'video' | 'image';

export interface StockClip {
  id: string;
  source: StockSourceId;
  url: string;
  width: number;
  height: number;
  durationSec: number;
  title?: string;
  tags?: string[];
  author?: string;
  mediaType?: StockMediaType;
  /** 列表预览图。视频用封面，图片可空（直接用 url） */
  poster?: string;
}

export interface StockSearchOpts {
  orientation: 'portrait' | 'landscape' | 'square';
  minDurationSec: number;
  perPage?: number;
}

export interface StockProviderOption {
  value: StockSourceId;
  label: string;
  hint: string;
  configured: boolean;
}

export const STOCK_SOURCE_META: Record<StockSourceId, { label: string; hint: string; keyless: boolean }> = {
  wikimedia: { label: 'Wikimedia', hint: '免 Key，CC/公共领域实拍视频，开箱即用', keyless: true },
  openverse: { label: 'Openverse', hint: '免 Key，CC 可商用图片（自动推镜成片）', keyless: true },
  pexels: { label: 'Pexels', hint: '高质量实拍视频，适合生活/产品氛围', keyless: false },
  pixabay: { label: 'Pixabay', hint: '素材量大、覆盖面广', keyless: false },
  coverr: { label: 'Coverr', hint: '电影感空镜与运镜，适合开场/转场', keyless: false },
};

/** 默认勾选：有 Key 的主力源 + 免 Key 视频兜底，零配置也能出片 */
export const DEFAULT_STOCK_SOURCES: StockSourceId[] = ['pexels', 'wikimedia'];
export const ALL_STOCK_SOURCES: StockSourceId[] = ['wikimedia', 'openverse', 'pexels', 'pixabay', 'coverr'];

export function stockSourceOptions(): Array<{ value: StockSourceId; label: string; hint: string }> {
  return ALL_STOCK_SOURCES.map((value) => ({
    value,
    label: STOCK_SOURCE_META[value].label,
    hint: STOCK_SOURCE_META[value].hint,
  }));
}

export interface StockMatchQuery {
  id: string;
  term: string;
  voiceover?: string;
  /** 商品特写/出镜镜头跳过素材库，由调用方自己配画面 */
  skip?: boolean;
}

export interface StockMatchRules {
  /** 用 LLM 按旁白语义重排候选；失败自动回退关键词启发，不阻断 */
  semantic: boolean;
  /** 跨镜去重：同一素材不重复使用 */
  dedupe: boolean;
}

export interface StockMatchHit {
  queryId: string;
  clip: StockClip;
  matchedBy: 'semantic' | 'heuristic';
}
