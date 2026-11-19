import { Canvas, GridCell, SubtitleStyle, TextOverlay, TimedCue } from './media-pipeline.types';
import { NarrationSettings } from './media-options';

/**
 * 字幕安全区底部留白比例，移植自 ClipForge 的 video-composer/safe-zone.ts。
 *
 * 竖屏短视频平台（抖音/TikTok/Reels/Shorts）画面底部会被平台 UI（简介/用户名/购物车按钮/
 * 点赞评论栏/进度条）遮挡，字幕烧录进这个区域等于白烧——而烧字幕的价值恰恰是服务约 85%+
 * 静音观看的用户。0.08（旧值）远低于各平台 2026 年的底部 UI 占比（普遍 20%-25%），字幕
 * 经常被挡。本项目两个模块都不叠加"商品卡片"浮层，统一按"无卡片"场景取 0.22（ClipForge
 * 的 CAPTION_SAFE_BOTTOM_RATIO_NOCARD）：既清出主流平台的底部 UI 区，又不会过多侵入画面。
 */
const CAPTION_SAFE_BOTTOM_RATIO = 0.22;

/** 左右各留出的画布比例，避免长句贴边被裁 */
const SIDE_PAD_RATIO = 0.07;

/** 屏上最多两行；超出的按字数把原时间轴拆成连续几页（短视频字幕惯例） */
const MAX_LINES_ON_SCREEN = 2;

/** 把一键成片 settings 里的字幕相关字段转成 FfmpegService 认识的 SubtitleStyle */
export function buildSubtitleStyle(settings: NarrationSettings): SubtitleStyle {
  return {
    position: settings.subtitlePosition as SubtitleStyle['position'],
    customPosition: settings.customPosition,
    fontKey: settings.fontName,
    fontSize: settings.fontSize,
    foreColor: settings.textForeColor,
    backgroundEnabled: settings.textBackgroundEnabled,
    backgroundColor: settings.textBackgroundColor,
    strokeColor: settings.strokeColor,
    strokeWidth: settings.strokeWidth,
  };
}

/**
 * 字幕行切分符号，对齐 MoneyPrinterTurbo 的 split_string_by_punctuations：中文逗号/顿号也切，
 * 避免一整段只有句号的口播变成一条超长字幕。
 * ASCII 句点只在「后面是空白或结尾」时切开，避免拆开 3.14。
 */
const LINE_BREAK_RE = /([。！？；，、：,\n]|[.!?;:](?=\s|$))/g;

function isBreakToken(part: string): boolean {
  if (!part) return false;
  if (/^[。！？；，、：,\n]$/.test(part)) return true;
  return /^[.!?;:]$/.test(part);
}

/** 按标点把整篇文案切成"字幕行"（= TTS 对齐的最小单位），空行/纯标点行会被丢弃 */
export function splitScriptIntoLines(script: string): string[] {
  const normalized = script.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const parts = normalized.split(LINE_BREAK_RE);
  const lines: string[] = [];
  let buf = '';
  for (const part of parts) {
    if (!part) continue;
    buf += part;
    if (isBreakToken(part)) {
      const trimmed = buf.trim();
      if (trimmed) lines.push(trimmed);
      buf = '';
    }
  }
  const rest = buf.trim();
  if (rest) lines.push(rest);
  return lines;
}

/** 去掉标点/空白后用于宽松比较；两句话在这个口径下相同即可视为匹配 */
function stripPunct(text: string): string {
  return text.replace(/[，。！？；：、,.!?;:\s]/g, '');
}

/**
 * 把 Edge TTS 返回的词级时间戳聚合成"按句"的字幕行时间戳。
 *
 * 算法：整篇文案送去合成时词与字幕行本就是同一份文本切出来的，因此逐词累加字符数，
 * 每当累加长度达到或超过当前字幕行的（去标点）长度就切出一行、时间戳取该区间内首尾词的起止；
 * 累加到最后如果切出的行数与脚本行数不一致，说明合成引擎丢词/吞字，直接返回 null 让调用方
 * 回退到按比例估算——错位的字幕比没有字幕更糟，宁可降级。
 */
export function buildCuesFromWordBoundaries(lines: string[], wordCues: TimedCue[]): TimedCue[] | null {
  if (!lines.length || !wordCues.length) return null;
  const targets = lines.map((line) => stripPunct(line).length);
  const result: TimedCue[] = [];
  let wordIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const target = Math.max(1, targets[i]);
    const startWordIdx = wordIdx;
    let consumed = 0;
    while (wordIdx < wordCues.length && consumed < target) {
      consumed += stripPunct(wordCues[wordIdx].text).length || 1;
      wordIdx++;
    }
    if (wordIdx <= startWordIdx) {
      if (wordIdx >= wordCues.length) break;
      wordIdx++; // 至少消费一个词，避免死循环
    }
    const slice = wordCues.slice(startWordIdx, wordIdx);
    if (!slice.length) return null;
    result.push({
      text: lines[i],
      startMs: slice[0].startMs,
      endMs: slice[slice.length - 1].endMs,
    });
  }
  // 允许最后一行因为末尾标点/语气词没被词边界完全覆盖，但行数必须对齐，否则时间轴会整体错位
  return result.length === lines.length ? result : null;
}

