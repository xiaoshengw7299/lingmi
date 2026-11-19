/**
 * 视频工具 / 通用工具目录。每个工具在这里声明一次：上游接口、输入、可调参数、计价和结果字段。
 * 后端按它校验参数、拼请求、算价、收结果；前端按它渲染表单。增删工具只改这个文件。
 */

export type ToolGroup = 'video' | 'general';
export type InputKind = 'video' | 'audio' | 'image' | 'subtitle';
export type OutputKind = 'video' | 'image' | 'audio' | 'file';

/** 浏览器直传到 MediaKit 后提交的文件。时长、宽高由浏览器读出，完成后再用上游返回的计费时长补差 */
export interface InputFile {
  fileId: string;
  name: string;
  kind: InputKind;
  durationSec?: number;
  width?: number;
  height?: number;
}

export interface ToolContext {
  inputs: Record<string, InputFile[]>;
  values: Record<string, unknown>;
  /** record 类参数引用的历史记录的 data */
  records: Record<string, Record<string, unknown>>;
}

export interface ToolInput {
  key: string;
  label: string;
  kinds: InputKind[];
  /** 上游字段，支持点路径；`{kind}` 按文件类型替换，如 `{kind}_url` */
  field: string;
  /** 大于 1 时上游字段是数组 */
  max?: number;
  optional?: boolean;
  hint?: string;
  maxDurationSec?: number;
  accept?: string;
}

export interface ToolChoice {
  value: string | number;
  label: string;
}

export interface ToolOption {
  key: string;
  label: string;
  type: 'select' | 'switch' | 'number' | 'slider' | 'text' | 'textarea' | 'boxes' | 'mask' | 'tags' | 'pairs' | 'record';
  /** 上游字段（点路径），缺省同 key；false 表示不直接下发，由 build 处理 */
  field?: string | false;
  choices?: ToolChoice[];
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  maxLength?: number;
  maxItems?: number;
  placeholder?: string;
  help?: string;
  required?: boolean;
  advanced?: boolean;
  /** 只在这些参数取这些值时显示和下发 */
  when?: Record<string, unknown[]>;
  /** record：从哪个工具的成功记录里选 */
  recordTool?: string;
  /** 文本快捷填充 */
  presets?: string[];
}

export interface ToolPrice {
  unit: '分钟' | '张' | '次';
  /** 官方刊例价，元 / unit。管理员可在定价页手填覆盖 */
  official: number;
  basis: string;
  /** 提交时预扣的用量（单位数，含规格系数） */
  quantity: (ctx: ToolContext) => number;
  /** 完成后的实际用量。比预扣多时补扣差额 */
  actual?: (result: Result, ctx: ToolContext) => number;
}

export interface RawOutput {
  kind: OutputKind;
  url: string;
  label: string;
  ext?: string;
  /** 下载后转 H.264，HEVC 浏览器放不出来 */
  h264?: boolean;
  gunzip?: boolean;
}

export interface ToolMode {
  id: string;
  label: string;
  desc?: string;
  /** tools/<name> 异步；tools-sync/<name> 同步 */
  path: string;
  /** 支持 media_output_destination 写回本桶 */
  tos?: boolean;
  inputs: ToolInput[];
  options: ToolOption[];
  price: ToolPrice;
  fixed?: Record<string, unknown>;
  build?: (body: Record<string, unknown>, ctx: ToolContext) => void;
  check?: (ctx: ToolContext) => string | undefined;
  outputs: (result: Result) => RawOutput[];
  data?: (result: Result) => Record<string, unknown> | undefined;
  /** 上游报成功但结果无效时返回失败原因，按失败处理并退款 */
  verify?: (result: Result) => string | undefined;
}

/** 介绍、场景和效果示例在 media-tools.content.ts，这里只管接口和计价 */
export interface ToolDef {
  id: string;
  group: ToolGroup;
  name: string;
  icon: string;
  summary: string;
  modes: ToolMode[];
}

type Result = Record<string, any>;

// ───────────────────────── 计价与结果的小工具 ─────────────────────────

const sec = (list?: InputFile[]) => (list ?? []).reduce((sum, file) => sum + Math.max(0, file.durationSec ?? 0), 0);
const min = (seconds: unknown) => Math.max(0, Number(seconds) || 0) / 60;
const inputMin = (key = 'video') => (ctx: ToolContext) => min(sec(ctx.inputs[key]));
const resultMin = (field = 'duration') => (result: Result) => min(result[field]);
const shortSide = (file?: InputFile) => (file?.width && file?.height ? Math.min(file.width, file.height) : 1080);
const single = (kind: OutputKind, field: string, label: string) => (result: Result): RawOutput[] =>
  result[field] ? [{ kind, url: String(result[field]), label }] : [];
const listOf = (kind: OutputKind, list: unknown, label: (i: number, item: any) => string, field = 'video_url'): RawOutput[] =>
  (Array.isArray(list) ? list : [])
    .map((item, i) => ({ kind, url: String(typeof item === 'string' ? item : item?.[field] ?? ''), label: label(i, item) }))
    .filter((item) => item.url);
const sumDuration = (list: unknown) => (Array.isArray(list) ? list : []).reduce((s: number, item: any) => s + (Number(item?.duration) || 0), 0);

const TEMPLATE_CHOICES: ToolChoice[] = [
  { value: 'none', label: '不加包装' },
  ...[1, 2, 3, 4, 5].map((n) => ({ value: `热门短剧${n}`, label: `热门短剧 ${n}` })),
];

const WITH_TEMPLATE = { template: TEMPLATE_CHOICES.slice(1).map((c) => c.value) };

/** 短剧三要素包装：剧名 / 角标 / 提示语 */
const templateOptions = (): ToolOption[] => [
  { key: 'template', label: '短剧包装', type: 'select', field: false, choices: TEMPLATE_CHOICES, default: 'none', help: '加剧名、角标和提示语，提升投放点击率' },
  { key: 'title', label: '剧名', type: 'text', field: false, maxLength: 22, placeholder: '《我的霸总男友》', when: WITH_TEMPLATE },
  { key: 'hint', label: '提示语', type: 'text', field: false, maxLength: 20, placeholder: '点击下方看完整版', when: WITH_TEMPLATE },
];

function applyTemplate(body: Record<string, unknown>, ctx: ToolContext) {
  const template = String(ctx.values.template ?? 'none');
  if (template === 'none') return;
  body.edit_param = {
    mode: 'TemplateEdit',
    template_edit: { template, ...(ctx.values.title ? { title: ctx.values.title } : {}), ...(ctx.values.hint ? { hint: ctx.values.hint } : {}) },
  };
}

