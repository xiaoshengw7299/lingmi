import { createHmac, timingSafeEqual } from 'crypto';

/**
 * 一键成片：对用户暴露的选项，以及自研生成流水线（ShortVideoService.runPipeline）的默认值。
 *
 * 音色/BGM类型/字幕位置/字体/画布比例统一从 media-pipeline/media-options.ts 取。
 */
import {
  allVoiceValues,
  BGM_EXTS,
  BGM_UPLOAD_MAX_BYTES,
  isAllowedBgm,
  isAllowedVoice,
  MEDIA_ASPECTS,
  MEDIA_BGM_TYPES,
  MEDIA_FONTS,
  MEDIA_SUBTITLE_POSITIONS,
  MEDIA_VOICE_GROUPS,
  MEDIA_VOICES,
  mergeNarrationSettings,
  NARRATION_DEFAULTS,
  NarrationSettings,
  NO_VOICE_NAME,
} from '../media-pipeline/media-options';
import { LoraSelection } from '../atlas/atlas.types';
import { DEFAULT_STOCK_SOURCES, stockSourceOptions } from '../media-pipeline/stock.types';

// 沿用旧的导入路径：short-video 内部（controller/service/dto）都从本文件取这些共用工具，
// 迁到 media-options.ts 后在这里原样转发一次，调用方不用改 import 路径。
export { allVoiceValues, BGM_EXTS, BGM_UPLOAD_MAX_BYTES, isAllowedBgm, isAllowedVoice, NO_VOICE_NAME };
/** AI 配音音色统一带这个前缀，TtsService 据此路由到 模型平台API；其余原样走免费 Edge TTS */
export { ATLAS_VOICE_PREFIX } from '../media-pipeline/tts.service';

export const SHORT_VIDEO_ASPECTS = MEDIA_ASPECTS;
export const SHORT_VIDEO_VOICE_GROUPS = MEDIA_VOICE_GROUPS;
export const SHORT_VIDEO_VOICES = MEDIA_VOICES;

export const SHORT_VIDEO_SOURCES = [
  { value: 'local', label: '本地素材', hint: '按配音时长从你的视频中切 2–15 秒窗口拼接，不是从开头固定切 3 秒' },
  { value: 'stock', label: '免费素材', hint: '先按文案检索并确认素材，再按配音时长从素材中切 2–15 秒窗口' },
  { value: 'ai', label: 'AI 生成', hint: '逐段生图 + 缓慢推镜，无需素材库' },
] as const;

export const SHORT_VIDEO_STOCK_SOURCES = stockSourceOptions();

export const SHORT_VIDEO_BGM = MEDIA_BGM_TYPES;

export const SHORT_VIDEO_CONCAT = [
  { value: 'random', label: '随机拼接' },
  { value: 'sequential', label: '顺序拼接' },
] as const;

export const SHORT_VIDEO_FIT = [
  { value: 'cover', label: '填满裁剪' },
  { value: 'contain', label: '完整显示' },
] as const;

export const SHORT_VIDEO_TRANSITIONS = [
  { value: 'none', label: '无转场' },
  { value: 'Shuffle', label: '随机转场' },
  { value: 'FadeIn', label: '淡入' },
  { value: 'FadeOut', label: '淡出' },
  { value: 'SlideIn', label: '滑入' },
  { value: 'SlideOut', label: '滑出' },
  { value: 'ZoomIn', label: '放大' },
  { value: 'ZoomOut', label: '缩小' },
] as const;

export const SHORT_VIDEO_SUBTITLE_POSITIONS = MEDIA_SUBTITLE_POSITIONS;
export const SHORT_VIDEO_FONTS = MEDIA_FONTS;

/** 用户确认过的免费素材。非空时流水线直接用这份名单，不再重新检索 */
export interface ShortVideoStockPick {
  id: string;
  source: string;
  url: string;
  poster?: string;
  title?: string;
  durationSec: number;
  width: number;
  height: number;
  mediaType?: 'video' | 'image';
}

export const SHORT_VIDEO_DEFAULTS = {
  ...NARRATION_DEFAULTS,
  videoSource: 'local' as const,
  stockSources: [...DEFAULT_STOCK_SOURCES] as string[],
  terms: '',
  scriptPrompt: '',
  paragraphNumber: 1,
  fitMode: 'cover' as const,
  concatMode: 'sequential' as const,
  transitionMode: 'none' as const,
  clipDuration: 3,
  clipSpeed: 1,
  videoCount: 1,
  matchMaterials: true,
  semanticMatch: true,
  stockDedupe: true,
  imageModelId: '',
  imageLora: null as LoraSelection | null,
  noVoiceDurationSec: 20,
};

export const MATERIAL_MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const MATERIAL_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MATERIAL_UPLOAD_MAX_BYTES = MATERIAL_MAX_VIDEO_BYTES;

