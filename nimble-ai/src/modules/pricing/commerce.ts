/**
 * 各平台刊例价。视频售价 = 用户所选规格的官方价 × 售价系数。
 */

const SEEDANCE_FPS = 24;

/** 方舟 Seedance 2.5 文档里的输出像素。9:16 与 16:9 像素数相同 */
const SEEDANCE_PIXELS: Record<string, Record<string, [number, number]>> = {
  '480p': {
    '16:9': [854, 480],
    '4:3': [752, 560],
    '1:1': [640, 640],
    '3:4': [560, 752],
    '9:16': [480, 854],
    '21:9': [992, 432],
  },
  '720p': {
    '16:9': [1280, 720],
    '4:3': [1112, 834],
    '1:1': [960, 960],
    '3:4': [834, 1112],
    '9:16': [720, 1280],
    '21:9': [1470, 630],
  },
  '1080p': {
    '16:9': [1920, 1080],
    '4:3': [1664, 1248],
    '1:1': [1440, 1440],
    '3:4': [1248, 1664],
    '9:16': [1080, 1920],
    '21:9': [2206, 946],
  },
};

/** 附加处理单价，元/分钟。≤30fps；更高帧率按系数翻倍 */
const ENHANCE_YUAN_PER_MIN: Record<string, number> = {
  '720p': 2.5,
  '1080p': 5,
  '2k': 10,
  '4k': 20,
};

/** 国内 MiniMax-H3 刊例价，元/秒。输入视频与输出同价 */
const MINIMAX_CNY_PER_SEC: Record<string, number> = {
  '768P': 0.5,
  '2K': 0.8,
};

/** 北京时间工作日 09:00–12:00、14:00–18:00 */
export function isArkPeak(at = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const workday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
  return workday && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18));
}

/** DeepSeek-V4.1-Flash 方舟刊例价，元 / 百万 token。按请求发生时的高峰/空闲取档 */
export function arkTextRates(model: string, at = new Date()): { input: number; output: number; cache: number } | null {
  if (model !== 'deepseek-v4-1-flash-261017') return null;
  return isArkPeak(at)
    ? { input: 2, output: 8, cache: 0.04 }
    : { input: 1, output: 4, cache: 0.02 };
}

/** 方舟 Seedance 刊例价，元 / 百万 token，取值为 [输入不含视频, 输入含视频] */
const SEEDANCE_RATES: Record<string, Record<string, [number, number]>> = {
  'seedance-2.5': { '480p': [70, 42], '720p': [70, 42], '1080p': [77, 46] },
  'seedance-2.5-flash': { '480p': [46, 28], '720p': [46, 28] },
};

/** productId 是模型目录里的 id，用来区分旗舰版和 Flash 的单价 */
export function seedanceCny(productId: string, resolution: string, ratio: string, outputSec: number, inputVideoSec: number): number {
  const rates = SEEDANCE_RATES[productId]?.[resolution];
  const table = SEEDANCE_PIXELS[resolution];
  const pair = table?.[ratio] ?? table?.['16:9'];
  if (!rates || !pair) throw new Error(`未知的视频规格 ${productId} ${resolution}`);
  const [width, height] = pair;
  const tokens = ((Math.max(0, inputVideoSec) + outputSec) * width * height * SEEDANCE_FPS) / 1024;
  const perMillion = rates[inputVideoSec > 0 ? 1 : 0];
  return (tokens / 1_000_000) * perMillion;
}

/** 附加处理费用，元。不传帧率时按 24fps */
export function enhanceCny(target: string, durationSec: number, fps = 24): number {
  const perMin = ENHANCE_YUAN_PER_MIN[target.toLowerCase()];
  if (perMin == null) return 0;
  const factor = fps <= 30 ? 1 : fps <= 60 ? 2 : 4;
  return (durationSec / 60) * perMin * factor;
}

/** 国内 MiniMax-H3 刊例价，元。前 5 张参考图免费，之后每张 0.20 元，与分辨率无关；音频免费 */
export function minimaxCny(resolution: string, outputSec: number, inputVideoSec: number, inputImageCount: number): number {
  const perSec = MINIMAX_CNY_PER_SEC[resolution.toUpperCase()] ?? MINIMAX_CNY_PER_SEC['768P'];
  const images = Math.max(0, inputImageCount - 5) * 0.2;
  return (outputSec + Math.max(0, inputVideoSec)) * perSec + images;
}

/** Seedream 5.0 Pro：1.5K 及以下 0.30 元/张，以上 0.60；第 2 张参考图起 0.02 元/张 */
export function seedreamCny(pixels: number, imageCount: number): number {
  const output = pixels > 2_610_000 ? 0.6 : 0.3;
  return output + Math.max(0, imageCount - 1) * 0.02;
}

export function pixelsOf(size: string): number {
  const [width, height] = size.split(/[x*]/i).map((part) => Number(part));
  if (!width || !height) return 0;
  return width * height;
}

/** 豆包语音合成 2.0：3 元 / 万字符 */
export function doubaoTtsCny(chars: number): number {
  return (Math.max(0, chars) / 10_000) * 3;
}
