/**
 * 媒体生成公共类型
 *
 * 一键成片使用同一套"配音 + 字幕 + 合成"基础设施。
 * 这里只放跨模块共享的数据形状；业务模块自己的表单/实体字段（如 short-video.options.ts）
 * 仍按自己的命名保留，调用 media-pipeline 前转换一次即可。
 */

/** 一段有起止时间的文本片段：TTS 词级时间戳、按句聚合后的字幕行，形状相同，故复用同一类型 */
export interface TimedCue {
  text: string;
  startMs: number;
  endMs: number;
}

/** 配音合成结果：音频字节 + （若能拿到）词级时间戳，用于对齐字幕 */
export interface TtsResult {
  audio: Buffer;
  mimeType: string;
  /** 解码后的真实时长（ffprobe 结果），字幕/合成时长以此为准，而非词时间戳的最后一个结束点 */
  durationSec: number;
  /** 免费 Edge 有词级时间戳；Atlas TTS 无该数据时为空数组，由调用方走比例回退对齐 */
  wordCues: TimedCue[];
}

/** 画布尺寸（像素），由目标画面比例决定 */
export interface Canvas {
  width: number;
  height: number;
}

export type FitMode = 'cover' | 'contain';

/** 字幕烧录样式：字段与 short-video.options.ts 的 ShortVideoSettings 子集一一对应，供 drawtext 滤镜使用 */
export interface SubtitleStyle {
  position: 'bottom' | 'center' | 'top' | 'custom';
  /** position=custom 时生效：字幕基线的纵向位置，0-100，表示距顶部的百分比 */
  customPosition: number;
  /** resource/fonts 下的字体 key，见 FONT_FILES */
  fontKey: string;
  fontSize: number;
  foreColor: string;
  backgroundEnabled: boolean;
  backgroundColor: string;
  strokeColor: string;
  strokeWidth: number;
}

/** 固定时间区间的文本浮层（AIGC 标识、结尾 CTA 等），复用字幕的 drawtext 绘制逻辑 */
export interface TextOverlay {
  text: string;
  startSec: number;
  endSec: number;
  fontSize: number;
  foreColor: string;
  backgroundColor?: string;
  position: 'top' | 'bottom';
}

export interface ClipPrepareResult {
  path: string;
  durationSec: number;
}

export interface GridCell {
  x: number;
  y: number;
  w: number;
  h: number;
}