export const MATERIAL_VIDEO_EXTS = ['.mp4', '.mov', '.avi', '.flv', '.mkv'] as const;
export const MATERIAL_IMAGE_EXTS = ['.jpg', '.jpeg', '.png'] as const;
export const MATERIAL_EXTS = [...MATERIAL_VIDEO_EXTS, ...MATERIAL_IMAGE_EXTS] as const;

/** 一键成片专属生成参数：在共用的配音/字幕设置（NarrationSettings）之上，叠加素材来源相关字段 */
export type ShortVideoSettings = NarrationSettings & {
  terms: string;
  scriptPrompt: string;
  paragraphNumber: number;
  fitMode: string;
  concatMode: string;
  transitionMode: string;
  clipDuration: number;
  clipSpeed: number;
  videoCount: number;
  matchMaterials: boolean;
  semanticMatch: boolean;
  stockDedupe: boolean;
  stockSources: string[];
  imageModelId: string;
  imageLora: LoraSelection | null;
  /** 选择"不配音"（voiceName = NO_VOICE_NAME）时，没有旁白时长可依据，改用这个显式总时长驱动素材时长与字幕比例分配 */
  noVoiceDurationSec: number;
  /** 用户在页面上确认过的免费素材；空数组表示生成时再检索 */
  stockPicks: ShortVideoStockPick[];
  /** 本条完成后还要自动再生成的条数。每条都会重新写文案 */
  seriesRemaining: number;
  /** 已经排出下一条，避免流水线重入时重复创建 */
  seriesSpawned: boolean;
};

export function materialExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

export function isAllowedMaterial(filename: string): boolean {
  return (MATERIAL_EXTS as readonly string[]).includes(materialExt(filename));
}

export function materialKind(filename: string): 'video' | 'image' {
  return (MATERIAL_IMAGE_EXTS as readonly string[]).includes(materialExt(filename))
    ? 'image'
    : 'video';
}

export function materialMaxBytes(filename: string): number {
  return materialKind(filename) === 'image' ? MATERIAL_MAX_IMAGE_BYTES : MATERIAL_MAX_VIDEO_BYTES;
}

export function mergeSettings(input?: Partial<ShortVideoSettings> | null): ShortVideoSettings {
  return {
    ...mergeNarrationSettings(input),
    terms: input?.terms ?? SHORT_VIDEO_DEFAULTS.terms,
    scriptPrompt: input?.scriptPrompt ?? SHORT_VIDEO_DEFAULTS.scriptPrompt,
    paragraphNumber: input?.paragraphNumber ?? SHORT_VIDEO_DEFAULTS.paragraphNumber,
    fitMode: input?.fitMode ?? SHORT_VIDEO_DEFAULTS.fitMode,
    concatMode: input?.concatMode ?? SHORT_VIDEO_DEFAULTS.concatMode,
    transitionMode: input?.transitionMode ?? SHORT_VIDEO_DEFAULTS.transitionMode,
    clipDuration: input?.clipDuration ?? SHORT_VIDEO_DEFAULTS.clipDuration,
    clipSpeed: input?.clipSpeed ?? SHORT_VIDEO_DEFAULTS.clipSpeed,
    videoCount: input?.videoCount ?? SHORT_VIDEO_DEFAULTS.videoCount,
    matchMaterials: input?.matchMaterials ?? SHORT_VIDEO_DEFAULTS.matchMaterials,
    semanticMatch: input?.semanticMatch ?? SHORT_VIDEO_DEFAULTS.semanticMatch,
    stockDedupe: input?.stockDedupe ?? SHORT_VIDEO_DEFAULTS.stockDedupe,
    stockSources: normalizeStockSources(input?.stockSources),
    imageModelId: input?.imageModelId ?? SHORT_VIDEO_DEFAULTS.imageModelId,
    imageLora: input?.imageLora ?? null,
    noVoiceDurationSec: input?.noVoiceDurationSec ?? SHORT_VIDEO_DEFAULTS.noVoiceDurationSec,
    stockPicks: normalizeStockPicks(input?.stockPicks),
    seriesRemaining: clampInt(input?.seriesRemaining, 0, 9),
    seriesSpawned: input?.seriesSpawned === true,
  };
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** 只接受公网 http(s) 地址，避免任务里夹带内网下载 */
function isSafeMediaUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((n) => n > 255)) return false;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
  }
  return host !== '::1';
}

const STOCK_MEDIA_TTL_MS = 6 * 60 * 60 * 1000;

function stockMediaSig(url: string, exp: number, forVideoShare = false): string {
  const secret = forVideoShare
    ? process.env.DOUYIN_CLIENT_SECRET?.trim() || process.env.XHS_APP_SECRET?.trim()
    : process.env.JWT_SECRET || 'default-secret-change-me';
  if (!secret) return '';
  const value = `${exp}.${url}`;
  return createHmac('sha256', secret).update(forVideoShare ? `video-share.${value}` : value).digest('base64url');
}

