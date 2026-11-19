/**
 * 一键成片的"配音 + 字幕 + 画布"选项目录。
 * 音色列表、字幕位置、字体、画布比例抽到这里做唯一数据源。
 */

export const MEDIA_ASPECTS = [
  { value: '9:16', label: '竖屏 9:16', hint: '适合短视频/看点' },
  { value: '16:9', label: '横屏 16:9', hint: '适合横版播放' },
  { value: '1:1', label: '方形 1:1', hint: '适合信息流封面' },
] as const;

export const MEDIA_VOICE_GROUPS: { value: string; label: string; voices: { value: string; label: string }[] }[] = [
  {
    value: 'zh',
    label: '中文',
    voices: [
      { value: 'zh-CN-XiaoxiaoNeural-Female', label: '晓晓（女）' },
      { value: 'zh-CN-XiaoyiNeural-Female', label: '晓伊（女）' },
      { value: 'zh-CN-liaoning-XiaobeiNeural-Female', label: '晓北 · 辽宁（女）' },
      { value: 'zh-CN-shaanxi-XiaoniNeural-Female', label: '晓妮 · 陕西（女）' },
      { value: 'zh-CN-YunxiNeural-Male', label: '云希（男）' },
      { value: 'zh-CN-YunyangNeural-Male', label: '云扬（男）' },
      { value: 'zh-CN-YunjianNeural-Male', label: '云健（男）' },
      { value: 'zh-CN-YunxiaNeural-Male', label: '云夏（男）' },
      { value: 'zh-TW-HsiaoChenNeural-Female', label: '晓臻 · 台湾（女）' },
      { value: 'zh-TW-HsiaoYuNeural-Female', label: '晓雨 · 台湾（女）' },
      { value: 'zh-TW-YunJheNeural-Male', label: '云哲 · 台湾（男）' },
    ],
  },
  {
    value: 'yue',
    label: '粤语',
    voices: [
      { value: 'zh-HK-HiuGaaiNeural-Female', label: '晓佳（女）' },
      { value: 'zh-HK-HiuMaanNeural-Female', label: '晓曼（女）' },
      { value: 'zh-HK-WanLungNeural-Male', label: '云龙（男）' },
    ],
  },
  {
    value: 'en',
    label: '英文',
    voices: [
      { value: 'en-US-JennyNeural-Female', label: 'Jenny（女）' },
      { value: 'en-US-AriaNeural-Female', label: 'Aria（女）' },
      { value: 'en-US-AvaNeural-Female', label: 'Ava（女）' },
      { value: 'en-US-EmmaNeural-Female', label: 'Emma（女）' },
      { value: 'en-US-AnaNeural-Female', label: 'Ana（女）' },
      { value: 'en-US-MichelleNeural-Female', label: 'Michelle（女）' },
      { value: 'en-US-GuyNeural-Male', label: 'Guy（男）' },
      { value: 'en-US-AndrewNeural-Male', label: 'Andrew（男）' },
      { value: 'en-US-ChristopherNeural-Male', label: 'Christopher（男）' },
      { value: 'en-US-EricNeural-Male', label: 'Eric（男）' },
      { value: 'en-US-RogerNeural-Male', label: 'Roger（男）' },
      { value: 'en-US-SteffanNeural-Male', label: 'Steffan（男）' },
      { value: 'en-US-BrianNeural-Male', label: 'Brian（男）' },
      { value: 'en-GB-LibbyNeural-Female', label: 'Libby · 英式（女）' },
      { value: 'en-GB-SoniaNeural-Female', label: 'Sonia · 英式（女）' },
      { value: 'en-GB-MaisieNeural-Female', label: 'Maisie · 英式（女）' },
      { value: 'en-GB-RyanNeural-Male', label: 'Ryan · 英式（男）' },
      { value: 'en-GB-ThomasNeural-Male', label: 'Thomas · 英式（男）' },
    ],
  },
  {
    value: 'ai',
    label: 'AI 配音',
    voices: [
      { value: 'doubao:zh_female_vv_uranus_bigtts', label: 'Vivi · 青年女声' },
      { value: 'doubao:zh_female_xiaohe_uranus_bigtts', label: '小何 · 女声' },
      { value: 'doubao:zh_female_shuangkuaisisi_uranus_bigtts', label: '爽快思思 · 女声' },
      { value: 'doubao:zh_male_m191_uranus_bigtts', label: '云舟 · 男声' },
      { value: 'doubao:zh_male_taocheng_uranus_bigtts', label: '小天 · 男声' },
      { value: 'doubao:zh_male_shaonianzixin_uranus_bigtts', label: '少年梓辛 · 男声' },
    ],
  },
];

