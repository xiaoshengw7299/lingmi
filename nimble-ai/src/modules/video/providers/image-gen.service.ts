import { Injectable, Logger } from '@nestjs/common';
import { AtlasClientService } from '../../atlas/atlas-client.service';
import { AtlasModelRegistryService } from '../../atlas/atlas-model-registry.service';
import { applyLora, applyRefField } from '../../atlas/atlas-request.util';
import { LoraSelection, MediaModelOption } from '../../atlas/atlas.types';
import { BillingService } from '../../billing/billing.service';
import { pixelsOf } from '../../pricing/commerce';
import { PricingService } from '../../pricing/pricing.service';
import { ArkClientService } from '../../providers/ark-client.service';
import { StorageService } from '../../storage';

/**
 * 进程内等待上限。Atlas 排队时 2 分钟经常不够，到点就写「生成超时」会把后来的成功结果丢掉。
 * Webhook 只在任务结束时回调，只能提前唤醒这一轮查询，不能缩短 Atlas 真正需要的时间。
 * 画布 / 素材库还会在到点后交棒（handoff），界面继续显示生成中，由回调和对账收尾。
 */
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 3_000;

/** 本地等待结束时 Atlas 仍在处理。调用方应保持「生成中」，不要写成失败。 */
export class AtlasImagePendingError extends Error {
  readonly predictionId: string;

  constructor(predictionId: string) {
    super('图片仍在生成');
    this.name = 'AtlasImagePendingError';
    this.predictionId = predictionId;
  }
}

export interface GenerateImageHooks {
  /** 一拿到 prediction id 就落库，进程重启或等待交棒后仍能对上回调 */
  onSubmitted?: (prediction: { predictionId: string; modelName: string }) => Promise<void | boolean>;
  /**
   * 为 true 时，等待上限到达但 Atlas 仍在处理：不退款、不抛「生成超时」。
   * 抛 AtlasImagePendingError，业务记录保持生成中。
   */
  handoff?: boolean;
}

export interface GenerateImageParams {
  prompt: string;
  /** 参考图 URL（角色定妆图等），传入时走图生图/多图融合以保持人物一致性 */
  referenceImageUrls?: string[];
  ratio?: string;
  resolution?: string;
  outputFormat?: string;
  promptOptimizeMode?: string;
  /** config/atlas-models.json 中的模型 id；不传则使用当前默认图片模型 */
  modelId?: string;
  lora?: LoraSelection | null;
}

export interface GenerateImageResult {
  modelName: string;
  /** Atlas 生成结果统一是远程 URL */
  url: string;
  predictionId: string;
}

/**
 * 图片生成 Provider：统一走 模型平台API，按是否带参考图选用 textToImage / edit 变体。
 */
@Injectable()
export class ImageGenService {
  private readonly logger = new Logger(ImageGenService.name);

  constructor(
    private readonly atlas: AtlasClientService,
    private readonly ark: ArkClientService,
    private readonly modelConfig: AtlasModelRegistryService,
    private readonly pricing: PricingService,
    private readonly billing: BillingService,
    private readonly storage: StorageService,
  ) {}

  async generate(params: GenerateImageParams, hooks?: GenerateImageHooks): Promise<GenerateImageResult> {
    const model = await this.modelConfig.resolveModel('image', params.modelId);
    if (model.provider === 'ark') return this.generateArk(model, params, hooks);
    const referenceImageUrls = params.referenceImageUrls ?? [];
    const variantKey = referenceImageUrls.length ? 'edit' : 'textToImage';
    const variant = model.variants[variantKey] ?? model.variants.textToImage ?? model.variants.edit;
    if (!variant) throw new Error(`图片模型"${model.name}"未配置可用的调用形态`);

    const body: Record<string, unknown> = { model: variant.model, prompt: params.prompt };
    try {
      applyRefField(body, variant.image, referenceImageUrls, '参考图');
    } catch (error) {
      throw new Error(`图片模型"${model.name}"${error instanceof Error ? error.message : String(error)}`);
    }
    this.applySizeParams(body, model, params);
    applyLora(body, model, params.lora);
    const webhookUrl = this.atlas.buildWebhookUrl();
    if (webhookUrl) body.webhook_url = webhookUrl;

    const predictionId = await this.atlas.submitImage(body);
    try {
      await hooks?.onSubmitted?.({ predictionId, modelName: model.name });
    } catch (error) {
      this.logger.error(
        `记录图片任务失败 prediction=${predictionId}: ${error instanceof Error ? error.message : error}`,
      );
    }
    const result = await this.atlas.pollUntilDone(predictionId, {
      timeoutMs: POLL_TIMEOUT_MS,
      intervalMs: POLL_INTERVAL_MS,
    });
    if (result.pending) {
      this.logger.warn(`Atlas 仍在处理图片，停止进程内等待 prediction=${predictionId}`);
      throw new AtlasImagePendingError(predictionId);
    }
    if (result.state !== 'succeeded' || !result.outputs[0]) {
      this.logger.error(`图片生成失败 model=${variant.model} prediction=${predictionId}: ${result.error ?? '未返回图片'}`);
      throw new Error(result.error || '图片生成失败：模型未返回图片');
    }
    return { url: result.outputs[0], modelName: model.name, predictionId };
  }

