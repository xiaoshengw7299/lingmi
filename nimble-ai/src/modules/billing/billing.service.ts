import { randomBytes } from 'crypto';
import { HttpException, HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PayClientService } from '../pay/pay-client.service';
import { WalletService } from '../pay/wallet.service';
import { PricingService, unquotedModelMessage } from '../pricing/pricing.service';
import { RedisService } from '../redis/redis.service';
import { currentBillingUser, isBillingWaived } from './billing-context';
import { User } from '../user/entities/user.entity';
import { UsageKind, UsageLog } from './entities/usage-log.entity';

export type MediaKind = 'image' | 'video' | 'audio' | 'tool';

/** 一次已扣款的凭证。任务失败时凭它退回 */
export interface ChargeTicket {
  userId: string;
  bizNo: string;
  cents: number;
}

/** 文本模型用量，结构兼容 AI SDK 的 usage */
export interface LlmUsage {
  inputTokens: { total?: number; noCache?: number; cacheRead?: number };
  outputTokens: { total?: number };
}

const KIND_LABEL: Record<MediaKind, string> = { image: '图片生成', video: '视频生成', audio: '音频生成', tool: '智能工具' };
/** 异步任务的扣款凭证保留时间，覆盖最长的视频轮询窗口 */
const TASK_TTL_SEC = 3 * 24 * 3600;
const REFUND_ATTEMPTS = 3;

/** pg 的布尔值经原始查询可能是 boolean，也可能是 't' / 'true' */
const flag = (v: unknown) => v === true || v === 'true' || v === 't' || v === 1 || v === '1';

