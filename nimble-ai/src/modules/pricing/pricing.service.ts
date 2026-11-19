import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { AxiosInstance } from 'axios';
import { Repository } from 'typeorm';
import { createRetryableHttpClient, formatHttpError } from '../../common/http/retryable-http-client';
import { arkTextRates, doubaoTtsCny, enhanceCny, minimaxCny, seedanceCny, seedreamCny } from './commerce';
import { ModelQuote, QuoteScale } from './entities/model-quote.entity';
import { GLOBAL_RULE_ID, PricingRule } from './entities/pricing-rule.entity';

const DEFAULT_MARKUP = 1;
const RULES_TTL_MS = 30_000;
/** 欧洲央行参考汇率每个工作日更新一次，本地缓存一小时 */
const FX_TTL_MS = 60 * 60_000;
const FX_URL = 'https://api.frankfurter.app/latest?from=USD&to=CNY';
/** 浮点误差容忍：2.16 * 100 会得到 216.00000000000003，不能因此多收 1 分 */
const CENT_EPSILON = 1e-6;

interface CatalogPriceSide {
  base_price?: string;
  input_price?: string;
  output_price?: string;
  cache_price?: string;
}

/** Atlas 公开目录里和计价有关的字段。文本单价是美元 / 百万 token */
export interface CatalogEntry {
  model: string;
  type?: string;
  displayName: string;
  actual?: CatalogPriceSide;
  origin?: CatalogPriceSide;
}

export interface Quote {
  /** Atlas 实付价（美元），已按本次用量从库存报价折算 */
  usd: number;
  /** Atlas 官方价（美元） */
  officialUsd: number;
  /** 用户应付，单位分，已含汇率和加价 */
  cents: number;
  /** 上游成本，单位分：Atlas 实付价 × 汇率，不含加价，不取整 */
  upstreamCents: number;
}

/** 文本模型单价，元 / 百万 token */
export interface LlmRates {
  /** 单价里已经乘进去的加价系数，除回去就是上游成本 */
  markup: number;
  input: number;
  output: number;
  cache: number;
  officialInput: number;
  officialOutput: number;
}

export interface PricingSettings {
  /** 美元兑人民币，来自汇率接口 */
  usdCny: number;
  /** 汇率发布时间，北京时间 */
  fxUpdatedAt: string;
  markup: number;
}

export interface CalculatedQuote {
  usd: number;
  officialUsd: number;
  discount: number | null;
  raw: Record<string, unknown>;
}

