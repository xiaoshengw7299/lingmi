import { Injectable, Logger } from '@nestjs/common';
import { AtlasModelRegistryService } from '../atlas/atlas-model-registry.service';
import { AtlasTextModelEntry, AtlasTextModelKind, AtlasVariantSpec, MediaModelOption } from '../atlas/atlas.types';
import { PricedItem, pricedItems } from '../media-tools/media-tools.catalog';
import { arkTextRates, pixelsOf, seedreamCny } from './commerce';
import { ModelQuote, QuoteScale } from './entities/model-quote.entity';
import { CatalogEntry, PricingService } from './pricing.service';
import { videoRunProbeResolutions, videoRunProfile } from '../video/providers/video-run.profile';

/** 两次 calculate 之间的间隔，避免手动询价一次把 Atlas 打到限流 */
const QUOTE_GAP_MS = 400;
/** 视频类模型按一个允许时长折算成每秒单价，没有固定档时用 5 秒 */
const REFERENCE_SECONDS = 5;

export type PriceKind = 'video' | 'image' | 'audio' | 'llm' | 'vision' | 'tool';

export interface QuoteFailure {
  /** Atlas 模型 id。整批失败时是说明，例如「文本模型目录」 */
  id: string;
  message: string;
}

/** 价目表一行。单价单位是 元 / unit */
export interface PriceRow {
  /** config/atlas-models.json 里的模型 id */
  id: string;
  kind: PriceKind;
  vendor: string;
  name: string;
  tier?: 'flagship' | 'value';
  unit: string;
  scenario: string;
  price: number | null;
  officialPrice: number | null;
  /** 仅文本模型：输出 token 单价 */
  outputPrice?: number | null;
  outputOfficialPrice?: number | null;
}

/** 后台看到的完整行：多了成本、加价、询价时间和失败原因 */
export interface AdminPriceRow extends PriceRow {
  costPrice: number | null;
  markup: number;
  markupOverride: number | null;
  officialOverride: number | null;
  atlasModels: string[];
  /** video=所选规格官方价 × 售价系数；markup=成本 × 加价系数 */
  pricingMode: 'video' | 'markup';
  /** 视频售价系数。1 为官方价 */
  discount: number | null;
  /** 最近一次成功询价时间；从未成功则为空 */
  quotedAt: string | null;
  /** 最近一次询价失败的原因。有旧价时价格仍在 */
  quoteError: string | null;
}

interface Reference {
  body: Record<string, unknown>;
  unit: string;
  /** 报价对应的计价单位数量，用来折算单价 */
  per: number;
  scenario: string;
  scale: QuoteScale;
}

interface Probe {
  atlasModel: string;
  name: string;
  ref: Reference;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 价目表。价格来自已落库的 Atlas 询价，打开页面、改加价都不会再请求 Atlas。
 * 只有 `refreshFromAtlas`（管理员点击重新询价）会逐个询价并写库。
 */
@Injectable()
export class PriceBoardService {
  private readonly logger = new Logger(PriceBoardService.name);
  private refreshing?: Promise<QuoteFailure[]>;

  constructor(
    private readonly registry: AtlasModelRegistryService,
    private readonly pricing: PricingService,
  ) {}

  /** 价目表。每次从数据库现算，加价和汇率改了立刻反映出来 */
  async rows(): Promise<AdminPriceRow[]> {
    const [quotes] = await Promise.all([this.pricing.quotesById(), this.pricing.rates()]);
    const [video, image, audio] = await Promise.all(
      (['video', 'image', 'audio'] as const).map((kind) => this.registry.listModels(kind)),
    );
    const videoRows = await Promise.all(video.map((model) => this.videoRow(model)));
    const media = [
      ...videoRows,
      ...image.map((model) => this.mediaRow('image', model, quotes)),
      ...audio.map((model) => this.mediaRow('audio', model, quotes)),
    ];
    const text = (['llm', 'vision'] as const).flatMap((kind) =>
      this.registry.listTextModels(kind).map((model) => this.textRow(kind, model, quotes)),
    );
    return Promise.all([...media, ...text, ...pricedItems().map((item) => this.toolRow(item))]);
  }