const RANGE_CHOICES: ToolChoice[] = [
  { value: '30-90', label: '30 – 90 秒' },
  { value: '60-180', label: '1 – 3 分钟' },
  { value: '180-300', label: '3 – 5 分钟' },
  { value: '300-420', label: '5 – 7 分钟' },
];
const range = (value: unknown) => String(value ?? '60-180').split('-').map(Number) as [number, number];

const VIDEO_FORMATS = 'mp4、mov、mkv、avi、flv、ts、wmv';
const CANVAS_RATIO: Record<string, [number, number]> = { '1:1': [1, 1], '9:16': [9, 16], '16:9': [16, 9] };
const evenSide = (n: number) => Math.round(n / 2) * 2;
const MEDIA_FIELD = '{kind}_url';

// ───────────────────────── 视频工具 ─────────────────────────

const VIDEO_TOOLS: ToolDef[] = [
  {
    id: 'viral-clone',
    group: 'video',
    name: '爆款复刻',
    icon: 'MagicStick',
    summary: '提取爆款视频的动作和运镜，一键生成同款新视频',
    modes: [
      {
        id: 'default',
        label: '动作捕捉',
        path: 'tools/video-depth',
        inputs: [{ key: 'video', label: '爆款视频', kinds: ['video'], field: 'video_url', maxDurationSec: 30, hint: `${VIDEO_FORMATS}，不超过 30 秒、2K` }],
        options: [],
        price: { unit: '分钟', official: 0.1, basis: '按视频时长', quantity: inputMin(), actual: resultMin() },
        outputs: (r) => (r.video_url ? [{ kind: 'video', url: String(r.video_url), label: '动作视频', h264: true }] : []),
        data: (r) => ({ durationSec: Number(r.duration) || undefined }),
      },
    ],
  },
  {
    id: 'erase-subtitle',
    group: 'video',
    name: '字幕擦除',
    icon: 'Brush',
    summary: '自动识别并无痕擦除视频里的硬字幕、水印和台标',
    modes: [
      {
        id: 'pro',
        label: '精细化版',
        desc: '无痕修复，细节更完整',
        path: 'tools/erase-video-subtitle-pro',
        tos: true,
        inputs: [{ key: 'video', label: '视频', kinds: ['video'], field: 'video_url', hint: `${VIDEO_FORMATS}，最高 2K` }],
        options: [
          { key: 'mode', label: '擦除对象', type: 'select', choices: [{ value: 'Subtitle', label: '字幕（画面下半部分）' }, { value: 'Text', label: '全画面文字' }], default: 'Subtitle' },
          { key: 'erase_ratio_location', label: '指定擦除区域', type: 'boxes', maxItems: 20, help: '可选。在首帧上框选水印、台标等固定位置；选「字幕」时只擦框内的下半部分' },
          { key: 'model_version', label: '算法版本', type: 'select', choices: [{ value: 'v5', label: 'V5 · 更快、闪烁更少' }, { value: 'v5.6', label: 'V5.6 · 多语种、画面更稳' }, { value: 'v4', label: 'V4 · 经典版' }], default: 'v5' },
          { key: 'max_text_height_ratio', label: '字幕最大高度', type: 'slider', field: 'subtitle_filter.max_text_height_ratio', min: 0.05, max: 0.3, step: 0.01, default: 0.1, help: '字幕偏大擦不掉时调高', advanced: true, when: { mode: ['Subtitle'] } },
          { key: 'output_encode_mode', label: '输出画质', type: 'select', choices: [{ value: 'Quality', label: '画质优先' }, { value: 'Size', label: '体积接近原片' }], default: 'Quality', advanced: true },
        ],
        price: { unit: '分钟', official: 1, basis: '按视频时长', quantity: inputMin(), actual: resultMin() },
        outputs: single('video', 'video_url', '擦除后视频'),
      },
      {
        id: 'standard',
        label: '标准版',
        desc: '速度快、价格低',
        path: 'tools/erase-video-subtitle',
        tos: true,
        inputs: [{ key: 'video', label: '视频', kinds: ['video'], field: 'video_url', hint: `${VIDEO_FORMATS}，最高 2K` }],
        options: [],
        price: { unit: '分钟', official: 0.4, basis: '按视频时长', quantity: inputMin(), actual: resultMin() },
        outputs: single('video', 'video_url', '擦除后视频'),
      },
    ],
  },
  {
    id: 'transcode',
    group: 'video',
    name: '视频转码',
    icon: 'Switch',
    summary: '转换编码、分辨率、帧率和封装格式',
    modes: [
      {
        id: 'default',
        label: '转码',
        path: 'tools/transcode-video',
        tos: true,
        inputs: [{ key: 'video', label: '视频', kinds: ['video'], field: 'video_url', hint: VIDEO_FORMATS }],
        options: [
          { key: 'codec', label: '编码', type: 'select', field: 'video.codec', choices: [{ value: 'h264', label: 'H.264 · 兼容性最好' }, { value: 'h265', label: 'H.265 · 体积更小' }], default: 'h264' },
          { key: 'resolution', label: '分辨率', type: 'select', field: false, choices: [{ value: 'source', label: '与原片一致' }, { value: 480, label: '480P' }, { value: 720, label: '720P' }, { value: 1080, label: '1080P' }, { value: 1440, label: '2K' }, { value: 2160, label: '4K' }], default: 'source' },
          { key: 'canvas', label: '画面比例', type: 'select', field: false, choices: [{ value: 'keep', label: '保持原比例' }, { value: '1:1', label: '1:1 方形' }, { value: '9:16', label: '9:16 竖屏' }, { value: '16:9', label: '16:9 横屏' }], default: 'keep', help: '改比例时画面完整保留，不足的部分补黑边，不裁切、不拉伸' },
          { key: 'fps', label: '最高帧率', type: 'select', field: false, choices: [{ value: 0, label: '与原片一致' }, { value: 24, label: '24 fps' }, { value: 25, label: '25 fps' }, { value: 30, label: '30 fps' }, { value: 60, label: '60 fps' }], default: 0 },
          { key: 'container_format', label: '封装格式', type: 'select', choices: [{ value: 'MP4', label: 'MP4' }, { value: 'FLV', label: 'FLV' }, { value: 'MPEGTS', label: 'TS' }], default: 'MP4' },
          { key: 'crf', label: '画质（CRF）', type: 'slider', field: 'video.bitrate_crf', min: 18, max: 35, step: 1, default: 25, help: '越小画质越高、体积越大', advanced: true },
        ],
        build: (body, ctx) => {
          const video = (body.video ??= {}) as Record<string, unknown>;
          const short = Number(ctx.values.resolution);
          const canvas = CANVAS_RATIO[String(ctx.values.canvas)];
          if (canvas) {
            const side = evenSide(short || Math.min(shortSide(ctx.inputs.video?.[0]), 1080));
            const [w, h] = canvas;
            const scale = side / Math.min(w, h);
            Object.assign(video, { scale_type: 2, scale_mode: 2, scale_width: evenSide(w * scale), scale_height: evenSide(h * scale) });
          } else if (short) {
            Object.assign(video, { scale_type: 1, scale_short: short });
          }
          const fps = Number(ctx.values.fps);
          if (fps) Object.assign(video, { fps, fps_mode: 'vfr' });
        },
        price: {
          unit: '分钟',
          official: 0.032,
          basis: '按输出时长，720P H.264 为基准',
          quantity: (ctx) => inputMin()(ctx) * transcodeFactor(ctx),
          actual: (r, ctx) => min(r.duration) * transcodeFactor(ctx),
        },
        outputs: single('video', 'video_url', '转码后视频'),
      },
    ],
  },
  {
    id: 'asr',
    group: 'video',
    name: '语音转字幕',
    icon: 'ChatLineSquare',
    summary: '识别视频或音频里的语音，生成带时间轴的字幕',
    modes: [
      {
        id: 'default',
        label: '识别',
        path: 'tools/asr-subtitles',
        inputs: [{ key: 'media', label: '视频或音频', kinds: ['video', 'audio'], field: MEDIA_FIELD, maxDurationSec: 3 * 3600, hint: `${VIDEO_FORMATS}、mp3、m4a、wav，不超过 3 小时` }],
        options: [
          { key: 'language', label: '语言', type: 'select', choices: [{ value: '', label: '自动识别' }, { value: 'cmn-Hans-CN', label: '中文' }, { value: 'eng-US', label: '英语' }, { value: 'spa-ES', label: '西班牙语' }, { value: 'ind-ID', label: '印尼语' }], default: '' },
          { key: 'content_type', label: '内容类型', type: 'select', choices: [{ value: '', label: '自动识别' }, { value: 'speech', label: '说话' }, { value: 'singing', label: '唱歌' }], default: '' },
          { key: 'enable_speaker_info', label: '区分说话人', type: 'switch', default: false },
        ],
        price: { unit: '分钟', official: 0.03, basis: '按音视频时长', quantity: inputMin('media'), actual: resultMin() },
        outputs: () => [],
        data: (r) => ({
          subtitles: (Array.isArray(r.subtitles) ? r.subtitles : []).map((s: any) => ({
            text: String(s.subtitle_text ?? ''),
            start: Number(s.start_time) || 0,
            end: Number(s.end_time) || 0,
            ...(s.speaker != null ? { speaker: s.speaker } : {}),
          })),
        }),
      },
    ],
  },
  {
    id: 'drama-highlights',
    group: 'video',
    name: '高光智剪 · 短剧',
    icon: 'Scissor',
    summary: '理解多集剧情，自动剪出高光混剪和投放素材',
    modes: [
      {
        id: 'default',
        label: '高光混剪',
        path: 'tools/generate-highlights-microdrama',
        tos: true,
        fixed: { mode: 'StorylineCuts' },
        inputs: [{ key: 'videos', label: '剧集视频（按集数顺序）', kinds: ['video'], field: 'video_urls', max: 30, hint: '最多 30 集，累计 45 分钟内' }],
        options: [
          { key: 'cut_mode', label: '剪法', type: 'select', field: 'highlight_cuts_param.cut_mode', choices: [{ value: 'Mixed', label: '混剪 · 精彩优先' }, { value: 'Sequential', label: '顺剪 · 保持剧情顺序' }], default: 'Mixed' },
          { key: 'duration', label: '每条时长', type: 'select', field: false, choices: RANGE_CHOICES, default: '60-180' },
          { key: 'max_number', label: '生成条数', type: 'number', field: 'highlight_cuts_param.max_number', min: 1, max: 10, default: 3 },
          { key: 'opening_hook', label: '精彩前置（开场钩子）', type: 'switch', field: 'opening_hook_param.enable_opening_hook', default: true },
          ...templateOptions(),
          { key: 'highlight_segment_prompt', label: '高光偏好', type: 'textarea', field: 'highlight_cuts_param.highlight_segment_prompt', maxLength: 2000, advanced: true, when: { cut_mode: ['Mixed'] }, placeholder: '- 优先选择：剧情关键节点与情绪爆发。\n- 规避：无关支线和低信息量闲聊。' },
        ],
        build: (body, ctx) => {
          const [low, high] = range(ctx.values.duration);
          Object.assign((body.highlight_cuts_param ??= {}) as object, { min_duration: low, max_duration: high });
          applyTemplate(body, ctx);
        },
        price: {
          unit: '分钟',
          official: 1,
          basis: '按输入时长，成片时长另按 0.06 倍计',
          quantity: inputMin('videos'),
          actual: (r) => min(r.duration) + min(sumDuration(r.mixvideo_info)) * 0.06,
        },
        outputs: (r) => listOf('video', r.mixvideo_info?.length ? r.mixvideo_info : r.video_urls, (i) => `高光 ${i + 1}`),
      },
    ],
  },
  {
    id: 'movie-highlights',
    group: 'video',
    name: '高光智剪 · 影视拆条',
    icon: 'Film',
    summary: '把电影、电视剧拆成多条带标题的精彩短视频',
    modes: [
      {
        id: 'default',
        label: '拆条',
        path: 'tools/generate-highlights-movie',
        tos: true,
        inputs: [{ key: 'video', label: '影视视频', kinds: ['video'], field: 'video_url', maxDurationSec: 180 * 60, hint: '不超过 180 分钟、1080P' }],
        options: [
          { key: 'duration', label: '每条时长', type: 'select', field: false, choices: RANGE_CHOICES, default: '60-180' },
          { key: 'opening_hook', label: '精彩前置（开场钩子）', type: 'switch', field: 'opening_hook_param.is_enabled', default: true },
        ],
        build: (body, ctx) => {
          const [low, high] = range(ctx.values.duration);
          body.highlight_cuts_param = { min_duration: low, max_duration: high };
        },
        price: {
          unit: '分钟',
          official: 1,
          basis: '按输入时长，成片时长另按 0.06 倍计',
          quantity: inputMin(),
          actual: (r) => min(r.input_duration) + min(sumDuration(r.result_cuts_info)) * 0.06,
        },
        outputs: (r) => listOf('video', r.result_cuts_info?.length ? r.result_cuts_info : r.video_urls, (i, item) => item?.title || `片段 ${i + 1}`),
      },
    ],
  },
  {
    id: 'video-matting',
    group: 'video',
    name: '视频抠图',
    icon: 'Crop',
    summary: '人像或绿幕视频一键抠出透明背景',
    modes: (['portrait', 'greenscreen'] as const).map((id) => ({
      id,
      label: id === 'portrait' ? '人像抠图' : '绿幕抠图',
      desc: id === 'portrait' ? '真人出镜视频' : '绿幕拍摄视频',
      path: `tools/matte-${id}-video`,
      tos: true,
      inputs: [{ key: 'video', label: '视频', kinds: ['video'] as InputKind[], field: 'video_url', hint: VIDEO_FORMATS }],
      options: [
        { key: 'format', label: '输出格式', type: 'select', choices: [{ value: 'WEBM', label: 'WEBM · 透明背景' }, { value: 'MOV', label: 'MOV · 透明背景' }, { value: 'MP4', label: 'MP4 · 纯色背景' }], default: 'WEBM' },
        { key: 'background_color', label: '背景颜色', type: 'select', choices: [{ value: 'green', label: '绿色' }, { value: 'black', label: '黑色' }, { value: 'white', label: '白色' }], default: id === 'portrait' ? 'green' : 'black', when: { format: ['MP4'] } },
      ] as ToolOption[],
      price: {
        unit: '分钟',
        official: 1,
        basis: '按输出时长，720P 为基准',
        quantity: (ctx: ToolContext) => inputMin()(ctx) * mattingFactor(ctx),
        actual: (r: Result, ctx: ToolContext) => min(r.duration) * mattingFactor(ctx),
      },
      outputs: single('video', 'video_url', '抠图结果'),
    })),
  },
  {
    id: 'drama-script',
    group: 'video',
    name: '剧本还原',
    icon: 'Document',
    summary: '从剧集视频还原剧情梗概、人物、场景和台词',
    modes: [
      {
        id: 'default',
        label: '还原',
        path: 'tools/drama-script',
        inputs: [{ key: 'videos', label: '剧集视频（按集数顺序）', kinds: ['video'], field: 'video_urls', max: 100, maxDurationSec: 120 * 60, hint: '最多 100 集，分辨率一致' }],
        options: [
          { key: 'output_language', label: '剧本语言', type: 'select', choices: [{ value: 'zh-CN', label: '中文' }, { value: 'en-US', label: '英文' }], default: 'zh-CN' },
        ],
        price: { unit: '分钟', official: 3, basis: '按输入时长', quantity: inputMin('videos'), actual: resultMin() },
        outputs: (r) => (r.result_url ? [{ kind: 'file', url: String(r.result_url), label: '剧本', ext: 'json', gunzip: true }] : []),
        data: (r) => ({ scriptId: r.drama_script_task_id }),
      },
    ],
  },
  {
    id: 'drama-recap',
    group: 'video',
    name: '解说视频生成',
    icon: 'Microphone',
    summary: '自动写解说词、配音、配画面，生成影视解说视频',
    modes: [
      {
        id: 'general',
        label: '通用版',
        desc: '基于剧本还原结果',
        path: 'tools/drama-recap',
        tos: true,
        inputs: [],
        options: [
          { key: 'script', label: '剧本', type: 'record', field: false, recordTool: 'drama-script', required: true, help: '选择一条已完成的剧本还原记录' },
          { key: 'auto', label: 'AI 自动写解说词', type: 'switch', field: 'drama_recap_config.auto_generate_recap', default: true },
          { key: 'style', label: '解说风格', type: 'text', field: 'drama_recap_config.style', maxLength: 50, when: { auto: [true] }, presets: ['悬疑反转', '幽默吐槽', '温情治愈', '爽文逆袭'] },
          { key: 'recap_text', label: '解说词', type: 'textarea', maxLength: 5000, when: { auto: [false] }, required: true },
          { key: 'voice_type', label: '配音音色', type: 'select', field: 'speaker_config.voice_type', choices: ['Yunxi', 'Yunjian', 'Yunfeng', 'Yunyi', 'Yunjie', 'Yunze', 'Yunye', 'Xiaoxiao', 'Xiaochen', 'Xiaohan', 'Xiaomo'].map((v) => ({ value: v, label: v.startsWith('Xiao') ? `${v} · 女声` : `${v} · 男声` })), default: 'Yunxi' },
          { key: 'text_speed', label: '语速', type: 'slider', field: 'drama_recap_config.text_speed', min: 0.5, max: 2, step: 0.1, default: 1.2 },
          { key: 'batch_count', label: '生成条数', type: 'number', min: 1, max: 5, default: 1 },
          { key: 'erase_subtitle', label: '擦除原字幕', type: 'switch', default: false, advanced: true },
        ],
        build: (body, ctx) => {
          body.drama_script_task_id = ctx.records.script?.scriptId;
        },
        price: {
          unit: '分钟',
          official: 0.39,
          basis: '按成片时长',
          quantity: (ctx) => Number(ctx.values.batch_count ?? 1),
          actual: resultMin(),
        },
        outputs: (r) => (r.video_urls?.length ? listOf('video', r.video_urls, (i) => `解说 ${i + 1}`) : single('video', 'video_url', '解说视频')(r)),
      },
      {
        id: 'vertical',
        label: '短剧版',
        desc: '直接输入原片',
        path: 'tools/drama-recap-vertical',
        tos: true,
        inputs: [{ key: 'videos', label: '短剧视频（按集数顺序）', kinds: ['video'], field: 'video_urls', max: 30, hint: '最多 30 集，累计 120 分钟，仅 1080P' }],
        options: [
          { key: 'mode', label: '解说方式', type: 'select', choices: [{ value: 'text', label: '文字解说' }, { value: 'narrate', label: '旁白解说' }], default: 'text' },
          { key: 'max_count', label: '生成条数', type: 'number', min: 1, max: 10, default: 3 },
          { key: 'duration', label: '每条时长', type: 'select', field: false, choices: RANGE_CHOICES, default: '60-180' },
          { key: 'narrate_ratio', label: '解说浓度', type: 'slider', field: 'narrate_options.narrate_ratio', min: 0.1, max: 0.5, step: 0.05, default: 0.3, when: { mode: ['narrate'] } },
          { key: 'erase_subtitle_mode', label: '原字幕处理', type: 'select', field: 'narrate_options.erase_subtitle_mode', choices: [{ value: 'mosaic', label: '打码' }, { value: 'standard', label: '擦除' }], default: 'mosaic', when: { mode: ['narrate'] } },
          { key: 'opening_hook', label: '开场钩子', type: 'select', choices: [{ value: 'auto', label: '自动' }, { value: 'force', label: '总是加' }, { value: 'disable', label: '不加' }], default: 'auto', advanced: true },
          ...templateOptions(),
        ],
        build: (body, ctx) => {
          const [low, high] = range(ctx.values.duration);
          Object.assign(body, { min_duration: low, max_duration: high });
          applyTemplate(body, ctx);
        },
        price: {
          unit: '分钟',
          official: 1.6,
          basis: '按输入时长，成片时长另按 0.23 倍计',
          quantity: inputMin('videos'),
          actual: (r) => min(r.input_duration) + min(r.output_duration) * 0.23,
        },
        outputs: (r) => listOf('video', r.video_infos?.length ? r.video_infos : r.video_urls, (i) => `解说 ${i + 1}`),
      },
    ],
  },
  {
    id: 'extract-frames',
    group: 'video',
    name: '视频抽帧',
    icon: 'Picture',
    summary: '按间隔、场景变化或首尾帧批量截图',
    modes: [
      {
        id: 'default',
        label: '抽帧',
        path: 'tools/extract-frames',
        tos: true,
        inputs: [{ key: 'video', label: '视频', kinds: ['video'], field: 'video_url', hint: VIDEO_FORMATS }],
        options: [
          { key: 'snapshot_type', label: '抽帧方式', type: 'select', choices: [{ value: 'TimeInterval', label: '按时间间隔' }, { value: 'SceneChange', label: '按镜头切换' }, { value: 'First', label: '只要首帧' }, { value: 'Last', label: '只要尾帧' }], default: 'TimeInterval' },
          { key: 'time_interval', label: '间隔', type: 'number', min: 0.1, max: 600, step: 0.5, unit: '秒', default: 1, when: { snapshot_type: ['TimeInterval'] } },
          { key: 'scene_change_threshold', label: '灵敏度', type: 'slider', min: 0.05, max: 0.9, step: 0.05, default: 0.1, help: '越小切得越细', when: { snapshot_type: ['SceneChange'] } },
          { key: 'snapshot_limit', label: '最多张数', type: 'number', min: 1, max: 1000, default: 100, when: { snapshot_type: ['TimeInterval', 'SceneChange'] } },
          { key: 'scale_long', label: '图片长边', type: 'select', choices: [{ value: 0, label: '原始尺寸' }, { value: 1920, label: '1920' }, { value: 1280, label: '1280' }, { value: 720, label: '720' }], default: 0, advanced: true },
        ],
        build: (body) => {
          if (body.snapshot_type === 'First' || body.snapshot_type === 'Last') {
            body.specified_frames = [body.snapshot_type === 'First' ? 0 : -1];
            body.snapshot_type = 'SpecifiedFrames';
          }
          if (!body.scale_long) delete body.scale_long;
        },
        price: {
          unit: '张',
          official: 0.0001,
          basis: '按截图张数',
          quantity: (ctx) => {
            const type = ctx.values.snapshot_type;
            if (type === 'First' || type === 'Last') return 1;
            const limit = Number(ctx.values.snapshot_limit ?? 100);
            if (type !== 'TimeInterval') return limit;
            return Math.min(limit, Math.ceil(sec(ctx.inputs.video) / Math.max(0.1, Number(ctx.values.time_interval ?? 1))) || 1);
          },
          actual: (r) => Number(r.snapshot_count) || (Array.isArray(r.snapshots) ? r.snapshots.length : 0),
        },
        outputs: (r) => listOf('image', r.snapshots, (i) => `帧 ${i + 1}`, 'image_url'),
      },
    ],
  },
  {
    id: 'face-blur',
    group: 'video',
    name: '视频人脸打码',
    icon: 'Hide',
    summary: '自动识别画面中所有人脸并打码',
    modes: [
      {
        id: 'default',
        label: '打码',
        path: 'tools/face-blur-video',
        tos: true,
        inputs: [{ key: 'video', label: '视频', kinds: ['video'], field: 'video_url', maxDurationSec: 600, hint: '不超过 10 分钟，推荐 1080P' }],
        options: [
          { key: 'mask_mode', label: '打码方式', type: 'select', choices: [{ value: 'mosaic', label: '马赛克' }, { value: 'blur', label: '高斯模糊' }], default: 'mosaic' },
          { key: 'mask_strength', label: '遮挡强度', type: 'select', choices: [{ value: 'low', label: '弱' }, { value: 'medium', label: '中' }, { value: 'high', label: '强' }], default: 'medium' },
          { key: 'face_confidence', label: '检测灵敏度', type: 'slider', min: 0.1, max: 1, step: 0.05, default: 0.35, help: '越小越容易把模糊的脸也打上码', advanced: true },
        ],
        price: { unit: '分钟', official: 0.1, basis: '按视频时长', quantity: inputMin(), actual: resultMin() },
        outputs: single('video', 'video_url', '打码后视频'),
      },
    ],
  },
  {
    id: 'face-swap',
    group: 'video',
    name: '视频换脸',
    icon: 'Avatar',
    summary: '把视频里的人脸换成指定照片中的人脸',
    modes: [
      {
        id: 'default',
        label: '换脸',
        path: 'tools/face-swap-video',
        tos: true,
        inputs: [
          { key: 'video', label: '视频', kinds: ['video'], field: 'video_url', maxDurationSec: 600, accept: 'video/mp4', hint: 'MP4，不超过 10 分钟、1080P' },
          { key: 'face', label: '人脸照片', kinds: ['image'], field: 'face_mappings.0.target_face_url', accept: 'image/jpeg,image/png', hint: 'jpg / png 清晰正脸' },
        ],
        options: [],
        price: { unit: '分钟', official: 0.8, basis: '按视频时长', quantity: inputMin(), actual: resultMin() },
        outputs: single('video', 'video_url', '换脸后视频'),
      },
    ],
  },
  {
    id: 'lip-sync',
    group: 'video',
    name: '视频口型对齐',
    icon: 'Mic',
    summary: '让视频里人物的口型匹配新的配音',
    modes: [
      {
        id: 'default',
        label: '对口型',
        path: 'tools/lip-sync',
        tos: true,
        inputs: [
          { key: 'video', label: '人物视频', kinds: ['video'], field: 'video_url', maxDurationSec: 1800, accept: 'video/mp4', hint: 'MP4，单人真人' },
          { key: 'audio', label: '新配音', kinds: ['audio'], field: 'audio_url', hint: 'mp3、wav、m4a、aac、flac' },
        ],
        options: [{ key: 'enable_video_loop', label: '按音频时长输出', type: 'switch', default: false, help: '开启后视频不够长时正放、倒放往复补齐' }],
        price: {
          unit: '分钟',
          official: 1,
          basis: '按输出时长',
          quantity: (ctx) => min(ctx.values.enable_video_loop ? sec(ctx.inputs.audio) : Math.min(sec(ctx.inputs.video), sec(ctx.inputs.audio))),
          actual: resultMin(),
        },
        outputs: single('video', 'video_url', '对口型视频'),
      },
    ],
  },
  {
    id: 'ai-highlights',
    group: 'video',
    name: 'AI 高光剪辑',
    icon: 'Star',
    summary: '大模型看懂视频，按目标时长剪出高光集锦',
    modes: [
      {
        id: 'default',
        label: '高光剪辑',
        path: 'tools/video-highlights-llm',
        tos: true,
        inputs: [{ key: 'videos', label: '视频', kinds: ['video'], field: 'video_urls', max: 20, maxDurationSec: 3 * 3600, hint: '单个不超过 3 小时' }],
        options: [
          { key: 'preset', label: '场景', type: 'select', choices: [{ value: 'custom', label: '自定义标准' }, { value: 'football', label: '足球' }, { value: 'basketball', label: '篮球' }, { value: 'automotive', label: '汽车' }, { value: 'finance', label: '财经' }, { value: 'product_launch', label: '发布会' }, { value: 'ecommerce', label: '电商带货' }, { value: 'knowledge_share', label: '知识分享' }, { value: 'short_drama', label: '短剧' }], default: 'ecommerce' },
          { key: 'scoring_prompt', label: '高光标准', type: 'textarea', maxLength: 5000, when: { preset: ['custom'] }, required: true, placeholder: '例如：优先选择产品特写、价格讲解和用户试用反馈的片段' },
          { key: 'target_duration', label: '目标时长', type: 'tags', min: 5, max: 3600, maxItems: 5, unit: '秒', default: [60], help: '每个时长生成一条成片' },
          { key: 'story_prompt', label: '编排要求', type: 'textarea', maxLength: 2000, advanced: true, placeholder: '例如：按时间顺序，结尾放最精彩的片段' },
          { key: 'output_language', label: '标题语言', type: 'select', choices: [{ value: 'zh-CN', label: '中文' }, { value: 'en-US', label: '英文' }], default: 'zh-CN', advanced: true },
        ],
        build: (body) => {
          if (body.preset === 'custom') delete body.preset;
        },
        price: {
          unit: '分钟',
          official: 0.8,
          basis: '按输入时长 + 成片时长',
          quantity: (ctx) => inputMin('videos')(ctx) + min((ctx.values.target_duration as number[] | undefined)?.reduce((s, n) => s + n, 0)),
          actual: resultMin(),
        },
        outputs: (r) => listOf('video', r.outputs, (i, item) => `${item?.target_duration ?? ''} 秒高光`),
        data: (r) => ({
          segments: (Array.isArray(r.outputs) ? r.outputs : []).map((o: any) => (o.segments ?? []).map((s: any) => ({ title: s.title, summary: s.summary }))),
        }),
      },
    ],
  },
  {
    id: 'reframe-vertical',
    group: 'video',
    name: '视频横转竖',
    icon: 'Iphone',
    summary: '横屏视频智能跟随主体，转成 9:16 竖屏',
    modes: [
      {
        id: 'default',
        label: '横转竖',
        path: 'tools/reframe-video-to-vertical',
        tos: true,
        inputs: [
          { key: 'video', label: '横屏视频', kinds: ['video'], field: 'video_url', maxDurationSec: 4 * 3600, hint: 'MP4、MOV、MKV、AVI、FLV' },
          { key: 'subtitle', label: '字幕文件（可选）', kinds: ['subtitle'], field: 'subtitle_url', optional: true, accept: '.srt,.ass', hint: 'SRT / ASS，会烧录进画面' },
        ],
        options: [],
        price: { unit: '分钟', official: 0.3, basis: '按视频时长', quantity: inputMin(), actual: resultMin() },
        outputs: single('video', 'video_url', '竖屏视频'),
      },
    ],
  },
];