export interface MediaQuoteInput {
  id: string;
  kind: string;
  scale: QuoteScale;
  usd: number;
  officialUsd: number;
  discount: number | null;
  unit: string;
  per: number;
  scenario: string;
  displayName: string;
  probe: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface LlmQuoteInput {
  id: string;
  kind: string;
  displayName: string;
  inputUsd: number;
  outputUsd: number | null;
  cacheUsd: number | null;
  officialInputUsd: number | null;
  officialOutputUsd: number | null;
  raw: Record<string, unknown>;
}

export const unquotedModelMessage = (model: string) =>
  `模型「${model}」尚未询价，请管理员在「模型定价」页点击重新询价`;

export interface VideoQuoteInput {
  productId: string;
  provider: 'atlas' | 'ark' | 'minimax' | 'speech' | string;
  userResolution: string;
  generateResolution: string;
  enhanceTarget?: string;
  durationSec: number;
  ratio: string;
  inputVideoSec: number;
  inputImageCount: number;
  atlasModel?: string;
  /** 后台预览时关掉，否则低于成本的系数会直接抛错，页面看不到数 */
  enforceFloor?: boolean;
}

export interface VideoQuote {
  model: string;
  cents: number;
  upstreamCents: number;
  officialCny: number;
  costCny: number;
  chargeCny: number;
  discount: number;
}

/**
 * 定价中心：Atlas 报价只在管理员手动重新询价时拉取并落库。
 * 价目表、生成扣费、文本模型结算都读 `model_quote`，再乘实时汇率和加价系数。
 *
 * - 图片 / 视频 / 音频：库存的询价总价按秒、张、千字、首折算
 * - 文本模型：库存的 token 单价
 * - 汇率取自公开接口并缓存，不读环境变量
 * - 加价系数存库，修改后立即生效，不会再次请求 Atlas
 *
 * 不依赖模型注册表，避免和 Atlas 客户端、计费形成循环依赖。
 */
@Injectable()
export class PricingService implements OnModuleInit {
  private readonly logger = new Logger(PricingService.name);
  private readonly http: AxiosInstance;
  private rules?: { at: number; map: Map<string, PricingRule> };
  private fx?: { at: number; rate: number; updatedAt: string };
  private fxLoading?: Promise<{ rate: number; updatedAt: string }>;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PricingRule) private readonly ruleRepo: Repository<PricingRule>,
    @InjectRepository(ModelQuote) private readonly quoteRepo: Repository<ModelQuote>,
  ) {
    this.http = createRetryableHttpClient({
      baseURL: this.config.get<string>('ATLASCLOUD_BASE_URL', 'https://api.atlascloud.ai/api/v1'),
      apiKey: this.config.get<string>('ATLASCLOUD_API_KEY', ''),
      timeoutMs: 30_000,
      logger: this.logger,
    });
  }

  async onModuleInit() {
    await this.ensureSchema();
  }

  /** 生产环境关闭了 synchronize，启动时把询价表补上 */
  private async ensureSchema() {
    await this.quoteRepo.query(`
      CREATE TABLE IF NOT EXISTS "model_quote" (
        "id" character varying(160) PRIMARY KEY,
        "kind" character varying(16) NOT NULL,
        "scale" character varying(32) NOT NULL DEFAULT 'each',
        "usd" numeric(14,8),
        "official_usd" numeric(14,8),
        "discount" numeric(8,4),
        "unit" character varying(32) NOT NULL DEFAULT '',
        "per" numeric(12,4) NOT NULL DEFAULT 1,
        "scenario" character varying(128) NOT NULL DEFAULT '',
        "display_name" character varying(200) NOT NULL DEFAULT '',
        "probe" jsonb,
        "raw" jsonb,
        "input_usd" numeric(14,8),
        "output_usd" numeric(14,8),
        "cache_usd" numeric(14,8),
        "official_input_usd" numeric(14,8),
        "official_output_usd" numeric(14,8),
        "inherited_from" character varying(160),
        "quote_error" text,
        "quoted_at" timestamp
      )
    `);
    await this.ruleRepo.query(`ALTER TABLE "pricing_rule" ADD COLUMN IF NOT EXISTS "discount" numeric(8,4)`);
  }

  // ───────────────────────── 读库报价 ─────────────────────────

  /** 用库存报价按本次用量折算。没有报价就抛错，绝不回退去调 Atlas */
  async quote(body: Record<string, unknown>): Promise<Quote> {
    const model = String(body.model ?? '');
    if (!model) throw new Error('报价失败：缺少模型');
    const stored = await this.quoteRepo.findOne({ where: { id: model } });
    if (stored?.usd == null) throw new Error(unquotedModelMessage(model));
    const per = stored.per > 0 ? stored.per : 1;
    const factor = this.factor(stored, body);
    const usd = (stored.usd / per) * factor;
    const officialBase = stored.officialUsd ?? stored.usd;
    const officialUsd = (officialBase / per) * factor;
    if (!Number.isFinite(usd) || usd < 0) throw new Error('报价失败：本地报价无效');
    return {
      usd,
      officialUsd,
      cents: usd === 0 ? 0 : await this.toCents(usd, model),
      upstreamCents: (await this.cny(usd, model, false)) * 100,
    };
  }

  /** 用户价（元）。markup=false 时得到不含加价的成本 / 官方价 */
  async cny(usd: number, atlasModel?: string, markup = true): Promise<number> {
    const rate = await this.rates(atlasModel);
    return usd * rate.fx * (markup ? rate.markup : 1);
  }

  /** 美元折算成分，向上取整，最低 1 分 */
  async toCents(usd: number, atlasModel?: string): Promise<number> {
    return Math.max(1, Math.ceil((await this.cny(usd, atlasModel)) * 100 - CENT_EPSILON));
  }

  /** 文本模型 token 单价。方舟刊例价不依赖询价表；其余模型库里没有时返回 null */
  async llmRates(atlasModel: string): Promise<LlmRates | null> {
    const builtin = arkTextRates(atlasModel);
    if (builtin) {
      const { markup } = await this.rates(atlasModel);
      return {
        markup,
        input: builtin.input * markup,
        output: builtin.output * markup,
        cache: builtin.cache * markup,
        officialInput: builtin.input,
        officialOutput: builtin.output,
      };
    }
    const row = await this.quoteRepo.findOne({ where: { id: atlasModel } });
    if (row?.inputUsd == null) return null;
    const { fx, markup } = await this.rates(atlasModel);
    const yuan = (usd: number | null, fallback = 0) => (usd ?? fallback) * fx;
    const input = yuan(row.inputUsd);
    return {
      markup,
      input: input * markup,
      output: yuan(row.outputUsd) * markup,
      cache: yuan(row.cacheUsd, row.inputUsd) * markup,
      officialInput: yuan(row.officialInputUsd),
      officialOutput: yuan(row.officialOutputUsd),
    };
  }

  /** 流水备注里用的模型名 */
  async displayName(atlasModel: string): Promise<string> {
    if (!atlasModel) return atlasModel;
    try {
      const row = await this.quoteRepo.findOne({ where: { id: atlasModel }, select: { id: true, displayName: true } });
      return row?.displayName || atlasModel;
    } catch {
      return atlasModel;
    }
  }

  async quotesById(): Promise<Map<string, ModelQuote>> {
    const rows = await this.quoteRepo.find();
    return new Map(rows.map((row) => [row.id, row]));
  }

  private factor(row: ModelQuote, body: Record<string, unknown>): number {
    const per = row.per > 0 ? row.per : 1;
    switch (row.scale) {
      case 'second': {
        const duration = Number(body.duration);
        if (!Number.isFinite(duration) || duration <= 0) throw new Error('报价失败：缺少有效时长');
        return duration;
      }
      case 'thousand_chars': {
        if (typeof body.text !== 'string') throw new Error('报价失败：缺少配音文本');
        return body.text.length / 1000;
      }
      case 'image':
      case 'each':
        return per;
      case 'token':
        throw new Error('报价失败：文本模型不按次扣费');
      default:
        throw new Error('报价失败：未知的计价方式');
    }
  }

  // ───────────────────────── 手动询价才写库 ─────────────────────────

  /** 拉一次公开目录，供重新询价时取文本单价和展示名。不要在读价路径调用 */
  async pullCatalog(): Promise<Map<string, CatalogEntry>> {
    let data: { data?: unknown } | unknown;
    try {
      ({ data } = await this.http.get('/models'));
    } catch (error) {
      throw new Error(`模型目录获取失败：${formatHttpError(error)}`);
    }
    const payload = data as { data?: unknown };
    const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(data) ? data : [];
    const map = new Map<string, CatalogEntry>();
    for (const item of list as Array<CatalogEntry & { price?: { actual?: CatalogPriceSide; origin?: CatalogPriceSide } }>) {
      if (!item?.model) continue;
      map.set(item.model, {
        model: item.model,
        type: item.type,
        displayName: item.displayName || item.model,
        actual: item.price?.actual,
        origin: item.price?.origin,
      });
    }
    return map;
  }

  /** 向 Atlas 询一次价。只给手动重新询价用 */
  async calculate(body: Record<string, unknown>): Promise<CalculatedQuote> {
    const { webhook_url: _webhook, ...payload } = body;
    let info: Record<string, unknown> | undefined;
    try {
      const { data } = await this.http.post('/model/calculate', payload);
      info = data?.data ?? data;
    } catch (error) {
      throw new Error(formatHttpError(error));
    }
    const usd = Number(info?.price);
    if (!Number.isFinite(usd) || usd < 0) throw new Error('Atlas 未返回价格');
    const official = Number(info?.origin_price);
    const discount = Number(info?.discount);
    return {
      usd,
      officialUsd: Number.isFinite(official) ? official : usd,
      discount: Number.isFinite(discount) ? discount : null,
      raw: info ?? {},
    };
  }

  async saveMediaQuote(input: MediaQuoteInput) {
    await this.quoteRepo.save(
      this.quoteRepo.create({
        id: input.id,
        kind: input.kind,
        scale: input.scale,
        usd: input.usd,
        officialUsd: input.officialUsd,
        discount: input.discount,
        unit: input.unit,
        per: input.per > 0 ? input.per : 1,
        scenario: input.scenario.slice(0, 128),
        displayName: input.displayName.slice(0, 200),
        probe: input.probe,
        raw: input.raw,
        inputUsd: null,
        outputUsd: null,
        cacheUsd: null,
        officialInputUsd: null,
        officialOutputUsd: null,
        inheritedFrom: null,
        quoteError: null,
        quotedAt: new Date(),
      }),
    );
  }

  async saveLlmQuote(input: LlmQuoteInput) {
    await this.quoteRepo.save(
      this.quoteRepo.create({
        id: input.id,
        kind: input.kind,
        scale: 'token',
        usd: null,
        officialUsd: null,
        discount: null,
        unit: '百万 token',
        per: 1,
        scenario: '输入 / 输出',
        displayName: input.displayName.slice(0, 200),
        probe: null,
        raw: input.raw,
        inputUsd: input.inputUsd,
        outputUsd: input.outputUsd,
        cacheUsd: input.cacheUsd,
        officialInputUsd: input.officialInputUsd,
        officialOutputUsd: input.officialOutputUsd,
        inheritedFrom: null,
        quoteError: null,
        quotedAt: new Date(),
      }),
    );
  }

  /** 同一系列里询价失败的形态，沿用已经成功的那条，避免图生 / 参考生没有价格 */
  async copyMediaQuote(fromId: string, toId: string, kind: string, displayName?: string): Promise<boolean> {
    if (fromId === toId) return true;
    const src = await this.quoteRepo.findOne({ where: { id: fromId } });
    if (src?.usd == null) return false;
    await this.quoteRepo.save(
      this.quoteRepo.create({
        id: toId,
        kind,
        scale: src.scale,
        usd: src.usd,
        officialUsd: src.officialUsd,
        discount: src.discount,
        unit: src.unit,
        per: src.per,
        scenario: src.scenario,
        displayName: (displayName || src.displayName).slice(0, 200),
        probe: src.probe,
        raw: src.raw,
        inputUsd: null,
        outputUsd: null,
        cacheUsd: null,
        officialInputUsd: null,
        officialOutputUsd: null,
        inheritedFrom: fromId,
        quoteError: '本次未直接询到，已沿用同系列报价',
        quotedAt: new Date(),
      }),
    );
    return true;
  }

  /**
   * 这一形态本次没询到。
   * 自己以前询成功过就保留旧价；否则尽量沿用同系列刚询到的价格；都没有就记一笔失败。
   * 返回 true 表示没有沿用到同系列的新报价（可能仍留着上次自己询到的价格）。
   */
  async settleProbeFailure(id: string, kind: string, message: string, donorId?: string, displayName?: string): Promise<boolean> {
    const existing = await this.quoteRepo.findOne({ where: { id } });
    if (existing?.usd != null && !existing.inheritedFrom) {
      await this.quoteRepo.update(id, { quoteError: message.slice(0, 500) });
      return true;
    }
    if (donorId && (await this.copyMediaQuote(donorId, id, kind, displayName))) return false;
    await this.markQuoteFailure(id, kind, message);
    return true;
  }

  /**
   * 询价失败：已有价格就只记下错误，不覆盖旧价；从没有成功过就留一行空报价，方便后台看到原因。
   */
  async markQuoteFailure(id: string, kind: string, message: string) {
    const text = message.slice(0, 500);
    const existing = await this.quoteRepo.findOne({ where: { id } });
    if (existing && (existing.usd != null || existing.inputUsd != null)) {
      await this.quoteRepo.update(id, { quoteError: text });
      return;
    }
    await this.quoteRepo.save(
      this.quoteRepo.create({
        id,
        kind,
        scale: existing?.scale ?? 'each',
        usd: null,
        officialUsd: null,
        discount: null,
        unit: existing?.unit ?? '',
        per: existing?.per ?? 1,
        scenario: existing?.scenario ?? '',
        displayName: existing?.displayName ?? '',
        probe: null,
        raw: null,
        inputUsd: null,
        outputUsd: null,
        cacheUsd: null,
        officialInputUsd: null,
        officialOutputUsd: null,
        inheritedFrom: null,
        quoteError: text,
        quotedAt: null,
      }),
    );
  }

  // ───────────────────────── 规则 ─────────────────────────

  async settings(): Promise<PricingSettings> {
    const fx = await this.exchangeRate();
    return { usdCny: fx.rate, fxUpdatedAt: fx.updatedAt, markup: (await this.rates()).markup };
  }

  async rule(atlasModel: string): Promise<PricingRule | undefined> {
    return (await this.loadRules()).get(atlasModel);
  }

  /** 丢掉汇率缓存，下次计价重新请求接口。失败时仍可回退到上一次成功的汇率 */
  refreshExchangeRate(): Promise<{ rate: number; updatedAt: string }> {
    if (this.fx) this.fx.at = 0;
    return this.exchangeRate();
  }

  async saveSettings(patch: { markup?: number | null }): Promise<PricingSettings> {
    await this.patchRules([GLOBAL_RULE_ID], patch);
    return this.settings();
  }

  /** 同一个模型系列下所有调用形态共用一套规则，所以一次写多个模型 id */
  async saveModelRules(
    atlasModels: string[],
    patch: { markup?: number | null; officialUnitCny?: number | null; discount?: number | null },
  ) {
    await this.patchRules(atlasModels, patch);
  }

  /**
   * 视频报价。售价按用户所选规格的官方价乘售价系数。
   * enforceFloor 为 false 时只给后台看数，不拦截低于成本的系数。
   */
  async quoteVideo(input: VideoQuoteInput): Promise<VideoQuote> {
    const ruleId = `${input.productId}@${input.userResolution}`;
    const rule = await this.rule(ruleId);
    const discount = rule?.discount ?? 1;
    let official = rule?.officialUnitCny != null ? rule.officialUnitCny * input.durationSec : 0;
    let cost = 0;
    if (rule?.officialUnitCny == null) {
      if (input.provider === 'ark') {
        official = seedanceCny(input.productId, input.userResolution, input.ratio, input.durationSec, input.inputVideoSec);
      } else if (input.provider === 'minimax') {
        official = minimaxCny(input.userResolution, input.durationSec, input.inputVideoSec, input.inputImageCount);
      } else {
        official = await this.atlasUnitCny(input.atlasModel, input.userResolution, input.durationSec, 'official');
      }
    }
    if (input.provider === 'ark') {
      cost = seedanceCny(input.productId, input.generateResolution, input.ratio, input.durationSec, input.inputVideoSec);
    } else if (input.provider === 'minimax') {
      cost = minimaxCny(input.generateResolution, input.durationSec, input.inputVideoSec, input.inputImageCount);
    } else {
      cost = await this.atlasUnitCny(input.atlasModel, input.generateResolution, input.durationSec, 'actual');
    }
    if (input.enhanceTarget) cost += enhanceCny(input.enhanceTarget, input.durationSec);
    const charge = official * discount;
    if (input.enforceFloor !== false && cost > 0 && charge + 1e-6 < cost) {
      throw new Error('该清晰度暂不可用，请更换清晰度后再试');
    }
    return {
      model: ruleId,
      cents: charge <= 0 ? 0 : Math.max(1, Math.ceil(charge * 100 - CENT_EPSILON)),
      upstreamCents: Math.max(0, cost * 100),
      officialCny: official,
      costCny: cost,
      chargeCny: charge,
      discount,
    };
  }

  /** Seedream 按张。售价 = 官方价 × 加价系数，成本就是官方价 */
  async quoteSeedream(pixels: number, imageCount: number, ruleId: string): Promise<VideoQuote> {
    const { markup } = await this.rates(ruleId);
    const official = seedreamCny(pixels, imageCount);
    const charge = official * markup;
    return {
      model: ruleId,
      cents: charge <= 0 ? 0 : Math.max(1, Math.ceil(charge * 100 - CENT_EPSILON)),
      upstreamCents: official * 100,
      officialCny: official,
      costCny: official,
      chargeCny: charge,
      discount: markup,
    };
  }

  /** 豆包语音按字符。售价 = 官方价 × 加价系数 */
  async quoteSpeech(chars: number, ruleId: string): Promise<VideoQuote> {
    const { markup } = await this.rates(ruleId);
    const official = doubaoTtsCny(chars);
    const charge = official * markup;
    return {
      model: ruleId,
      cents: charge <= 0 ? 0 : Math.max(1, Math.ceil(charge * 100 - CENT_EPSILON)),
      upstreamCents: official * 100,
      officialCny: official,
      costCny: official,
      chargeCny: charge,
      discount: markup,
    };
  }

  private async atlasUnitCny(
    atlasModel: string | undefined,
    resolution: string,
    durationSec: number,
    side: 'official' | 'actual',
  ): Promise<number> {
    if (!atlasModel) throw new Error('报价失败：缺少模型');
    const stored = await this.quoteRepo.findOne({ where: { id: `${atlasModel}@${resolution}` } });
    const usd = side === 'official' ? (stored?.officialUsd ?? stored?.usd) : stored?.usd;
    if (usd == null) throw new Error(unquotedModelMessage(`${atlasModel}@${resolution}`));
    const per = stored && stored.per > 0 ? stored.per : 1;
    return (usd / per) * durationSec * (await this.rates()).fx;
  }

  private async patchRules(ids: string[], patch: Partial<Omit<PricingRule, 'id' | 'updatedAt'>>) {
    const changes = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    const existing = await this.ruleRepo.findBy(ids.map((id) => ({ id })));
    const byId = new Map(existing.map((r) => [r.id, r]));
    await this.ruleRepo.save(
      ids.map((id) =>
        Object.assign(
          byId.get(id) ?? this.ruleRepo.create({ id, markup: null, usdCny: null, officialUnitCny: null, discount: null }),
          changes,
        ),
      ),
    );
    this.rules = undefined;
  }

  /** 加价系数和汇率。汇率不走配置 */
  async rates(atlasModel?: string) {
    return { fx: (await this.exchangeRate()).rate, markup: await this.markup(atlasModel) };
  }

  /** 加价系数：单个规则优先，其次全局规则，最后环境变量与内置默认值。人民币计价的工具只用它，不依赖汇率接口 */
  async markup(ruleId?: string): Promise<number> {
    const rules = await this.loadRules();
    return (
      (ruleId ? rules.get(ruleId)?.markup : null) ??
      rules.get(GLOBAL_RULE_ID)?.markup ??
      this.envNumber('PRICING_MARKUP') ??
      DEFAULT_MARKUP
    );
  }

  private async exchangeRate(): Promise<{ rate: number; updatedAt: string }> {
    if (this.fx && Date.now() - this.fx.at < FX_TTL_MS) return this.fx;
    this.fxLoading ??= this.fetchExchangeRate().finally(() => {
      this.fxLoading = undefined;
    });
    try {
      return await this.fxLoading;
    } catch (error) {
      if (this.fx) {
        this.fx.at = Date.now();
        this.logger.warn(`汇率刷新失败，沿用 ${this.fx.updatedAt} 的 ${this.fx.rate}：${error instanceof Error ? error.message : error}`);
        return this.fx;
      }
      throw error;
    }
  }

  private async fetchExchangeRate(): Promise<{ rate: number; updatedAt: string }> {
    let body: { date?: string; rates?: { CNY?: number } };
    try {
      const response = await fetch(FX_URL, {
        headers: { 'User-Agent': 'lingmi-pricing' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      body = (await response.json()) as typeof body;
    } catch (error) {
      throw new Error(`汇率获取失败：${error instanceof Error ? error.message : error}`);
    }
    const rate = Number(body.rates?.CNY);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error('汇率获取失败：接口未返回有效的美元兑人民币汇率');
    }
    const updatedAt = body.date ?? '';
    this.fx = { at: Date.now(), rate, updatedAt };
    this.logger.log(`美元兑人民币汇率 ${rate}（${updatedAt || '日期未知'}）`);
    return { rate, updatedAt };
  }

  private async loadRules(): Promise<Map<string, PricingRule>> {
    if (this.rules && Date.now() - this.rules.at < RULES_TTL_MS) return this.rules.map;
    const map = new Map((await this.ruleRepo.find()).map((r) => [r.id, r]));
    this.rules = { at: Date.now(), map };
    return map;
  }

  private envNumber(key: string): number | undefined {
    const n = Number(this.config.get<string>(key));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
}