  /** 视频工具 / 通用工具：售价 = 官方刊例价 × 加价系数，官方价可手填覆盖 */
  private async toolRow(item: PricedItem): Promise<AdminPriceRow> {
    const [rule, markup] = await Promise.all([this.pricing.rule(item.ruleId), this.pricing.markup(item.ruleId)]);
    const official = rule?.officialUnitCny ?? item.official;
    return {
      ...this.baseRow('tool', item.ruleId, item.name, undefined, item.unit, `${item.group} · ${item.basis}`),
      atlasModels: [item.ruleId],
      price: official * markup,
      costPrice: official,
      officialPrice: official,
      markup,
      markupOverride: rule?.markup ?? null,
      officialOverride: rule?.officialUnitCny ?? null,
      quotedAt: null,
      quoteError: null,
    };
  }

  /**
   * 管理员手动重新询价：先拉一次模型目录，再按 Atlas 模型 id 串行 calculate。
   * 某个形态失败时，沿用同系列已成功的报价；一个都没有时保留上次的价格并记下原因。
   */
  refreshFromAtlas(): Promise<QuoteFailure[]> {
    if (this.refreshing) return this.refreshing;
    const task = this.runRefresh().finally(() => {
      if (this.refreshing === task) this.refreshing = undefined;
    });
    this.refreshing = task;
    return task;
  }

  private async runRefresh(): Promise<QuoteFailure[]> {
    const failed: QuoteFailure[] = [];
    let catalog = new Map<string, CatalogEntry>();
    let catalogError = '';
    try {
      catalog = await this.pricing.pullCatalog();
      await sleep(QUOTE_GAP_MS);
    } catch (error) {
      catalogError = error instanceof Error ? error.message : String(error);
      this.logger.warn(catalogError);
    }

    let calls = 0;
    const calculate = async (body: Record<string, unknown>) => {
      if (calls > 0) await sleep(QUOTE_GAP_MS);
      calls += 1;
      return this.pricing.calculate(body);
    };

    for (const kind of ['video', 'image', 'audio'] as const) {
      const models = await this.registry.listModels(kind);
      for (const model of models) {
        if (model.provider && model.provider !== 'atlas') continue;
        failed.push(...(await this.quoteFamily(kind, this.variantProbes(kind, model), catalog, calculate)));
      }
    }

    const textModels = (['llm', 'vision'] as const).flatMap((kind) =>
      this.registry.listTextModels(kind).map((model) => ({ kind, model })),
    );
    if (catalogError) {
      for (const item of textModels) {
        if (item.model.provider === 'ark') continue;
        await this.pricing.markQuoteFailure(item.model.model, item.kind, catalogError);
        failed.push({ id: item.model.model, message: catalogError });
      }
    } else {
      for (const item of textModels) {
        if (item.model.provider === 'ark') continue;
        const error = await this.quoteText(item.kind, item.model.model, item.model.name, catalog);
        if (error) failed.push({ id: item.model.model, message: error });
      }
    }

    this.logger.log(`重新询价结束：媒体请求 ${calls} 次，失败 ${failed.length} 条`);
    return failed;
  }

  private async quoteFamily(
    kind: PriceKind,
    probes: Probe[],
    catalog: Map<string, CatalogEntry>,
    calculate: (body: Record<string, unknown>) => Promise<Awaited<ReturnType<PricingService['calculate']>>>,
  ): Promise<QuoteFailure[]> {
    const ok: string[] = [];
    const bad: QuoteFailure[] = [];
    for (const probe of probes) {
      const displayName = catalog.get(probe.atlasModel)?.displayName || probe.name;
      try {
        const quote = await calculate(probe.ref.body);
        await this.pricing.saveMediaQuote({
          id: probe.atlasModel,
          kind,
          scale: probe.ref.scale,
          usd: quote.usd,
          officialUsd: quote.officialUsd,
          discount: quote.discount,
          unit: probe.ref.unit,
          per: probe.ref.per,
          scenario: probe.ref.scenario,
          displayName,
          probe: probe.ref.body,
          raw: quote.raw,
        });
        ok.push(probe.atlasModel);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`${probe.atlasModel} 询价失败：${message}`);
        bad.push({ id: probe.atlasModel, message });
      }
    }