// ───────────────────────── 通用工具 ─────────────────────────

const IMAGE_HINT = 'png、jpg、webp，不超过 10MB';

/** 电商万创标准版预设场景 */
const PRODUCT_SCENES: ToolChoice[] = Object.entries({
  exhibit_simple: '极简展台', exhibit_home: '家居桌面', exhibit_kitchen: '厨房餐桌', exhibit_bathroom: '洗漱桌面', exhibit_light: '纯色光影',
  exhibit_luxury: '奢华展台', exhibit_modern: '现代风景台', exhibit_stone: '植物岩石展台', exhibit_forest: '森林植物', exhibit_floor: '家居地面',
  exhibit_toy: '玩具展台', exhibit_liquor: '洋酒展台', exhibit_wine: '葡萄酒展台', exhibit_beer: '其他酒类展台', natural_pasture: '乡村牧场',
  water_reflect: '水面光影', water_plants: '水面植物', water_ripples: '水面波纹', glisten_dew: '光台凝露', spring_rock: '晶屿谧芳',
  dawn_silk: '雾纱晨礼', flower_rock: '粉屿谧绽', origem_drop: '露屿青珀', sunrise_bake: '椰芝晨光', sea_crunch: '浪味鲜踪',
  onyx_flow: '墨带智音', joy_pack: '粉樱密语', drug_moss: '苔蕴健萃', toy_mat: '萌玩倚毯', coast_nut: '碧海果语', general: '自定义（英文描述）',
}).map(([value, label]) => ({ value, label }));
const imageResult = (label: string) => single('image', 'image_url', label);
const each = (official: number): ToolPrice => ({ unit: '次', official, basis: '按次', quantity: () => 1 });