/** 无词级时间戳时（Atlas TTS）按每行字符数占比均分整段音频时长 */
export function buildCuesProportional(lines: string[], totalDurationMs: number): TimedCue[] {
  const weights = lines.map((line) => Math.max(1, stripPunct(line).length));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let cursor = 0;
  return lines.map((line, i) => {
    const startMs = cursor;
    const durationMs = (weights[i] / total) * totalDurationMs;
    cursor += durationMs;
    return { text: line, startMs, endMs: cursor };
  });
}

/** ffmpeg 滤镜里路径的 `:` 会被当成选项分隔符，Windows 盘符路径必须转义并统一用正斜杠 */
export function escapeFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:');
}

function colorWithAlpha(hex: string, alpha: number): string {
  const normalized = hex.startsWith('#') ? hex : `#${hex}`;
  return `${normalized}@${alpha}`;
}

/** 字幕/浮层纵向定位：返回 drawtext 的 y 表达式 */
function resolveY(position: SubtitleStyle['position'] | TextOverlay['position'], customPosition: number): string {
  switch (position) {
    case 'top':
      return 'h*0.06';
    case 'center':
      return '(h-text_h)/2';
    case 'custom':
      return `h*${(customPosition / 100).toFixed(3)}-text_h/2`;
    case 'bottom':
    default:
      return `h-text_h-h*${CAPTION_SAFE_BOTTOM_RATIO}`;
  }
}

export interface DrawtextFile {
  /** 落盘到临时目录的文本文件路径（drawtext 用 textfile= 引用，规避 text= 的多层转义坑） */
  path: string;
  content: string;
}

/** 当前字号下，一条字幕在画布里可用的最大像素宽度（左右边距 + 描边/背景盒） */
export function maxSubtitlePixelWidth(canvasWidth: number, style: SubtitleStyle): number {
  const pad = canvasWidth * SIDE_PAD_RATIO * 2;
  const box = style.backgroundEnabled ? 24 : 0;
  const stroke = Math.max(0, style.strokeWidth) * 2;
  return Math.max(style.fontSize * 4, canvasWidth - pad - box - stroke);
}

/** 中文约 1em，拉丁约 0.55em；只用于换行估算，不要求像素级精确 */
function glyphWidth(ch: string, fontSize: number): number {
  if (ch === ' ' || ch === '\t') return fontSize * 0.33;
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x7f) return fontSize * 0.55;
  return fontSize;
}

function estimateWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of [...text]) width += glyphWidth(ch, fontSize);
  return width;
}