    const resolutionOf = (id: string) => (id.includes('@') ? id.slice(id.lastIndexOf('@') + 1) : '');
    const representative = probes[0]?.atlasModel;
    const failed: QuoteFailure[] = [];
    for (const item of bad) {
      const displayName = catalog.get(item.id)?.displayName || probes.find((probe) => probe.atlasModel === item.id)?.name;
      const donor = ok.find((id) => resolutionOf(id) === resolutionOf(item.id));
      const report = await this.pricing.settleProbeFailure(item.id, kind, item.message, donor, displayName);
      if (!report) this.logger.warn(`${item.id} 询价失败，沿用 ${donor} 的报价`);
      // 价目表一个系列只展示代表形态，提示也只针对这一行
      if (item.id === representative) {
        failed.push({ id: item.id, message: report ? item.message : '本次未直接询到，已沿用同系列报价' });
      }
    }
    return failed;
  }

  private async quoteText(
    kind: AtlasTextModelKind,
    atlasModel: string,
    name: string,
    catalog: Map<string, CatalogEntry>,
  ): Promise<string | null> {
    const entry = catalog.get(atlasModel);
    const input = Number(entry?.actual?.input_price);
    if (!entry || !Number.isFinite(input)) {
      const message = 'Atlas 目录里没有这个模型的 token 单价';
      await this.pricing.markQuoteFailure(atlasModel, kind, message);
      return message;
    }
    const num = (value: string | undefined) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const official = entry.origin ?? entry.actual;
    await this.pricing.saveLlmQuote({
      id: atlasModel,
      kind,
      displayName: entry.displayName || name,
      inputUsd: input,
      outputUsd: num(entry.actual?.output_price),
      cacheUsd: num(entry.actual?.cache_price) ?? input,
      officialInputUsd: num(official?.input_price),
      officialOutputUsd: num(official?.output_price),
      raw: { actual: entry.actual ?? null, origin: entry.origin ?? null },
    });
    return null;
  }

  /**
   * 价目只展示默认清晰度的单价，例如 Seedance 2.5 只显示 720p。
   * 其它清晰度仍在下单时单独计价，不出现在价目里。
   * atlasModels 含全部清晰度规则，保存系数时一起写入。
   */
  private async videoRow(model: MediaModelOption): Promise<AdminPriceRow> {
    const resolutions = model.resolutions.length ? model.resolutions : [model.defaultResolution || '720p'];
    const display = model.defaultResolution && resolutions.includes(model.defaultResolution) ? model.defaultResolution : resolutions[0];
    const ruleIds = [display, ...resolutions.filter((resolution) => resolution !== display)].map(
      (resolution) => `${model.id}@${resolution}`,
    );
    const rule = await this.pricing.rule(`${model.id}@${display}`);
    const quoted = await this.quoteVideoTier(model, display);
    let error = quoted.error;
    if (!error && quoted.cost != null && quoted.price != null && quoted.cost > 0 && quoted.price + 1e-6 < quoted.cost) {
      error = '当前售价低于成本，请提高售价系数';
    }
    const base = this.baseRow('video', model.id, model.name, model.tier, '秒', display);
    return {
      ...base,
      price: quoted.price,
      officialPrice: quoted.official,
      costPrice: quoted.cost,
      markup: rule?.discount ?? 1,
      markupOverride: null,
      officialOverride: rule?.officialUnitCny ?? null,
      atlasModels: ruleIds,
      pricingMode: 'video',
      discount: rule?.discount ?? 1,
      quotedAt: null,
      quoteError: error,
    };
  }

  /** 同一个售价系数要能覆盖每个清晰度，任一档低于成本就拒绝保存 */
  async assertVideoDiscount(modelId: string, discount: number): Promise<void> {
    const model = (await this.registry.listModels('video')).find((item) => item.id === modelId);
    if (!model) return;
    for (const resolution of model.resolutions) {
      const quoted = await this.quoteVideoTier(model, resolution);
      if (quoted.official == null || quoted.cost == null) continue;
      if (quoted.cost > 0 && quoted.official * discount + 1e-6 < quoted.cost) {
        throw new Error('售价不能低于成本，请提高售价系数');
      }
    }
  }