  private async generateArk(
    model: MediaModelOption,
    params: GenerateImageParams,
    hooks?: GenerateImageHooks,
  ): Promise<GenerateImageResult> {
    const ratio = this.modelConfig.clampRatio('image', params.ratio, model.id);
    const resolution = this.modelConfig.clampResolution('image', params.resolution, model.id);
    const size = this.modelConfig.resolveImageSize(model, ratio, resolution).replace(/\*/g, 'x');
    const images = (params.referenceImageUrls ?? [])
      .map((url) => url.trim())
      .filter(Boolean)
      .map((url) => this.storage.toVolcengineUrl(url));
    const quote = await this.pricing.quoteSeedream(pixelsOf(size), images.length, model.upstreamModel || model.id);
    const ticket = await this.billing.chargeQuoted('image', {
      model: model.id,
      modelName: model.name,
      cents: quote.cents,
      upstreamCents: quote.upstreamCents,
    });
    const predictionId = `ark-${Date.now().toString(36)}`;
    const tracked = !!hooks?.onSubmitted;
    if (tracked) await this.billing.bind(ticket, predictionId);
    try {
      const recorded = await hooks?.onSubmitted?.({ predictionId, modelName: model.name });
      if (recorded === false) {
        if (tracked) await this.billing.refundTask(predictionId);
        else await this.billing.refund(ticket);
        throw new Error('已中断');
      }
      const url = await this.ark.generateImage({
        model: model.upstreamModel,
        prompt: params.prompt,
        size,
        watermark: false,
        response_format: 'url',
        ...(images.length === 1 ? { image: images[0] } : {}),
        ...(images.length > 1 ? { image: images } : {}),
      });
      return { url, modelName: model.name, predictionId };
    } catch (error) {
      if (error instanceof Error && error.message === '已中断') throw error;
      if (tracked) await this.billing.refundTask(predictionId);
      else await this.billing.refund(ticket);
      throw new Error(error instanceof Error ? error.message : '图片生成失败');
    }
  }

  /** 有精确像素表时传 size；否则按模型字段传 aspect_ratio(+resolution)。quality 等另名字段走 resolutionField。 */
  private applySizeParams(body: Record<string, unknown>, model: MediaModelOption, params: GenerateImageParams): void {
    const ratio = this.modelConfig.clampRatio('image', params.ratio, model.id);
    const resolution = this.modelConfig.clampResolution('image', params.resolution, model.id);
    if (model.sizeByRatio) {
      const raw = this.modelConfig.resolveImageSize(model, ratio, resolution);
      const size = model.sizeJoin === 'x' ? raw.replace(/\*/g, 'x') : raw.replace(/x/gi, '*');
      body[model.sizeField ?? 'size'] = size;
      if (model.resolutionField && resolution) body[model.resolutionField] = resolution;
    } else {
      body[model.ratioField || 'aspect_ratio'] = ratio;
      if (resolution) body[model.resolutionField || 'resolution'] = resolution;
    }
    const outputFormat = this.modelConfig.clampOutputFormat(params.outputFormat, model.id);
    if (outputFormat) body.output_format = outputFormat;
    const promptOptimize = this.modelConfig.clampPromptOptimizeMode(params.promptOptimizeMode, model.id);
    if (promptOptimize) {
      const field = model.promptOptimizeField || 'prompt_optimization_mode';
      body[field] = promptOptimize;
      if (field === 'prompt_optimization_mode') {
        body.thinking = promptOptimize === 'fast' ? 'disabled' : 'enabled';
      }
    }
  }
}
