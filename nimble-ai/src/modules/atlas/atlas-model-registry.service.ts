import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AtlasClientService } from './atlas-client.service';
import {
  AtlasCategory,
  AtlasModelEntry,
  AtlasModelsConfigFile,
  AtlasTextModelEntry,
  AtlasTextModelKind,
  MediaModelKind,
  MediaModelOption,
} from './atlas.types';

const VIDEO_DURATION_MIN_DEFAULT = 4;
const VIDEO_DURATION_MAX_DEFAULT = 15;
const VIDEO_REF_IMAGES_DEFAULT = 9;
const VIDEO_REF_VIDEOS_DEFAULT = 3;
/** 参考音频属于全能参考能力，只有在 JSON 里显式开启的模型才支持 */
const VIDEO_REF_AUDIOS_DEFAULT = 0;
const VIDEO_REF_DURATION_DEFAULT = 15;
const MEDIA_RATIOS_DEFAULT = ['9:16', '16:9', '1:1'];
const PREFERRED_DEFAULT_RATIO = '9:16';

/**
 * 模型平台API 模型配置中心
 *
 * 单一事实来源：`config/atlas-models.json`（人工维护，声明当前对外提供哪些模型 + 各类别的默认模型）。
 * 新增/下线模型只需改 JSON，无需改代码；新增模型的输入形态（文生/图生/参考生）通过 `variants` 声明，
 * 具体调用哪个变体由 VideoGenService/ImageGenService 按当前请求实际携带的参考素材数量选择。
 *
 * listModels/resolveModel 保持 async：调用方已按 Promise 使用。启动时会对照 Atlas 实时目录核对
 * JSON 里的 model id，失效 id 打 error 日志，不阻断服务启动。
 */
@Injectable()
export class AtlasModelRegistryService implements OnModuleInit {
  private readonly logger = new Logger(AtlasModelRegistryService.name);
  private config!: AtlasModelsConfigFile;

  constructor(
    private readonly configService: ConfigService,
    private readonly atlas: AtlasClientService,
  ) {}

  onModuleInit(): void {
    this.config = this.loadConfig();
    void this.auditLiveCatalog();
  }

  private loadConfig(): AtlasModelsConfigFile {
    const configPath = this.configService.get<string>(
      'ATLAS_MODELS_CONFIG',
      path.join(process.cwd(), 'config', 'atlas-models.json'),
    );
    let raw: string;
    try {
      raw = fs.readFileSync(configPath, 'utf-8');
    } catch (error) {
      throw new Error(`模型配置文件读取失败(${configPath})：${error instanceof Error ? error.message : String(error)}`);
    }
    const parsed = JSON.parse(raw) as AtlasModelsConfigFile;
    this.assertValidConfig(parsed);
    return parsed;
  }

  private assertValidConfig(config: AtlasModelsConfigFile): void {
    for (const kind of ['image', 'video', 'audio'] as const) {
      const group = config[kind];
      if (!group?.models?.length) throw new Error(`模型配置缺少 ${kind}.models`);
      const ids = group.models.map((m) => m.id);
      if (new Set(ids).size !== ids.length) throw new Error(`模型配置 ${kind}.models 存在重复 id`);
      if (!ids.includes(group.default)) {
        throw new Error(`模型配置 ${kind}.default("${group.default}") 未出现在 ${kind}.models 列表中`);
      }
      for (const entry of group.models) {
        if (!Object.keys(entry.variants ?? {}).length) {
          throw new Error(`模型配置 "${entry.id}" 未声明任何 variants，至少需要一种调用形态`);
        }
      }
    }
    // llm/vision 是纯文本/多模态理解类别，没有 variants 概念，只校验 id 唯一性与 default 有效性
    for (const kind of ['llm', 'vision'] as const) {
      const group = config[kind];
      if (!group?.models?.length) throw new Error(`模型配置缺少 ${kind}.models`);
      const ids = group.models.map((m) => m.id);
      if (new Set(ids).size !== ids.length) throw new Error(`模型配置 ${kind}.models 存在重复 id`);
      if (!ids.includes(group.default)) {
        throw new Error(`模型配置 ${kind}.default("${group.default}") 未出现在 ${kind}.models 列表中`);
      }
    }
  }

  private pickListed(value: string | null | undefined, options: string[], fallback?: string): string {
    if (value && options.includes(value)) return value;
    if (fallback && options.includes(fallback)) return fallback;
    if (options.includes(PREFERRED_DEFAULT_RATIO)) return PREFERRED_DEFAULT_RATIO;
    return options[0];
  }

  /** 旧配置没写 provider 时，按变体 id 首段猜通道；认不出就当 Atlas */
  private deriveProvider(entry: AtlasModelEntry): MediaModelOption['provider'] {
    const raw = Object.values(entry.variants)[0]?.model.split('/')[0];
    if (raw === 'ark' || raw === 'minimax' || raw === 'speech' || raw === 'atlas') return raw;
    return 'atlas';
  }