  private async quoteVideoTier(
    model: MediaModelOption,
    resolution: string,
  ): Promise<{ price: number | null; official: number | null; cost: number | null; error: string | null }> {
    const variant = model.variants.textToVideo ?? Object.values(model.variants)[0];
    try {
      const run = videoRunProfile(model.id, resolution);
      const quote = await this.pricing.quoteVideo({
        productId: model.id,
        provider: model.provider,
        userResolution: resolution,
        generateResolution: run.submitResolution || resolution,
        enhanceTarget: run.enhanceTo,
        durationSec: 1,
        ratio: '16:9',
        inputVideoSec: 0,
        inputImageCount: 0,
        atlasModel: variant?.model,
        enforceFloor: false,
      });
      return { price: quote.chargeCny, official: quote.officialCny, cost: quote.costCny, error: null };
    } catch (caught) {
      return { price: null, official: null, cost: null, error: caught instanceof Error ? caught.message : String(caught) };
    }
  }

  private variantProbes(kind: 'video' | 'image' | 'audio', model: MediaModelOption): Probe[] {
    const preferred = kind === 'video' ? 'textToVideo' : kind === 'image' ? 'textToImage' : model.variants.tts ? 'tts' : 'music';
    const seen = new Set<string>();
    const resolutions =
      kind === 'video'
        ? [...new Set([...(model.resolutions ?? []), ...videoRunProbeResolutions(model.id)])]
        : [undefined];
    return Object.entries(model.variants)
      .flatMap(([variantKey, variant]) => {
        if (!variant?.model) return [];
        return resolutions.map((resolution) => {
          const ref = referenceRequest(kind, model, variantKey, variant, resolution);
          return {
            atlasModel: resolution ? `${variant.model}@${resolution}` : variant.model,
            name: model.name,
            preferred: variantKey === preferred,
            ref,
          };
        });
      })
      .sort((a, b) => Number(b.preferred) - Number(a.preferred))
      .filter((probe) => {
        if (seen.has(probe.atlasModel)) return false;
        seen.add(probe.atlasModel);
        return true;
      })
      .map(({ atlasModel, name, ref }) => ({ atlasModel, name, ref }));
  }

  private async mediaRow(
    kind: 'video' | 'image' | 'audio',
    model: MediaModelOption,
    quotes: Map<string, ModelQuote>,
  ): Promise<AdminPriceRow> {
    if (kind === 'image' && model.provider === 'ark') return this.seedreamRow(model);
    if (kind === 'audio' && model.provider === 'speech') return this.speechRow(model);
    const variantKey = kind === 'video' ? 'textToVideo' : kind === 'image' ? 'textToImage' : model.variants.tts ? 'tts' : 'music';
    const variant = model.variants[variantKey] ?? Object.values(model.variants)[0]!;
    const ref = referenceRequest(kind, model, variantKey, variant);
    const stored = quotes.get(variant.model);
    const priced = stored?.usd != null;
    const per = stored && stored.per > 0 ? stored.per : ref.per;
    const rule = await this.pricing.rule(variant.model);
    const base = this.baseRow(kind, model.id, model.name, model.tier, stored?.unit || ref.unit, stored?.scenario || ref.scenario);
    const atlasModels = [...new Set(Object.values(model.variants).map((item) => item!.model))];
    const state = quoteState(stored, priced);
    if (!priced || stored?.usd == null) {
      return { ...base, atlasModels, ...(await this.ruleFields(variant.model, rule?.officialUnitCny)), ...state };
    }
    const [price, cost, official] = await Promise.all([
      this.pricing.cny(stored.usd, variant.model),
      this.pricing.cny(stored.usd, variant.model, false),
      this.pricing.cny(stored.officialUsd ?? stored.usd, variant.model, false),
    ]);
    return {
      ...base,
      atlasModels,
      price: price / per,
      costPrice: cost / per,
      officialPrice: rule?.officialUnitCny ?? official / per,
      markup: (await this.pricing.rates(variant.model)).markup,
      markupOverride: rule?.markup ?? null,
      officialOverride: rule?.officialUnitCny ?? null,
      ...state,
    };
  }

