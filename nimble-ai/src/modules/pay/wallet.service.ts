import { randomBytes } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../user/entities/user.entity';
import { RedisService } from '../redis/redis.service';
import { PayClientService, PayRewardRule } from './pay-client.service';

const MIN_RECHARGE_YUAN = 1;
const PROMO_TTL_SEC = 600;
/** 钱包同步结果缓存。同步本身幂等，缓存只是为了少打几次支付服务 */
const READY_TTL_SEC = 3600;
/** 余额缓存时长。真正扣款永远以支付服务为准，缓存只用于展示和文本模型的预检 */
const BALANCE_TTL_SEC = 30;

/**
 * 账号维度的钱包：把 nimble 账号翻译成支付服务里的 externalUserId，
 * 并负责开户时带上邀请人。支付服务只认 externalUserId，不认识账号表。
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly pay: PayClientService,
    private readonly redis: RedisService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async ensure(userId: number): Promise<void> {
    const key = `wallet:ready:${userId}`;
    if (await this.redis.exists(key)) return;
    const user = await this.mustUser(userId);
    await this.pay.ensureWallet({
      externalUserId: String(userId),
      nickname: user.nickname || user.loginName || '',
      inviterExternalUserId: user.invitedBy ? String(user.invitedBy) : undefined,
    });
    await this.redis.set(key, '1', READY_TTL_SEC);
  }

  async overview(userId: number) {
    return { balanceCents: await this.balanceCents(userId), minRechargeYuan: MIN_RECHARGE_YUAN };
  }

  /** 公开的活动规则（注册赠送、邀请奖励），首页横幅用。缓存 10 分钟；支付服务不可用时返回 null，横幅自动隐藏 */
  async promo(): Promise<PayRewardRule | null> {
    const cached = await this.redis.get<PayRewardRule>('wallet:promo');
    if (cached) return cached;
    try {
      const rule = await this.pay.rewardRule();
      await this.redis.set('wallet:promo', rule, PROMO_TTL_SEC);
      return rule;
    } catch {
      return null;
    }
  }

  /**
   * 余额。优先读缓存：顶栏轮询和文本模型预检都很频繁，不能每次都打支付服务。
   * 我们自己引起的变动（扣款、退回、充值到账）都会即时刷新缓存，只有后台加款、邀请奖励这类外部变动最多滞后一个 TTL。
   */
  async balanceCents(userId: number): Promise<number> {
    const cached = await this.redis.get<string>(`wallet:bal:${userId}`);
    if (cached !== null) return Number(cached);
    await this.ensure(userId);
    const { balanceCents } = await this.pay.wallet(String(userId));
    await this.rememberBalance(userId, balanceCents);
    return balanceCents;
  }

  rememberBalance(userId: number | string, balanceCents: number) {
    return this.redis.set(`wallet:bal:${userId}`, String(balanceCents), BALANCE_TTL_SEC);
  }

  async recharge(userId: number, amountYuan: number, clientOrderNo?: string) {
    const amountCents = Math.round((amountYuan + Number.EPSILON) * 100);
    if (!Number.isInteger(amountCents) || amountCents < MIN_RECHARGE_YUAN * 100) {
      throw new BadRequestException(`最低充值 ${MIN_RECHARGE_YUAN} 元，最多两位小数`);
    }
    await this.ensure(userId);
    const user = await this.mustUser(userId);
    return this.pay.recharge({
      externalUserId: String(userId),
      nickname: user.nickname || user.loginName || '',
      amountCents,
      clientOrderNo: clientOrderNo || `NW${Date.now()}${randomBytes(3).toString('hex')}`,
    });
  }

  /** 查充值单。顺手刷新余额缓存，用户付完款回来立刻就能看到到账 */
  async order(userId: number, orderNo: string) {
    const order = await this.pay.order(orderNo, String(userId));
    await this.rememberBalance(userId, order.balanceCents);
    return order;
  }

  async ledgers(userId: number, page: number, pageSize: number) {
    await this.ensure(userId);
    return this.pay.ledgers(String(userId), page, pageSize);
  }

  /** 推广页数据：推广码 + 规则 + 战绩 + 被邀请人列表（昵称脱敏） */
  async referral(userId: number, page: number, pageSize: number) {
    await this.ensure(userId);
    const [code, data] = await Promise.all([this.referralCode(userId), this.pay.referral(String(userId), page, pageSize)]);    const ids = data.items.map((i) => Number(i.inviteeExternalUserId)).filter(Number.isFinite);
    const invitees = ids.length ? await this.users.find({ where: { id: In(ids) } }) : [];
    const nameOf = new Map(invitees.map((u) => [String(u.id), maskName(u.nickname || u.loginName || '用户')]));
    return {
      ...data,
      code,
      items: data.items.map(({ inviteeExternalUserId, ...rest }) => ({
        ...rest,
        name: nameOf.get(inviteeExternalUserId) || '用户',
      })),
    };
  }

  /** 推广码首次用到时再生成，老账号不需要迁移。分销商的专属链接也用它 */
  async referralCode(userId: number): Promise<string> {
    const user = await this.mustUser(userId);
    if (user.referralCode) return user.referralCode;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomBytes(4).toString('hex');
      try {
        await this.users.update({ id: userId }, { referralCode: code });
        return code;
      } catch (error) {
        if ((error as { code?: string })?.code !== '23505') throw error;
      }
    }
    throw new BadRequestException('推广码生成失败，请稍后重试');
  }

  private async mustUser(userId: number) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');
    return user;
  }
}

/** 昵称和登录账号都只露头尾，避免把别人的账号信息展示给邀请人 */
function maskName(value: string): string {
  const name = value.trim();
  if (name.length <= 2) return `${name[0] ?? ''}*`;
  return `${name[0]}${'*'.repeat(Math.min(name.length - 2, 4))}${name[name.length - 1]}`;
}