function stockMediaQuery(raw?: string | null, forVideoShare = false): string | undefined {
  if (!raw || !isSafeMediaUrl(raw)) return undefined;
  const exp = Date.now() + STOCK_MEDIA_TTL_MS;
  const sig = stockMediaSig(raw, exp, forVideoShare);
  if (!sig) return undefined;
  return new URLSearchParams({ u: raw, exp: String(exp), sig }).toString();
}

/** 浏览器直接打开的预览地址。素材站经常拒绝带外站 Referer 的请求，所以由本服务代拉。 */
export function stockMediaViewPath(raw?: string | null): string | undefined {
  const query = stockMediaQuery(raw);
  return query ? `short-video/stock-media?${query}` : undefined;
}

export function stockVideoShareRef(url: string) {
  return stockMediaQuery(url, true);
}

export function readStockVideoShareRef(ref: string) {
  const query = new URLSearchParams(ref);
  return readStockMediaUrl(query.get('u') ?? undefined, query.get('exp') ?? undefined, query.get('sig') ?? undefined, true);
}

export function readStockMediaUrl(u?: string, exp?: string, sig?: string, forVideoShare = false): string | null {
  const expires = Number(exp);
  if (!u || !sig || !Number.isFinite(expires) || expires < Date.now() || !isSafeMediaUrl(u)) return null;
  const expected = stockMediaSig(u, expires, forVideoShare);
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  return u;
}

export function normalizeStockPicks(
  value?: Array<Partial<ShortVideoStockPick> & { id?: string; url?: string }> | null,
): ShortVideoStockPick[] {
  if (!Array.isArray(value)) return [];
  const picks: ShortVideoStockPick[] = [];
  for (const item of value) {
    if (!item || typeof item.id !== 'string' || typeof item.url !== 'string') continue;
    if (!isSafeMediaUrl(item.url)) continue;
    const poster = typeof item.poster === 'string' && isSafeMediaUrl(item.poster) ? item.poster : undefined;
    picks.push({
      id: item.id.slice(0, 200),
      source: String(item.source ?? '').slice(0, 40),
      url: item.url,
      poster,
      title: item.title ? String(item.title).slice(0, 300) : undefined,
      durationSec: Number.isFinite(Number(item.durationSec)) ? Number(item.durationSec) : 0,
      width: Number(item.width) || 0,
      height: Number(item.height) || 0,
      mediaType: item.mediaType === 'image' ? 'image' : 'video',
    });
    if (picks.length >= 20) break;
  }
  return picks;
}

/** 自研流水线各阶段的进度区间 → 用户可读文案（与 ShortVideoService.runPipeline 的步骤顺序一一对应） */
export function stageFromProgress(progress: number, videoSource: string): string {
  if (progress < 5) return '准备中';
  if (progress < 15) return '生成文案';
  if (progress < 25) return videoSource === 'local' ? '整理文案' : '提取关键词';
  if (progress < 45) return '生成配音';
  if (progress < 55) return '生成字幕';
  if (progress < 85) {
    if (videoSource === 'local') return '读取本地素材';
    if (videoSource === 'ai') return 'AI 生成画面';
    return '匹配免费素材';
  }
  if (progress < 100) return '合成视频';
  return '已完成';
}

export function normalizeVideoSource(value?: string | null): 'stock' | 'local' | 'ai' {
  if (value === 'local' || value === 'ai' || value === 'stock') return value;
  return 'stock';
}

export function normalizeStockSources(value?: string[] | null): string[] {
  const allowed = SHORT_VIDEO_STOCK_SOURCES.map((item) => item.value);
  const list = (value ?? []).filter((item) => allowed.includes(item as (typeof allowed)[number]));
  return list.length ? list : [...SHORT_VIDEO_DEFAULTS.stockSources];
}

export function getCreateOptions() {
  return {
    aspects: SHORT_VIDEO_ASPECTS,
    voiceGroups: SHORT_VIDEO_VOICE_GROUPS,
    voices: SHORT_VIDEO_VOICES,
    sources: SHORT_VIDEO_SOURCES,
    stockSources: SHORT_VIDEO_STOCK_SOURCES,
    bgmTypes: SHORT_VIDEO_BGM,
    concatModes: SHORT_VIDEO_CONCAT,
    fitModes: SHORT_VIDEO_FIT,
    transitions: SHORT_VIDEO_TRANSITIONS,
    subtitlePositions: SHORT_VIDEO_SUBTITLE_POSITIONS,
    fonts: SHORT_VIDEO_FONTS,
    defaults: SHORT_VIDEO_DEFAULTS,
    material: {
      maxVideoBytes: MATERIAL_MAX_VIDEO_BYTES,
      maxImageBytes: MATERIAL_MAX_IMAGE_BYTES,
      accept: MATERIAL_EXTS.join(','),
    },
    bgm: {
      maxBytes: BGM_UPLOAD_MAX_BYTES,
      accept: BGM_EXTS.join(','),
    },
  };
}