  private async textRow(
    kind: AtlasTextModelKind,
    model: AtlasTextModelEntry,
    quotes: Map<string, ModelQuote>,
  ): Promise<AdminPriceRow> {
    const builtin = arkTextRates(model.model);
    if (builtin) {
      const { markup } = await this.pricing.rates(model.model);
      const rule = await this.pricing.rule(model.model);
      const scenario = kind === 'vision' ? '视觉理解 · 按请求时点的高峰/空闲价' : '文案 · 按请求时点的高峰/空闲价';
      const base = this.baseRow(kind, model.id === 'deepseek' && kind === 'vision' ? 'deepseek-vision' : model.id, model.name, undefined, '百万 token', scenario);
      return {
        ...base,
        atlasModels: [model.model],
        price: builtin.input * markup,
        outputPrice: builtin.output * markup,
        officialPrice: builtin.input,
        outputOfficialPrice: builtin.output,
        costPrice: builtin.input,
        markup,
        markupOverride: rule?.markup ?? null,
        officialOverride: null,
        quotedAt: null,
        quoteError: null,
      };
    }
    const stored = quotes.get(model.model);
    const { fx, markup } = await this.pricing.rates(model.model);
    const rule = await this.pricing.rule(model.model);
    const priced = stored?.inputUsd != null;
    const yuan = (usd: number | null | undefined) => (usd == null ? null : usd * fx);
    const base = this.baseRow(kind, model.id, model.name, undefined, '百万 token', '输入 / 输出');
    return {
      ...base,
      atlasModels: [model.model],
      price: priced ? yuan(stored?.inputUsd)! * markup : null,
      outputPrice: priced ? (yuan(stored?.outputUsd) ?? 0) * markup : null,
      officialPrice: priced ? yuan(stored?.officialInputUsd) : null,
      outputOfficialPrice: priced ? yuan(stored?.officialOutputUsd) : null,
      costPrice: priced ? yuan(stored?.inputUsd) : null,
      markup,
      markupOverride: rule?.markup ?? null,
      officialOverride: null,
      ...quoteState(stored, priced),
    };
  }

  private async seedreamRow(model: MediaModelOption): Promise<AdminPriceRow> {
    const ruleId = model.upstreamModel || model.id;
    const { markup } = await this.pricing.rates(ruleId);
    const rule = await this.pricing.rule(ruleId);
    const ratio = model.defaultRatio || '1:1';
    const resolution = model.defaultResolution;
    const size = resolution ? model.sizeByRatio?.[resolution]?.[ratio] : undefined;
    const official = size ? seedreamCny(pixelsOf(size), 0) : 0.6;
    const base = this.baseRow('image', model.id, model.name, model.tier, '张', resolution ? `${resolution} 参考价` : '按张');
    return {
      ...base,
      atlasModels: [ruleId],
      price: official * markup,
      costPrice: official,
      officialPrice: official,
      markup,
      markupOverride: rule?.markup ?? null,
      officialOverride: null,
      quotedAt: null,
      quoteError: null,
    };
  }

  private async speechRow(model: MediaModelOption): Promise<AdminPriceRow> {
    const ruleId = model.upstreamModel || 'seed-tts-2.0';
    const { markup } = await this.pricing.rates(ruleId);
    const rule = await this.pricing.rule(ruleId);
    const official = 0.3;
    const base = this.baseRow('audio', model.id, model.name, model.tier, '千字', '3 元 / 万字符');
    return {
      ...base,
      atlasModels: [ruleId],
      price: official * markup,
      costPrice: official,
      officialPrice: official,
      markup,
      markupOverride: rule?.markup ?? null,
      officialOverride: null,
      quotedAt: null,
      quoteError: null,
    };
  }

