/**
 * 模型平台API 模型配置类型
 *
 * 设计目标：新增/下线模型只改 `config/atlas-models.json`，不改代码。
 * Atlas 把"文生 / 图生（单图首帧） / 多参考生"做成了不同的 model id，
 * 所以每个模型系列在配置里用 `variants` 声明它有哪些输入形态、每种形态对应
 * 哪个 Atlas model id；调用时按当前请求实际带了几张参考图/是否有参考视频/音频来选用哪个变体
 * （见 AtlasModelRegistryService.pickVariant），这样新增一个模型系列只需要在 JSON 里加一条。
 */

/**
 * 图片/视频统一走本文件的模型注册表；音频（TTS/音乐）为同构的第三类。
 * llm/vision 是第四、五类：文案生成（判官团/脚本引擎）与多模态图片理解（商品图卖点提炼），
 * 走 Atlas 独立的 OpenAI 兼容 chat/completions 网关（见 AtlasLlmService），不参与图片/视频那套
 * variants/ratios/分辨率钳制体系，故用更简单的 AtlasTextModelEntry 描述（见下）。
 */
export type AtlasCategory = 'image' | 'video' | 'audio' | 'llm' | 'vision';
/** video.service.ts 现有代码只消费图片与视频两类，保留该别名避免调用方改动 */
export type MediaModelKind = Extract<AtlasCategory, 'image' | 'video'>;
/** 纯文本/多模态理解类别（与图片/视频/音频的媒体生成类别区分） */
export type AtlasTextModelKind = Extract<AtlasCategory, 'llm' | 'vision'>;

export type ImageVariantKey = 'textToImage' | 'edit';
export type VideoVariantKey = 'textToVideo' | 'imageToVideo' | 'referenceToVideo';
export type AudioVariantKey = 'tts' | 'music';
export type VariantKey = ImageVariantKey | VideoVariantKey | AudioVariantKey;

/** 用户为某次生成挂载的 LoRA（仅当所选模型 supportsLora 时生效），name 对应 MediaModelOption.loras[].name */
export interface LoraSelection {
  name: string;
  weight: number;
}

/** 某类参考素材在请求体中的挂载方式：字段名 + 是否数组（单值字段时只取第 1 个） */
export interface AtlasRefFieldSpec {
  field: string;
  array: boolean;
  /**
   * url：直接写字符串（Seedance / Kling / Veo）。
   * url-object：写成 `{ url, type }`（MiniMax H3 `refers`）。
   */
  shape?: 'url' | 'url-object';
  /** shape=url-object 时写入的 type */
  mediaType?: 'image' | 'video' | 'audio';
}

/** 模型某个输入形态变体的真实调用信息（Atlas 目录 id + 该形态下参考素材字段名） */
export interface AtlasVariantSpec {
  /** Atlas 模型目录 id，如 bytedance/seedance-2.0/text-to-video；务必与 GET /api/v1/models 的实时结果核对 */
  model: string;
  image?: AtlasRefFieldSpec;
  video?: AtlasRefFieldSpec;
  audio?: AtlasRefFieldSpec;
  /** 该形态固定比例（如 Seedance 2.5 图生视频只能 adaptive），忽略调用方传入的 ratio */
  fixedRatio?: string;
  /** 该形态 schema 没有比例字段（如可灵 O3 图生视频、Veo 参考生） */
  omitRatio?: boolean;
  /** 该形态 schema 没有 resolution 字段（如可灵 v3 文生视频） */
  omitResolution?: boolean;
  /** 该形态只允许这几个整数秒；未配置则回退模型级 durationValues / min-max */
  durationValues?: number[];
}

/**
 * LoRA 预设（管理员在 JSON 里声明可用的 LoRA 权重路径），供支持 LoRA 的模型挂载。
 * 字段沿用旧版 `LoraOption` 命名（name/description/defaultWeight），前端 ModelPicker.vue 零改动即可继续渲染；
 * `path` 是新增的 Atlas/HuggingFace 风格权重路径，构建请求体时按 name 查出对应 path。
 */
export interface LoraPreset {
  /** 前端下拉展示用名称，对应 LoraSelection.name */
  name: string;
  description?: string;
  defaultWeight: number;
  /** Atlas/HuggingFace 风格权重路径，实际写入请求体的 LoRA 字段 */
  path: string;
}