  private normalize(kind: AtlasCategory, entry: AtlasModelEntry, isDefault: boolean): MediaModelOption {
    const ratios = entry.ratios?.length ? entry.ratios : MEDIA_RATIOS_DEFAULT;
    const resolutions = entry.resolutions?.length ? entry.resolutions : [];
    const outputFormats = entry.outputFormats?.length ? entry.outputFormats : [];
    const promptOptimizeModes = entry.promptOptimizeModes?.length ? entry.promptOptimizeModes : [];
    const isVideo = kind === 'video';
    return {
      ...entry,
      kind: kind as MediaModelKind,
      provider: entry.provider ?? this.deriveProvider(entry),
      vendor: entry.vendor ?? entry.provider ?? this.deriveProvider(entry),
      isDefault,
      ratios,
      defaultRatio: this.pickListed(entry.defaultRatio, ratios, PREFERRED_DEFAULT_RATIO),
      resolutions,
      defaultResolution: resolutions.length
        ? this.pickListed(entry.defaultResolution, resolutions, entry.defaultResolution)
        : undefined,
      outputFormats,
      defaultOutputFormat: outputFormats.length
        ? this.pickListed(entry.defaultOutputFormat, outputFormats, entry.defaultOutputFormat)
        : undefined,
      promptOptimizeModes,
      defaultPromptOptimizeMode: promptOptimizeModes.length
        ? this.pickListed(entry.defaultPromptOptimizeMode, promptOptimizeModes, entry.defaultPromptOptimizeMode)
        : undefined,
      minDuration: isVideo ? entry.minDuration ?? VIDEO_DURATION_MIN_DEFAULT : 0,
      maxDuration: isVideo ? entry.maxDuration ?? VIDEO_DURATION_MAX_DEFAULT : 0,
      maxReferenceImages: entry.maxReferenceImages ?? VIDEO_REF_IMAGES_DEFAULT,
      maxReferenceVideos: isVideo ? entry.maxReferenceVideos ?? VIDEO_REF_VIDEOS_DEFAULT : 0,
      maxReferenceAudios: entry.maxReferenceAudios ?? VIDEO_REF_AUDIOS_DEFAULT,
      maxReferenceDurationSec: isVideo
        ? entry.maxReferenceDurationSec ?? VIDEO_REF_DURATION_DEFAULT
        : 0,
      supportsLora: entry.supportsLora === true,
      loras: entry.loras ?? [],
    };
  }

  /** 供 `/video/models`、价目表与内部生成流程共用：某个类别下当前全部可选模型 */
  async listModels(kind: MediaModelKind | 'audio'): Promise<MediaModelOption[]> {
    const group = this.config[kind];
    return group.models.map((entry) => this.normalize(kind, entry, entry.id === group.default));
  }

  /** 同步读取静态配置，供时长钳制等同步路径使用；未传或 id 已不存在时回退为该类别默认模型 */
  resolveStatic(kind: MediaModelKind, modelId?: string | null): MediaModelOption {
    const group = this.config[kind];
    const matched = modelId ? group.models.find((item) => item.id === modelId) : undefined;
    if (modelId && !matched) {
      this.logger.warn(`模型 id "${modelId}" 不在当前 ${kind} 模型配置中，已回退为默认模型`);
    }
    const resolvedEntry = matched ?? group.models.find((item) => item.id === group.default);
    if (!resolvedEntry) throw new Error(`模型配置缺少 ${kind} 的默认模型，请检查 config/atlas-models.json`);
    return this.normalize(kind, resolvedEntry, resolvedEntry.id === group.default);
  }

  /** 按 modelId 解析出具体模型；未传或传入的 id 已不存在于配置中时回退为该类别的默认模型 */
  async resolveModel(kind: MediaModelKind, modelId?: string | null): Promise<MediaModelOption> {
    return this.resolveStatic(kind, modelId);
  }

  getDefaultModelId(kind: MediaModelKind): string {
    return this.config[kind].default;
  }

  /**
   * 音频（TTS）模型解析；独立于 resolveModel 是因为音频不参与 image/video 的比例/清晰度钳制体系，
   * 一键成片的 TtsService 只需要拿到 variants.tts.model 这个 Atlas 目录 id。
   * 当前音频类别只配置了一个模型，modelId 形参先留着，方便后续新增模型时按 id 选择。
   */
  resolveAudioModel(modelId?: string | null): MediaModelOption {
    const group = this.config.audio;
    const matched = modelId ? group.models.find((item) => item.id === modelId) : undefined;
    const resolvedEntry = matched ?? group.models.find((item) => item.id === group.default);
    if (!resolvedEntry) throw new Error('模型配置缺少 audio 的默认模型，请检查 config/atlas-models.json');
    return this.normalize('audio', resolvedEntry, resolvedEntry.id === group.default);
  }