/** 中文按字切，英文按词切，避免把 hello 从中间断开 */
function tokenizeForWrap(text: string): string[] {
  return text.match(/[\u3400-\u9fff]|[\u3040-\u30ff]|[\uff00-\uffef]|[A-Za-z0-9']+|[\s]+|./g) ?? [...text];
}

/**
 * 按画布像素宽度换行。单字/单词本身比行宽还长时退化为逐字切，保证不会画出画面。
 */
export function wrapToWidth(text: string, maxWidth: number, fontSize: number): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const tokens = tokenizeForWrap(normalized);
  const lines: string[] = [];
  let current = '';
  let currentW = 0;

  const flush = () => {
    const trimmed = current.replace(/\s+$/g, '');
    if (trimmed) lines.push(trimmed);
    current = '';
    currentW = 0;
  };

  const appendToken = (token: string) => {
    let piece = current ? token : token.replace(/^\s+/g, '');
    if (!piece) return;
    let width = estimateWidth(piece, fontSize);
    if (current && currentW + width > maxWidth) {
      flush();
      piece = piece.replace(/^\s+/g, '');
      if (!piece) return;
      width = estimateWidth(piece, fontSize);
    }
    if (!current && width > maxWidth) {
      for (const ch of [...piece]) {
        const cw = glyphWidth(ch, fontSize);
        if (current && currentW + cw > maxWidth) flush();
        current += ch;
        currentW += cw;
      }
      return;
    }
    current += piece;
    currentW += width;
  };

  for (const token of tokens) appendToken(token);
  flush();
  return lines;
}

/**
 * 把一条（或一组）字幕排成「每页最多两行」的 TimedCue。
 * 超出两行的按去标点字数比例切分原时间轴，避免竖屏上字幕块又高又宽、顶出画面。
 */
export function layoutSubtitleCues(cues: TimedCue[], canvas: Canvas, style: SubtitleStyle): TimedCue[] {
  const maxWidth = maxSubtitlePixelWidth(canvas.width, style);
  const result: TimedCue[] = [];
  for (const cue of cues) {
    const lines = wrapToWidth(cue.text, maxWidth, style.fontSize);
    if (!lines.length) continue;
    const pages: string[][] = [];
    for (let i = 0; i < lines.length; i += MAX_LINES_ON_SCREEN) {
      pages.push(lines.slice(i, i + MAX_LINES_ON_SCREEN));
    }
    if (pages.length === 1) {
      result.push({ text: pages[0].join('\n'), startMs: cue.startMs, endMs: cue.endMs });
      continue;
    }
    const weights = pages.map((page) => Math.max(1, stripPunct(page.join('')).length));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const span = Math.max(200, cue.endMs - cue.startMs);
    let cursor = cue.startMs;
    pages.forEach((page, i) => {
      const endMs = i === pages.length - 1 ? cue.endMs : cursor + (weights[i] / total) * span;
      result.push({ text: page.join('\n'), startMs: cursor, endMs });
      cursor = endMs;
    });
  }
  return result;
}

/**
 * 构建字幕烧录的 drawtext 滤镜链 + 需要写到磁盘的文本文件清单。
 * 每条字幕对应一个 drawtext + 一个 textfile（内容=该行文本），靠 enable='between(t,start,end)' 卡时间窗，
 * 比起把文本内联进滤镜字符串（需要同时处理 filtergraph 转义与 drawtext 自身转义两层规则）更稳妥。
 */
export function buildSubtitleFilter(
  cues: TimedCue[],
  style: SubtitleStyle,
  fontFilePath: string,
  workDir: string,
  canvas: Canvas,
): { filterParts: string[]; files: DrawtextFile[] } {
  const laidOut = layoutSubtitleCues(cues, canvas, style);
  const fontEsc = escapeFilterPath(fontFilePath);
  const files: DrawtextFile[] = [];
  const filterParts: string[] = [];
  const boxPart = style.backgroundEnabled ? `:box=1:boxcolor=${colorWithAlpha(style.backgroundColor, 0.55)}:boxborderw=12` : '';
  const strokePart = style.strokeWidth > 0 ? `:borderw=${style.strokeWidth}:bordercolor=${colorWithAlpha(style.strokeColor, 1)}` : '';
  const y = resolveY(style.position, style.customPosition);
  const lineSpacing = Math.max(4, Math.round(style.fontSize * 0.12));

  laidOut.forEach((cue, i) => {
    const filePath = `${workDir}/sub-${i}.txt`;
    files.push({ path: filePath, content: cue.text });
    const start = (cue.startMs / 1000).toFixed(3);
    const end = Math.max(cue.endMs, cue.startMs + 200) / 1000;
    filterParts.push(
      `drawtext=fontfile='${fontEsc}':textfile='${escapeFilterPath(filePath)}':fontsize=${style.fontSize}` +
        `:fontcolor=${colorWithAlpha(style.foreColor, 1)}${strokePart}${boxPart}` +
        `:x=(w-text_w)/2:y=${y}:line_spacing=${lineSpacing}:fix_bounds=1:enable='between(t,${start},${end.toFixed(3)})'`,
    );
  });
  return { filterParts, files };
}

/** 固定时间区间的文本浮层（AIGC 标识/结尾 CTA），与字幕共用同一套 textfile 落盘方式 */
export function buildOverlayFilter(
  overlay: TextOverlay,
  fontFilePath: string,
  workDir: string,
  index: number,
): { filterPart: string; file: DrawtextFile } {
  const filePath = `${workDir}/overlay-${index}.txt`;
  const file: DrawtextFile = { path: filePath, content: overlay.text };
  const boxPart = overlay.backgroundColor ? `:box=1:boxcolor=${colorWithAlpha(overlay.backgroundColor, 0.5)}:boxborderw=10` : '';
  const y = overlay.position === 'top' ? 'h*0.05' : 'h-text_h-h*0.05';
  const filterPart =
    `drawtext=fontfile='${escapeFilterPath(fontFilePath)}':textfile='${escapeFilterPath(filePath)}'` +
    `:fontsize=${overlay.fontSize}:fontcolor=${colorWithAlpha(overlay.foreColor, 1)}${boxPart}` +
    `:x=(w-text_w)/2:y=${y}:fix_bounds=1:enable='between(t,${overlay.startSec.toFixed(3)},${overlay.endSec.toFixed(3)})'`;
  return { filterPart, file };
}

/** 九宫格裁切矩形：行优先编号（第1格=左上），与拼图 prompt 里"第 N 格"的顺序一致 */
export function computeGridCells(canvas: Canvas, rows: number, cols: number, insetRatio = 0.02): GridCell[] {
  const cellW = canvas.width / cols;
  const cellH = canvas.height / rows;
  const insetX = Math.round(cellW * insetRatio);
  const insetY = Math.round(cellH * insetRatio);
  const cells: GridCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        x: Math.round(c * cellW) + insetX,
        y: Math.round(r * cellH) + insetY,
        w: Math.round(cellW) - insetX * 2,
        h: Math.round(cellH) - insetY * 2,
      });
    }
  }
  return cells;
}