const GENERAL_TOOLS: ToolDef[] = [
  {
    id: 'erase-image',
    group: 'general',
    name: '图像擦除修复',
    icon: 'Brush',
    summary: '擦除图片里的文字、图标或任意涂抹区域',
    modes: [
      {
        id: 'default',
        label: '擦除',
        path: 'tools-sync/erase-image',
        inputs: [{ key: 'image', label: '图片', kinds: ['image'], field: 'image_url', hint: IMAGE_HINT }],
        options: [
          { key: 'standard_scene', label: '擦除内容', type: 'select', choices: [{ value: 'full_screen_text_erase', label: '全图文字' }, { value: 'full_screen_icon_erase', label: '全图图标' }, { value: 'selected_area_erase', label: '涂抹 / 框选区域' }], default: 'full_screen_text_erase' },
          { key: 'standard_erase_text', label: '只擦这些文字', type: 'text', maxLength: 100, placeholder: '留空擦除所有文字', when: { standard_scene: ['full_screen_text_erase'] } },
          { key: 'mask_url', label: '涂抹要擦除的区域', type: 'mask', when: { standard_scene: ['selected_area_erase'] } },
          { key: 'selected_area', label: '或框选区域', type: 'boxes', maxItems: 1, when: { standard_scene: ['selected_area_erase'] } },
          { key: 'output_format', label: '输出格式', type: 'select', choices: [{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPG' }, { value: 'webp', label: 'WEBP' }], default: 'png', advanced: true },
        ],
        check: (ctx) =>
          ctx.values.standard_scene === 'selected_area_erase' && !ctx.values.mask_url && !(ctx.values.selected_area as unknown[] | undefined)?.length
            ? '请涂抹或框选要擦除的区域'
            : undefined,
        build: (body) => {
          if (Array.isArray(body.selected_area)) body.selected_area = body.selected_area[0];
        },
        price: each(0.00138),
        outputs: imageResult('修复后图片'),
      },
    ],
  },
  {
    id: 'remove-background',
    group: 'general',
    name: '智能抠图',
    icon: 'Crop',
    summary: '一键去除图片背景，输出透明 PNG',
    modes: [
      {
        id: 'default',
        label: '抠图',
        path: 'tools-sync/remove-image-background',
        inputs: [{ key: 'image', label: '图片', kinds: ['image'], field: 'image_url', hint: 'png、jpg、webp，不超过 30MB' }],
        options: [
          { key: 'scene', label: '主体类型', type: 'select', choices: [{ value: 'general', label: '通用' }, { value: 'human', label: '人像' }, { value: 'product', label: '商品' }], default: 'general' },
          { key: 'need_contour', label: '描边', type: 'switch', default: false, when: { scene: ['human', 'product'] } },
          { key: 'contour_size', label: '描边粗细', type: 'slider', min: 1, max: 100, step: 1, default: 10, when: { need_contour: [true], scene: ['human', 'product'] } },
          { key: 'need_crop_background', label: '裁掉多余空白', type: 'switch', default: false, when: { scene: ['human', 'product'] } },
          { key: 'output_format', label: '输出格式', type: 'select', choices: [{ value: 'png', label: 'PNG · 透明' }, { value: 'webp', label: 'WEBP · 透明' }, { value: 'jpeg', label: 'JPG · 黑底' }], default: 'png', advanced: true },
        ],
        price: each(0.00138),
        outputs: imageResult('抠图结果'),
      },
    ],
  },
  {
    id: 'expand-image',
    group: 'general',
    name: '智能扩图',
    icon: 'FullScreen',
    summary: '向四周延展画面，AI 自动补全内容',
    modes: [
      {
        id: 'default',
        label: '扩图',
        path: 'tools-sync/expand-image-canvas',
        inputs: [{ key: 'image', label: '图片', kinds: ['image'], field: 'image_url', hint: IMAGE_HINT }],
        options: (['top', 'bottom', 'left', 'right'] as const).map((side) => ({
          key: `expand_${side}`,
          label: { top: '向上', bottom: '向下', left: '向左', right: '向右' }[side],
          type: 'slider' as const,
          min: 0,
          max: 0.4,
          step: 0.05,
          default: side === 'left' || side === 'right' ? 0.2 : 0,
          help: side === 'top' ? '按原图短边的比例扩展' : undefined,
        })),
        check: (ctx) => (['top', 'bottom', 'left', 'right'].every((s) => !Number(ctx.values[`expand_${s}`])) ? '请至少设置一个方向的扩展比例' : undefined),
        price: each(0.03726),
        outputs: imageResult('扩图结果'),
      },
    ],
  },
  {
    id: 'remove-image-elements',
    group: 'general',
    name: '电商牛皮癣擦除',
    icon: 'Goods',
    summary: '一键去除商品图上的促销文字、贴纸和水印',
    modes: [
      {
        id: 'default',
        label: '擦除',
        path: 'tools-sync/remove-image-elements',
        inputs: [{ key: 'image', label: '商品图', kinds: ['image'], field: 'image_url', hint: IMAGE_HINT }],
        options: [],
        price: each(0.0414),
        outputs: imageResult('擦除后图片'),
      },
    ],
  },
  {
    id: 'product-scene',
    group: 'general',
    name: '电商万创',
    icon: 'Promotion',
    summary: '上传商品图，批量生成场景化营销主图',
    modes: (['standard', 'professional'] as const).map((version) => ({
      id: version,
      label: version === 'standard' ? '标准版' : '专业版',
      desc: version === 'standard' ? '预设场景，开箱即用' : '参考图 + 描述，自由创作',
      path: 'tools-sync/generate-product-scene-image',
      fixed: { tool_version: version },
      inputs: [
        { key: 'image', label: '商品图', kinds: ['image'] as InputKind[], field: 'image_url', hint: '短边至少 512 像素' },
        ...(version === 'professional'
          ? [{ key: 'reference', label: '风格参考图', kinds: ['image'] as InputKind[], field: 'professional_reference_image_url', hint: '纯背景、不含商品和人物' }]
          : []),
      ],
      options: [
        ...(version === 'standard'
          ? [{ key: 'standard_scene', label: '场景', type: 'select', choices: PRODUCT_SCENES, default: 'exhibit_simple' } as ToolOption]
          : []),
        {
          key: 'prompt',
          label: '场景描述',
          type: 'textarea',
          maxLength: 500,
          required: true,
          ...(version === 'standard'
            ? { when: { standard_scene: ['general'] }, help: '自定义场景只支持英文描述', placeholder: 'A perfume bottle on mossy rocks, forest and waterfall, cinematic lighting' }
            : { placeholder: '香水瓶放在潮湿的青苔岩石上，背景是森林和瀑布，阳光穿过树叶，电影感' }),
        } as ToolOption,
        { key: 'size', label: '尺寸', type: 'select', field: false, choices: [{ value: '800x800', label: '1:1 · 800×800' }, { value: '1024x1024', label: '1:1 · 1024×1024' }, { value: '768x1024', label: '3:4 · 768×1024' }, { value: '1024x768', label: '4:3 · 1024×768' }, { value: '576x1024', label: '9:16 · 576×1024' }, { value: '1024x576', label: '16:9 · 1024×576' }], default: '800x800' },
        { key: 'batch_count', label: '生成张数', type: 'number', min: 1, max: 4, default: 2 },
        { key: 'product_ratio', label: '商品占比', type: 'slider', min: 0.2, max: 0.9, step: 0.05, default: 0.6, advanced: true },
        ...(version === 'professional'
          ? [{ key: 'adapt', label: '参考强度', type: 'slider', field: 'professional_reference_image_adapt_scale', min: 0, max: 1, step: 0.05, default: 0.9, advanced: true } as ToolOption]
          : []),
      ],
      build: (body: Record<string, unknown>, ctx: ToolContext) => {
        const [width, height] = String(ctx.values.size ?? '800x800').split('x').map(Number);
        Object.assign(body, { output_width: width, output_height: height });
      },
      price: {
        unit: '张' as const,
        official: version === 'standard' ? 0.1 : 0.2,
        basis: '按生成张数',
        quantity: (ctx: ToolContext) => Number(ctx.values.batch_count ?? 1),
        actual: (r: Result) => (Array.isArray(r.images) ? r.images.length : 0),
      },
      outputs: (r: Result) => listOf('image', r.images, (i) => `场景图 ${i + 1}`, 'image_url'),
    })),
  },
  {
    id: 'separate-voice',
    group: 'general',
    name: '人声背景音分离',
    icon: 'Headset',
    summary: '把人声、背景音乐和音效拆成独立音轨',
    modes: [
      {
        id: 'default',
        label: '分离',
        path: 'tools/separate-voice',
        tos: true,
        inputs: [{ key: 'media', label: '视频或音频', kinds: ['video', 'audio'], field: MEDIA_FIELD, hint: `${VIDEO_FORMATS}、mp3、wav、m4a` }],
        options: [
          { key: 'scene', label: '场景', type: 'select', choices: [{ value: 'Audio', label: '通用 · 人声 + 背景' }, { value: 'Music', label: '音乐 · 人声 + 伴奏' }, { value: 'Drama', label: '影视 · 人声 + 音乐 + 音效' }, { value: 'Narrate', label: '解说 · 人声 + 音乐 + 音效' }, { value: 'Game', label: '游戏 · 人声 + 音乐 + 音效' }], default: 'Audio' },
          { key: 'output_format', label: '输出格式', type: 'select', choices: [{ value: 'mp3', label: 'MP3' }, { value: 'wav', label: 'WAV' }, { value: 'aac', label: 'AAC' }, { value: 'm4a', label: 'M4A' }, { value: 'flac', label: 'FLAC' }], default: 'mp3' },
        ],
        price: { unit: '分钟', official: 0.07, basis: '按音视频时长', quantity: inputMin('media'), actual: resultMin() },
        outputs: (r) =>
          ([['voice_audio_url', '人声'], ['background_audio_url', '背景音'], ['music_audio_url', '音乐'], ['sfx_audio_url', '音效']] as const)
            .filter(([field]) => r[field])
            .map(([field, label]) => ({ kind: 'audio' as const, url: String(r[field]), label })),
      },
    ],
  },
  {
    id: 'edit-speech',
    group: 'general',
    name: '音频内容编辑',
    icon: 'EditPen',
    summary: '像改文字一样修改录音里说错的话',
    modes: [
      {
        id: 'default',
        label: '编辑',
        path: 'tools/edit-speech',
        tos: true,
        inputs: [{ key: 'media', label: '视频或音频', kinds: ['video', 'audio'], field: MEDIA_FIELD, hint: `${VIDEO_FORMATS}、mp3、wav、m4a、aac` }],
        options: [{ key: 'edits', label: '要修改的内容', type: 'pairs', field: false, maxItems: 10, maxLength: 30, required: true, help: '原话尽量短、贴近实际发音，10 字以内效果最好；同一句话出现多次时填上大概的时间段' }],
        build: (body, ctx) => {
          body.edits = (ctx.values.edits as Array<{ from: string; to: string; start?: number; end?: number }>).map((e) => ({
            instruction: `把“${e.from}”替换成“${e.to}”`,
            ...(e.end ? { search_range: { start_time: e.start, end_time: e.end } } : {}),
          }));
        },
        price: { unit: '分钟', official: 1, basis: '按音视频时长 + 修改时长', quantity: inputMin('media'), actual: resultMin() },
        outputs: (r) => [...single('video', 'video_url', '编辑后视频')(r), ...single('audio', 'audio_url', '编辑后音频')(r)],
        verify: (r) => (Number(r.edited_duration) > 0 ? undefined : '没有找到要修改的原话，请确认原话与录音一致，或填写大概的时间段后重试'),
      },
    ],
  },
];

// ───────────────────────── 规格系数 ─────────────────────────

/** 转码单价相对 720P H.264（0.032 元/分钟）的倍数 */
const TRANSCODE_FACTOR: Record<'h264' | 'h265', number[]> = {
  h264: [0.65, 1, 2, 4.375, 8.75],
  h265: [3.25, 5, 10, 21.875, 43.75],
};

function tierIndex(short: number): number {
  if (short <= 480) return 0;
  if (short <= 720) return 1;
  if (short <= 1080) return 2;
  if (short <= 1440) return 3;
  return 4;
}

function transcodeFactor(ctx: ToolContext): number {
  const source = shortSide(ctx.inputs.video?.[0]);
  const target = Number(ctx.values.resolution) || (CANVAS_RATIO[String(ctx.values.canvas)] ? Math.min(source, 1080) : source);
  return TRANSCODE_FACTOR[ctx.values.codec === 'h265' ? 'h265' : 'h264'][tierIndex(target)];
}

function mattingFactor(ctx: ToolContext): number {
  return [1, 1, 1.5, 3, 4][tierIndex(shortSide(ctx.inputs.video?.[0]))];
}

export const MEDIA_TOOLS: ToolDef[] = [...VIDEO_TOOLS, ...GENERAL_TOOLS];

export function findTool(toolId: string, modeId?: string): { tool: ToolDef; mode: ToolMode } | null {
  const tool = MEDIA_TOOLS.find((item) => item.id === toolId);
  const mode = tool?.modes.find((item) => item.id === (modeId || tool.modes[0].id));
  return tool && mode ? { tool, mode } : null;
}

/** 定价规则 id，管理员按它单独调系数、手填官方单价 */
export const priceRuleId = (toolId: string, modeId: string) => `tool:${toolId}:${modeId}`;

export interface PricedItem {
  ruleId: string;
  group: string;
  name: string;
  unit: string;
  official: number;
  basis: string;
}

/** 定价页上的所有工具计价项 */
export function pricedItems(): PricedItem[] {
  const groupName = { video: '视频工具', general: '通用工具' };
  return [
    ...MEDIA_TOOLS.flatMap((tool) =>
      tool.modes.map((mode) => ({
        ruleId: priceRuleId(tool.id, mode.id),
        group: groupName[tool.group],
        name: tool.modes.length > 1 ? `${tool.name} · ${mode.label}` : tool.name,
        unit: mode.price.unit,
        official: mode.price.official,
        basis: mode.price.basis,
      })),
    ),
  ];
}