  /**
   * LLM/视觉模型解析，供 AtlasLlmService 使用；与 resolveAudioModel 一样不参与图片/视频那套
   * variants/比例/清晰度体系，只按 id 从 llm/vision 两节里选，未传或已失效则回退默认模型。
   */
  resolveTextModel(kind: AtlasTextModelKind, modelId?: string | null): AtlasTextModelEntry {
    const group = this.config[kind];
    const matched = modelId
      ? group.models.find((item) => item.id === modelId || item.model === modelId)
      : undefined;
    if (modelId && !matched) {
      this.logger.warn(`模型 id "${modelId}" 不在当前 ${kind} 模型配置中，已回退为默认模型`);
    }
    const resolvedEntry = matched ?? group.models.find((item) => item.id === group.default);
    if (!resolvedEntry) throw new Error(`模型配置缺少 ${kind} 的默认模型，请检查 config/atlas-models.json`);
    return resolvedEntry;
  }

  /** 供价格页、智能体等接口展示当前可选的 LLM/视觉模型列表 */
  listTextModels(kind: AtlasTextModelKind): AtlasTextModelEntry[] {
    return this.config[kind].models;
  }

  clampRatio(kind: MediaModelKind, value: string | null | undefined, modelId?: string | null): string {
    const model = this.resolveStatic(kind, modelId);
    return this.pickListed(value, model.ratios, model.defaultRatio);
  }

  /** 模型未配置清晰度时返回 undefined，调用方不要把该字段传给上游 */
  clampResolution(kind: MediaModelKind, value: string | null | undefined, modelId?: string | null): string | undefined {
    const model = this.resolveStatic(kind, modelId);
    if (!model.resolutions.length) return undefined;
    return this.pickListed(value, model.resolutions, model.defaultResolution);
  }

  clampOutputFormat(value: string | null | undefined, modelId?: string | null): string | undefined {
    const model = this.resolveStatic('image', modelId);
    if (!model.outputFormats.length) return undefined;
    return this.pickListed(value, model.outputFormats, model.defaultOutputFormat);
  }

  clampPromptOptimizeMode(value: string | null | undefined, modelId?: string | null): string | undefined {
    const model = this.resolveStatic('image', modelId);
    if (!model.promptOptimizeModes.length) return undefined;
    return this.pickListed(value, model.promptOptimizeModes, model.defaultPromptOptimizeMode);
  }

  /** Seedream 等需要精确像素的模型：清晰度+比例映射为官方推荐像素；其它模型返回清晰度档位本身 */
  resolveImageSize(model: MediaModelOption, ratio: string, resolution?: string): string {
    if (resolution && model.sizeByRatio?.[resolution]?.[ratio]) {
      return model.sizeByRatio[resolution][ratio];
    }
    return resolution || model.defaultResolution || '2K';
  }

  listConfiguredAtlasIds(): Array<{ kind: string; id: string; variant: string; model: string }> {
    const rows: Array<{ kind: string; id: string; variant: string; model: string }> = [];
    for (const kind of ['image', 'video', 'audio'] as const) {
      for (const entry of this.config[kind].models) {
        if (entry.provider && entry.provider !== 'atlas') continue;
        for (const [variant, spec] of Object.entries(entry.variants ?? {})) {
          if (spec?.model) rows.push({ kind, id: entry.id, variant, model: spec.model });
        }
      }
    }
    for (const kind of ['llm', 'vision'] as const) {
      for (const entry of this.config[kind].models) {
        if (entry.provider && entry.provider !== 'atlas') continue;
        rows.push({ kind, id: entry.id, variant: '-', model: entry.model });
      }
    }
    return rows;
  }

  private async auditLiveCatalog(): Promise<void> {
    if (!this.atlas.configured) {
      this.logger.warn('未配置 ATLASCLOUD_API_KEY，跳过 Atlas 实时目录核对');
      return;
    }
    try {
      const live = await this.atlas.fetchLiveModelIds();
      const configured = this.listConfiguredAtlasIds();
      const missing = configured.filter((row) => !live.has(row.model));
      if (!missing.length) {
        this.logger.log(`Atlas 实时目录核对通过，配置了 ${configured.length} 个 model id`);
        return;
      }
      this.logger.error(
        `atlas-models.json 有 ${missing.length} 个 model id 不在 Atlas 实时目录，请求会 400 not found：` +
          missing.map((row) => `${row.kind}.${row.id}.${row.variant}=${row.model}`).join('; '),
      );
    } catch (error) {
      this.logger.warn(`Atlas 实时目录核对失败（不影响启动）：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