/** `config/atlas-models.json` 中单个模型系列的静态配置（人工维护） */
export interface AtlasModelEntry {
  id: string;
  name: string;
  description?: string;
  /** flagship=该厂商最新旗舰（默认推荐），value=平价/快速档 */
  tier?: 'flagship' | 'value';
  /**
   * 调用通道。atlas=Atlas Cloud（对用户称海外版），ark=火山方舟，minimax=MiniMax 官方，speech=豆包语音。
   * 未写时按变体 model id 的首段推断，只用于旧配置。
   */
  provider?: 'atlas' | 'ark' | 'minimax' | 'speech';
  /** 提示词里 @ 引用的厂商写法，如 bytedance / minimax。未写时与 provider 相同 */
  vendor?: string;
  /** 方舟、MiniMax、豆包语音的上游模型 id。Atlas 仍以 variants[].model 为准 */
  upstreamModel?: string;
  /** 该模型系列支持哪些输入形态；key 见 VariantKey，value 为该形态对应的上游调用信息 */
  variants: Partial<Record<VariantKey, AtlasVariantSpec>>;
  /** 画面比例；未配置时按 9:16 / 16:9 / 1:1 */
  ratios?: string[];
  defaultRatio?: string;
  /** 清晰度档位；未配置时不传 resolution，走上游默认 */
  resolutions?: string[];
  defaultResolution?: string;
  /**
   * Seedream / FLUX 等需要精确像素的模型：清晰度 → 比例 → `宽*高`（Atlas 官方用星号，不是 x）。
   * 配置了该表时请求体传 `size`（见 sizeField）而非 resolution+aspect_ratio，避免模型按 prompt 猜比例。
   */
  sizeByRatio?: Record<string, Record<string, string>>;
  /** size 像素串对应的请求体字段名；默认 'size' */
  sizeField?: string;
  /**
   * size 宽高之间的连接符。Seedream / FLUX 官方是 `*`，GPT Image 2 是 `x`。
   * 未配置时按 `*` 发送。
   */
  sizeJoin?: '*' | 'x';
  /**
   * 清晰度写入的请求体字段。未配置时：有 size 表就不另传，否则传 `resolution`。
   * GPT Image 2 用 `quality`（low / medium / high）。
   */
  resolutionField?: string;
  /** 图片输出格式；未配置时不传 */
  outputFormats?: string[];
  defaultOutputFormat?: string;
  /** 提示词优化写入的请求体字段：Seedream 为 prompt_optimization_mode，Nano Banana 为 thinking_level */
  promptOptimizeField?: string;
  /** 提示词优化模式；未配置时不传 */
  promptOptimizeModes?: string[];
  defaultPromptOptimizeMode?: string;
  /** 视频时长下限/上限（秒）；图片模型忽略 */
  minDuration?: number;
  maxDuration?: number;
  /** 只允许这几个整数秒（如 Veo 4/6/8、Hailuo 02 的 6/10）；未配置则按 min/max 连续钳制 */
  durationValues?: number[];
  /** 是否支持生成同步配音；视频模型专用 */
  supportsGenerateAudio?: boolean;
  /** 配音开关字段。Seedance/Veo 用 generate_audio，可灵用 sound；未配置默认 generate_audio */
  audioField?: 'generate_audio' | 'sound' | 'audio';
  /**
   * 画面比例字段名。Seedance / Hailuo H3 用 `ratio`，可灵 O3 / Veo 用 `aspect_ratio`。
   * 未配置时默认 `aspect_ratio`。
   */
  ratioField?: 'ratio' | 'aspect_ratio';
  /** 整条模型都不传比例字段（Hailuo 02 无 ratio/aspect_ratio） */
  omitRatio?: boolean;
  /** 模型 schema 含 watermark 时传 false，避免成片带平台水印 */
  supportsWatermark?: boolean;
  /** 最多参考图/视频/音频数量；0 表示不支持。未配置时图按 9、视频按 3、音频按 0 */
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  maxReferenceAudios?: number;
  /** 图片+视频+音频混合输入的文件总数上限；未配置时不额外限制 */
  maxReferenceFiles?: number;
  /** 同类参考视频或参考音频的合计时长上限（秒）；Seedance 2.5 为 30，未配置且支持该类引用时默认 15 */
  maxReferenceDurationSec?: number;
  supportsLora?: boolean;
  /** LoRA 数组字段名；默认 'loras' */
  loraField?: string;
  loras?: LoraPreset[];
}

export interface AtlasModelsConfigGroup {
  /** 默认模型 id，必须存在于 models 列表中 */
  default: string;
  models: AtlasModelEntry[];
}

/**
 * LLM / 视觉理解模型的静态配置条目：不需要 variants（文生图/图生视频那套输入形态区分）、
 * ratios、分辨率等图片视频专属字段，只需要一个 Atlas chat/completions 目录 id。
 */
export interface AtlasTextModelEntry {
  id: string;
  name: string;
  description?: string;
  /** 上游模型 id。方舟上的 DeepSeek 走 chat/completions */
  model: string;
  provider?: 'atlas' | 'ark';
}

export interface AtlasTextModelsConfigGroup {
  default: string;
  models: AtlasTextModelEntry[];
}

export interface AtlasModelsConfigFile {
  image: AtlasModelsConfigGroup;
  video: AtlasModelsConfigGroup;
  audio: AtlasModelsConfigGroup;
  llm: AtlasTextModelsConfigGroup;
  vision: AtlasTextModelsConfigGroup;
}

/**
 * 供 `/video/models` 接口与内部生成流程共用的完整模型信息（静态配置归一化后的结果）。
 *
 * `provider` 是调用通道，`vendor` 决定提示词里的 @ 引用写法。
 * MiniMax 用 `<Picture N>`，ByteDance Seedance 用 `@Image1`。
 */
export interface MediaModelOption extends AtlasModelEntry {
  kind: MediaModelKind;
  provider: 'atlas' | 'ark' | 'minimax' | 'speech';
  isDefault: boolean;
  minDuration: number;
  maxDuration: number;
  maxReferenceImages: number;
  maxReferenceVideos: number;
  maxReferenceAudios: number;
  maxReferenceDurationSec: number;
  ratios: string[];
  defaultRatio: string;
  resolutions: string[];
  outputFormats: string[];
  promptOptimizeModes: string[];
  supportsLora: boolean;
  loras: LoraPreset[];
}

/** 给前端的模型信息。不带上游模型 id */
export function toClientModel(model: MediaModelOption): MediaModelOption {
  const copy: MediaModelOption = { ...model, variants: { ...model.variants } };
  delete copy.upstreamModel;
  return copy;
}