  private async ruleFields(atlasModel: string, officialOverride: number | null | undefined) {
    const rule = await this.pricing.rule(atlasModel);
    return {
      costPrice: null as number | null,
      markup: (await this.pricing.rates(atlasModel)).markup,
      markupOverride: rule?.markup ?? null,
      officialOverride: officialOverride ?? null,
    };
  }

  private baseRow(
    kind: PriceKind,
    id: string,
    fullName: string,
    tier: 'flagship' | 'value' | undefined,
    unit: string,
    scenario: string,
  ): Omit<AdminPriceRow, 'atlasModels' | 'costPrice' | 'markup' | 'markupOverride' | 'officialOverride' | 'quotedAt' | 'quoteError'> {
    // 配置里的名称是 "厂商|型号"
    const [vendor, ...rest] = fullName.split('|');
    return {
      id,
      kind,
      vendor: rest.length ? vendor : '',
      name: rest.length ? rest.join('|') : fullName,
      tier,
      unit,
      scenario,
      price: null,
      officialPrice: null,
      pricingMode: 'markup',
      discount: null,
    };
  }
}

/** 对外只留用户能看的字段。没询到价的模型不进公开价目表。工具的官方价就是成本，不对外展示 */
export function toPublicRow(row: AdminPriceRow): PriceRow {
  if (row.kind === 'tool') row = { ...row, officialPrice: null };
  const {
    costPrice: _cost,
    markup: _markup,
    markupOverride: _override,
    officialOverride: _official,
    atlasModels: _models,
    quotedAt: _quotedAt,
    quoteError: _quoteError,
    discount: _discount,
    pricingMode: _mode,
    ...pub
  } = row;
  return pub;
}

/** 分销商能看到成本，但看不到加价系数、内部模型 id 和询价失败原因 */
export function toCostRow(row: AdminPriceRow) {
  const {
    markup: _markup,
    markupOverride: _override,
    officialOverride: _official,
    atlasModels: _models,
    quotedAt: _quotedAt,
    quoteError: _quoteError,
    discount: _discount,
    pricingMode: _mode,
    ...rest
  } = row;
  return rest;
}

function quoteState(stored: ModelQuote | undefined, priced: boolean): Pick<AdminPriceRow, 'quotedAt' | 'quoteError'> {
  return {
    quotedAt: stored?.quotedAt ? new Date(stored.quotedAt).toISOString() : null,
    quoteError: priced ? stored?.quoteError ?? null : stored?.quoteError || '尚未询价',
  };
}

/** 各类模型的典型询价请求：只带计价相关字段，越少越稳 */
function referenceRequest(
  kind: 'video' | 'image' | 'audio',
  model: MediaModelOption,
  variantKey: string,
  variant: AtlasVariantSpec,
  resolutionOverride?: string,
): Reference {
  if (kind === 'video') {
    const allowed = variant.durationValues?.length ? variant.durationValues : model.durationValues;
    const seconds = allowed?.[0] ?? Math.min(Math.max(REFERENCE_SECONDS, model.minDuration), model.maxDuration);
    const resolution = resolutionOverride ?? (!variant.omitResolution && model.resolutions.length ? model.defaultResolution : undefined);
    return {
      body: { model: variant.model, prompt: 'price probe', duration: seconds, ...(resolution && { resolution }) },
      unit: '秒',
      per: seconds,
      scale: 'second',
      scenario: [resolution, `按 ${seconds} 秒折算`].filter(Boolean).join(' · '),
    };
  }
  if (kind === 'image') {
    return {
      body: { model: variant.model, prompt: 'price probe' },
      unit: '张',
      per: 1,
      scale: 'image',
      scenario: model.defaultResolution ? `${model.defaultResolution} 默认尺寸` : '默认尺寸',
    };
  }
  return variantKey === 'tts'
    ? { body: { model: variant.model, text: '价'.repeat(1000) }, unit: '千字', per: 1, scale: 'thousand_chars', scenario: '1000 字配音' }
    : { body: { model: variant.model, prompt: 'price probe', is_instrumental: true }, unit: '首', per: 1, scale: 'each', scenario: '纯器乐配乐' };
}