export const MEDIA_VOICES = MEDIA_VOICE_GROUPS.flatMap((group) => group.voices);

export const NO_VOICE_NAME = 'no-voice';

export function allVoiceValues(): string[] {
  return [NO_VOICE_NAME, ...MEDIA_VOICES.map((item) => item.value)];
}

export function isAllowedVoice(value: string): boolean {
  return allVoiceValues().includes(value);
}

export const MEDIA_BGM_TYPES = [
  { value: 'random', label: '随机配乐' },
  { value: 'custom', label: '自定义配乐' },
  { value: 'none', label: '无配乐' },
] as const;

export const MEDIA_SUBTITLE_POSITIONS = [
  { value: 'bottom', label: '底部' },
  { value: 'center', label: '居中' },
  { value: 'top', label: '顶部' },
  { value: 'custom', label: '自定义位置' },
] as const;

/**
 * 字幕字体：固定使用随包的思源黑体（resource/fonts，OFL 开源协议，中英文全覆盖），
 * 不依赖部署环境是否装了中文字体。value 对应 media-pipeline/fonts.ts 里的 FONT_FILES key。
 */
export const MEDIA_FONTS = [
  { value: 'regular', label: '思源黑体 · 常规' },
  { value: 'bold', label: '思源黑体 · 加粗' },
] as const;

export const BGM_EXTS = ['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg'] as const;
export const BGM_UPLOAD_MAX_BYTES = 30 * 1024 * 1024;

export function materialExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

export function isAllowedBgm(filename: string): boolean {
  return (BGM_EXTS as readonly string[]).includes(materialExt(filename));
}

/** 配音 + 字幕通用默认值；一键成片的 settings 默认值以此为基础再叠加自己的字段 */
export const NARRATION_DEFAULTS = {
  aspect: '9:16' as const,
  voiceName: 'zh-CN-XiaoxiaoNeural-Female',
  voiceGroup: 'zh' as const,
  voiceVolume: 1,
  voiceRate: 1,
  bgmType: 'random' as const,
  bgmVolume: 1,
  bgmFile: '',
  subtitleEnabled: true,
  subtitlePosition: 'bottom' as const,
  customPosition: 70,
  fontName: 'regular',
  fontSize: 66,
  textForeColor: '#FFFFFF',
  textBackgroundEnabled: false,
  textBackgroundColor: '#000000',
  strokeColor: '#000000',
  strokeWidth: 1.5,
};

export interface NarrationSettings {
  voiceVolume: number;
  voiceRate: number;
  bgmVolume: number;
  bgmFile: string;
  subtitleEnabled: boolean;
  subtitlePosition: string;
  customPosition: number;
  fontName: string;
  fontSize: number;
  textForeColor: string;
  textBackgroundEnabled: boolean;
  textBackgroundColor: string;
  strokeColor: string;
  strokeWidth: number;
}

/** 按 NARRATION_DEFAULTS 补齐缺省字段；两个模块的 mergeSettings 都以此为基础再合并自己的额外字段 */
export function mergeNarrationSettings(input?: Partial<NarrationSettings> | null): NarrationSettings {
  return {
    voiceVolume: input?.voiceVolume ?? NARRATION_DEFAULTS.voiceVolume,
    voiceRate: input?.voiceRate ?? NARRATION_DEFAULTS.voiceRate,
    bgmVolume: input?.bgmVolume ?? NARRATION_DEFAULTS.bgmVolume,
    bgmFile: input?.bgmFile ?? NARRATION_DEFAULTS.bgmFile,
    subtitleEnabled: input?.subtitleEnabled ?? NARRATION_DEFAULTS.subtitleEnabled,
    subtitlePosition: input?.subtitlePosition ?? NARRATION_DEFAULTS.subtitlePosition,
    customPosition: input?.customPosition ?? NARRATION_DEFAULTS.customPosition,
    fontName: input?.fontName ?? NARRATION_DEFAULTS.fontName,
    fontSize: input?.fontSize ?? NARRATION_DEFAULTS.fontSize,
    textForeColor: input?.textForeColor ?? NARRATION_DEFAULTS.textForeColor,
    textBackgroundEnabled: input?.textBackgroundEnabled ?? NARRATION_DEFAULTS.textBackgroundEnabled,
    textBackgroundColor: input?.textBackgroundColor ?? NARRATION_DEFAULTS.textBackgroundColor,
    strokeColor: input?.strokeColor ?? NARRATION_DEFAULTS.strokeColor,
    strokeWidth: input?.strokeWidth ?? NARRATION_DEFAULTS.strokeWidth,
  };
}