const taskKey = (predictionId: string) => `billing:task:${predictionId}`;
const accrualKey = (userId: string) => `billing:accrual:${userId}`;
const newBizNo = (prefix: string) => `${prefix}${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 计费：统一的扣费与退款入口。
 *
 * - 图片/视频/音频：提交前按已保存的报价折算并扣款，提交失败或任务失败自动退回
 * - 文本模型：事后按已保存的 token 单价和真实用量结算，不足 1 分的零头累计在 Redis 里，攒够 1 分再扣
 *
 * 只在支付服务配置好时生效；本地开发没配 nimblePay 就是免费的。
 * 找不到计费用户（比如漏了 runWithBilling）时放行并告警，不会让业务直接报错。
 */
@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);
  private readonly warned = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly pay: PayClientService,
    private readonly wallet: WalletService,
    private readonly pricing: PricingService,
    private readonly redis: RedisService,
    @InjectRepository(UsageLog) private readonly usage: Repository<UsageLog>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  onModuleInit() {
    if (!this.enabled()) {
      this.logger.warn('计费未开启（未配置 NIMBLEPAY_* 或 BILLING_ENABLED=false），所有生成都不会扣费');
    }
  }

  enabled(): boolean {
    return this.config.get<string>('BILLING_ENABLED') !== 'false' && this.pay.enabled();
  }

  // ───────────────────────── 图片 / 视频 / 音频 ─────────────────────────

  /** 按已保存的报价折算并扣款。返回 null 表示这次不需要扣（未开启计费、没有用户、免费模型） */
  async chargeMedia(kind: MediaKind, body: Record<string, unknown>): Promise<ChargeTicket | null> {
    const userId = this.billedUser(`${kind} 生成`);
    if (!userId) return null;
    const quote = await this.pricing.quote(body);
    if (quote.cents === 0) return null;
    const bizNo = newBizNo('m');
    const atlasModel = String(body.model ?? '');
    const modelName = await this.pricing.displayName(atlasModel);
    const charged = await this.pay.consume({
      externalUserId: userId,
      amountCents: quote.cents,
      bizNo,
      remark: `${KIND_LABEL[kind]} · ${modelName}`,
    });
    this.remember(userId, charged.balanceCents);
    await this.recordUsage({
      userId,
      kind,
      model: atlasModel,
      modelName,
      chargeCents: quote.cents,
      upstreamCents: quote.upstreamCents,
      bizNo,
    });
    return { userId, bizNo, cents: quote.cents };
  }

  /**
   * 按调用方算好的金额扣款。视频用它按用户所选规格收费，
   * 上游成本由调用方传入，不从请求体里的生成规格反推。
   * partial：任务已经做完后的补扣，余额不够时扣到 0 为止，不抛 402。
   */
  async chargeQuoted(
    kind: MediaKind,
    input: { model: string; modelName: string; cents: number; upstreamCents: number; partial?: boolean },
  ): Promise<ChargeTicket | null> {
    const userId = this.billedUser(`${kind} 生成`);
    if (!userId) return null;
    if (input.cents <= 0) return null;
    const bizNo = newBizNo('m');
    const charged = await this.pay.consume({
      externalUserId: userId,
      amountCents: input.cents,
      bizNo,
      remark: `${KIND_LABEL[kind]} · ${input.modelName}`,
      ...(input.partial ? { partial: true } : {}),
    });
    this.remember(userId, charged.balanceCents);
    await this.recordUsage({
      userId,
      kind,
      model: input.model,
      modelName: input.modelName,
      chargeCents: input.cents,
      upstreamCents: input.upstreamCents,
      bizNo,
    });
    return { userId, bizNo, cents: input.cents };
  }

  /** 任务提交成功后记下凭证，任务失败时按任务 id 找回来退款 */
  async bind(ticket: ChargeTicket | null, predictionId: string) {
    if (ticket) await this.redis.set(taskKey(predictionId), ticket, TASK_TTL_SEC);
  }

  /** 任务成功：销毁凭证，之后不可能再被退款 */
  async settle(predictionId: string) {
    await this.redis.del(taskKey(predictionId));
  }

  /** 任务失败或超时：按任务 id 退回。幂等 */
  async refundTask(predictionId: string) {
    const ticket = await this.redis.get<ChargeTicket>(taskKey(predictionId));
    if (ticket && (await this.refund(ticket))) await this.redis.del(taskKey(predictionId));
  }

  async refund(ticket: ChargeTicket | null): Promise<boolean> {
    if (!ticket) return true;
    for (let attempt = 1; attempt <= REFUND_ATTEMPTS; attempt++) {
      try {
        const r = await this.pay.refundConsume(ticket.userId, ticket.bizNo);
        this.remember(ticket.userId, r.balanceCents);
        void this.usage.update({ bizNo: ticket.bizNo }, { refunded: true }).catch(() => undefined);
        return true;
      } catch (error) {
        if (attempt === REFUND_ATTEMPTS) {
          this.logger.error(
            `退款失败，需人工处理 user=${ticket.userId} bizNo=${ticket.bizNo} ${ticket.cents} 分：${error instanceof Error ? error.message : error}`,
          );
        } else {
          await sleep(500 * attempt);
        }
      }
    }
    return false;
  }

  // ───────────────────────── 文本模型 ─────────────────────────

  /** 文本模型没有落库报价时直接拒绝，避免调用之后才发现没法计价 */
  async assertLlmPriced(atlasModel: string) {
    if (!this.enabled() || isBillingWaived()) return;
    if (!(await this.pricing.llmRates(atlasModel))) throw new Error(unquotedModelMessage(atlasModel));
  }

  /** 调用文本模型之前：确认有计费用户且余额为正。返回用户 id 供事后结算 */
  async guardLlm(): Promise<string | undefined> {
    const userId = this.billedUser('文本模型');
    if (userId) await this.assertCanSpend(userId);
    return userId;
  }

  /** 事后结算，不阻塞也不影响调用方：失败只记日志，零头会留在累计里下次再扣 */
  chargeLlm(userId: string | undefined, atlasModel: string, usage: LlmUsage) {
    if (!userId) return;
    void this.settleLlm(userId, atlasModel, usage).catch((error) =>
      this.logger.warn(`文本模型结算失败 user=${userId} model=${atlasModel}：${error instanceof Error ? error.message : error}`),
    );
  }

  private async settleLlm(userId: string, atlasModel: string, usage: LlmUsage) {
    const rates = await this.pricing.llmRates(atlasModel);
    if (!rates) {
      this.logger.warn(`${unquotedModelMessage(atlasModel)}，本次未扣费`);
      return;
    }
    const cacheRead = usage.inputTokens.cacheRead ?? 0;
    const fresh = usage.inputTokens.noCache ?? Math.max(0, (usage.inputTokens.total ?? 0) - cacheRead);
    const cny = (fresh * rates.input + cacheRead * rates.cache + (usage.outputTokens.total ?? 0) * rates.output) / 1_000_000;
    await this.recordUsage({
      userId,
      kind: 'llm',
      model: atlasModel,
      modelName: await this.pricing.displayName(atlasModel),
      chargeCents: cny * 100,
      upstreamCents: (cny * 100) / rates.markup,
    });
    await this.accrue(userId, cny * 100);
  }

  /**
   * 写一行账单。款已经扣了，写失败只能记日志，不能让生成任务跟着失败。
   * 调用方要等它写完再往下走，这样后面的退款回写一定找得到这一行。
   */
  private async recordUsage(entry: {
    userId: string;
    kind: UsageKind;
    model: string;
    modelName: string;
    chargeCents: number;
    upstreamCents: number;
    bizNo?: string;
  }) {
    try {
      const share = await this.commission(Number(entry.userId), entry.chargeCents - entry.upstreamCents);
      await this.usage.insert({ ...entry, userId: Number(entry.userId), ...share, bizNo: entry.bizNo ?? null });
    } catch (error) {
      this.logger.error(`账单写入失败，需人工补录 ${JSON.stringify(entry)}：${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * 这笔账单的分销佣金，在扣费当时算定写进账单。利润为负不倒扣。
   * 用户归一级：一级拿走利润 × 自己的比例。
   * 用户归二级：二级拿走利润 × 自己的比例，一级拿走利润 ×（一级比例 − 二级比例）。
   * 平台付出的总额不超过一级的比例。二级已取消时，一级按自己的全部比例拿；一级已取消则都没有。
   */
  private async commission(userId: number, profitCents: number): Promise<{ commissionCents: number; parentCommissionCents: number }> {
    const none = { commissionCents: 0, parentCommissionCents: 0 };
    if (profitCents <= 0) return none;
    const row = await this.users
      .createQueryBuilder('u')
      .innerJoin(User, 'd', 'd.id = u.distributorId')
      .leftJoin(User, 'p', 'p.id = d.parentDistributorId')
      .select('d.commissionPercent', 'percent')
      .addSelect('d.isDistributor', 'active')
      .addSelect('d.distributorLevel', 'level')
      .addSelect('p.commissionPercent', 'parentPercent')
      .addSelect('p.isDistributor', 'parentActive')
      .addSelect('p.distributorLevel', 'parentLevel')
      .where('u.id = :userId', { userId })
      .getRawOne<{
        percent: number | string | null;
        active: unknown;
        level: number | string | null;
        parentPercent: number | string | null;
        parentActive: unknown;
        parentLevel: number | string | null;
      }>();
    if (!row) return none;
    const percent = Number(row.percent) || 0;
    if (Number(row.level) === 2) {
      if (!flag(row.parentActive) || Number(row.parentLevel) !== 1) return none;
      const parentPercent = Number(row.parentPercent) || 0;
      if (!flag(row.active)) return { commissionCents: 0, parentCommissionCents: (profitCents * parentPercent) / 100 };
      const childPercent = Math.min(Math.max(percent, 0), parentPercent);
      return {
        commissionCents: (profitCents * childPercent) / 100,
        parentCommissionCents: (profitCents * Math.max(parentPercent - childPercent, 0)) / 100,
      };
    }
    if (!flag(row.active)) return none;
    return { commissionCents: (profitCents * percent) / 100, parentCommissionCents: 0 };
  }

  /** 累计零头，攒够整数分再扣；扣款失败就把整数部分放回去 */
  private async accrue(userId: string, cents: number) {
    const redis = this.redis.getClient();
    const total = Number(await redis.incrbyfloat(accrualKey(userId), cents));
    const whole = Math.floor(total + 1e-9);
    if (whole < 1) return;
    await redis.incrbyfloat(accrualKey(userId), -whole);
    try {
      const r = await this.pay.consume({
        externalUserId: userId,
        amountCents: whole,
        bizNo: newBizNo('t'),
        remark: 'AI 文本生成（对话 / 脚本 / 分析）',
        partial: true,
      });
      this.remember(userId, r.balanceCents);
    } catch (error) {
      await redis.incrbyfloat(accrualKey(userId), whole);
      throw error;
    }
  }

  // ───────────────────────── 预检 ─────────────────────────

  /** 余额不足抛 402，前端据此弹出充值 */
  async assertCanSpend(userId: string | number, minCents = 1) {
    if (!this.enabled() || isBillingWaived(userId)) return;
    if ((await this.wallet.balanceCents(Number(userId))) < minCents) {
      throw new HttpException('余额不足，请先充值', HttpStatus.PAYMENT_REQUIRED);
    }
  }

  /** 余额缓存只是预检的加速，写失败不能影响已经完成的扣款 */
  private remember(userId: string, balanceCents: number) {
    void this.wallet.rememberBalance(userId, balanceCents).catch(() => undefined);
  }

  private billedUser(what: string): string | undefined {
    if (!this.enabled() || isBillingWaived()) return undefined;
    const userId = currentBillingUser();
    if (!userId && !this.warned.has(what)) {
      this.warned.add(what);
      this.logger.warn(`${what} 缺少计费用户上下文，本次未扣费。请检查调用入口是否包了 runWithBilling`);
    }
    return userId;
  }
}
