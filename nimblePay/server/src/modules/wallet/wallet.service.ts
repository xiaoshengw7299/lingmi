import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { ApiException } from '../../common/api-exception';
import { REWARD_SETTINGS } from '../../common/constants';
import { paging } from '../../common/dto/page.dto';
import { Referral, SysSetting, WalletLedger, WalletUser } from '../../entities';

export type LedgerType =
  | 'RECHARGE'
  | 'REFUND_DEDUCT'
  | 'REFUND_RESTORE'
  | 'ADMIN_GRANT'
  | 'ADMIN_REVOKE'
  | 'CONSUME'
  | 'CONSUME_REFUND'
  | 'REFERRAL_REWARD'
  | 'SIGNUP_GIFT'
  | 'SHARE_REWARD';

/** 这几类流水是减少余额，其余都是增加 */
const DEBIT_TYPES = new Set<string>(['REFUND_DEDUCT', 'ADMIN_REVOKE', 'CONSUME']);

type LedgerExtra = { orderId?: string; refundId?: string; bizNo?: string; remark: string };

/** HTTP 402：nimble-ai 据此提示用户充值 */
const insufficient = () => new ApiException(40201, '余额不足，请先充值', HttpStatus.PAYMENT_REQUIRED);

@Injectable()
export class WalletService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(WalletUser) private readonly users: Repository<WalletUser>,
    @InjectRepository(WalletLedger) private readonly ledgers: Repository<WalletLedger>,
    @InjectRepository(Referral) private readonly referrals: Repository<Referral>,
    @InjectRepository(SysSetting) private readonly settings: Repository<SysSetting>,
  ) {}

  /**
   * 同步钱包：不存在就开户（顺带发注册赠送），传了邀请人就绑定邀请关系。
   * 调用方每次打开余额页都会调，必须幂等。
   */
  async ensure(input: { externalUserId: string; email?: string; nickname?: string; inviterExternalUserId?: string }) {
    const externalUserId = String(input.externalUserId || '').trim();
    if (!externalUserId) throw ApiException.bad('缺少用户标识');
    try {
      return await this.dataSource.transaction(async (tx) => {
        let user = await tx.findOne(WalletUser, { where: { externalUserId } });
        if (!user) user = await this.openWallet(tx, externalUserId, input.email, input.nickname);
        else if (input.email || input.nickname) {
          user.email = input.email?.slice(0, 128) || user.email;
          user.nickname = input.nickname?.slice(0, 64) || user.nickname;
          user = await tx.save(user);
        }
        await this.bindInviter(tx, user, input.inviterExternalUserId);
        return this.publicUser(user);
      });
    } catch (e) {
      // 页面同时发起两次同步，后到的撞上唯一键：钱包已被先到的建好，直接读回即可
      if ((e as { code?: string })?.code === '23505') return this.publicUser(await this.byExternal(externalUserId));
      throw e;
    }
  }

  async byExternal(externalUserId: string) {
    const user = await this.users.findOne({ where: { externalUserId } });
    if (!user) throw ApiException.notFound('钱包不存在');
    return user;
  }

  async page(q: { page?: number; pageSize?: number; keyword?: string }) {
    const p = paging(q);
    const qb = this.users.createQueryBuilder('u').orderBy('u.createdAt', 'DESC');
    if (q.keyword) {
      qb.where('u.email ILIKE :k OR u.nickname ILIKE :k OR u.externalUserId ILIKE :k', {
        k: `%${q.keyword}%`,
      });
    }
    const [items, total] = await qb.skip(p.skip).take(p.take).getManyAndCount();
    return { items: items.map((u) => this.publicUser(u)), total, page: p.page, pageSize: p.pageSize };
  }

  /**
   * 批量钱包概况，给 nimble 管理后台的用户列表用。没开过户的用户不在结果里，调用方按 0 处理。
   * 累计消费是净额：消费减去失败退回。
   */
  async summaries(externalUserIds: string[]) {
    const users = await this.users.find({ where: { externalUserId: In(externalUserIds) } });
    if (!users.length) return [];
    const rows = await this.ledgers
      .createQueryBuilder('l')
      .select('l.userId', 'userId')
      .addSelect('l.type', 'type')
      .addSelect('SUM(l.amountCents)', 'cents')
      .where('l.userId IN (:...ids) AND l.type IN (:...types)', {
        ids: users.map((u) => u.id),
        types: ['RECHARGE', 'CONSUME', 'CONSUME_REFUND'],
      })
      .groupBy('l.userId')
      .addGroupBy('l.type')
      .getRawMany<{ userId: string; type: LedgerType; cents: string }>();
    const sum = (userId: string, type: LedgerType) =>
      Number(rows.find((r) => r.userId === userId && r.type === type)?.cents || 0);
    return users.map((u) => ({
      externalUserId: u.externalUserId,
      balanceCents: u.balanceCents,
      rechargeCents: sum(u.id, 'RECHARGE'),
      consumeCents: sum(u.id, 'CONSUME') - sum(u.id, 'CONSUME_REFUND'),
    }));
  }

  async detail(id: string) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw ApiException.notFound('用户不存在');
    const ledgers = await this.ledgers.find({
      where: { userId: id },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return { ...this.publicUser(user), ledgers };
  }

  async setStatus(id: string, status: string, remark?: string) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw ApiException.notFound('用户不存在');
    if (user.externalUserId === '__alipay_test__' && status === 'DISABLED') {
      throw ApiException.bad('不能停用测试钱包');
    }
    user.status = status;
    if (remark != null) user.remark = remark;
    return this.publicUser(await this.users.save(user));
  }

  async adjust(id: string, amountCents: number, direction: 'grant' | 'revoke', remark: string) {
    if (!Number.isInteger(amountCents) || amountCents < 1) throw ApiException.bad('调整金额须大于 0');
    return this.dataSource.transaction(async (tx) => {
      const type: LedgerType = direction === 'grant' ? 'ADMIN_GRANT' : 'ADMIN_REVOKE';
      const delta = direction === 'grant' ? amountCents : -amountCents;
      const { user } = await this.apply(tx, id, delta, type, {
        remark: remark || (direction === 'grant' ? '后台加款' : '后台扣款'),
      });
      return this.publicUser(user);
    });
  }

  // ───────────────────────── 消费 ─────────────────────────

  /**
   * 消费扣款。同一 bizNo 只扣一次；余额不足抛 402。
   * partial=true 时余额不够就扣到 0，用于事后按用量结算的场景（文本模型）。
   */
  async consume(input: { externalUserId: string; amountCents: number; bizNo: string; remark?: string; partial?: boolean }) {
    if (!Number.isInteger(input.amountCents) || input.amountCents < 1) throw ApiException.bad('扣款金额须为正整数分');
    return this.dataSource.transaction(async (tx) => {
      const user = await this.mustByExternal(tx, input.externalUserId);
      const done = await tx.findOne(WalletLedger, { where: { bizNo: input.bizNo, type: 'CONSUME' } });
      if (done) return { chargedCents: done.amountCents, balanceCents: user.balanceCents, duplicated: true };
      const r = await this.apply(tx, user.id, -input.amountCents, 'CONSUME', {
        bizNo: input.bizNo,
        remark: input.remark || '消费',
        clamp: input.partial,
      });
      return { chargedCents: Math.abs(r.applied), balanceCents: r.user.balanceCents, duplicated: false };
    });
  }

  /**
   * 业务奖励入账（分享示例等）。钱包不存在就先开户。
   * 同一 bizNo + SHARE_REWARD 只入一次。
   */
  async grant(input: { externalUserId: string; amountCents: number; bizNo: string; remark?: string }) {
    if (!Number.isInteger(input.amountCents) || input.amountCents < 1) throw ApiException.bad('奖励金额须为正整数分');
    const externalUserId = String(input.externalUserId || '').trim();
    if (!externalUserId) throw ApiException.bad('缺少用户标识');
    return this.dataSource.transaction(async (tx) => {
      let user = await tx.findOne(WalletUser, { where: { externalUserId } });
      if (!user) user = await this.openWallet(tx, externalUserId);
      const done = await tx.findOne(WalletLedger, { where: { bizNo: input.bizNo, type: 'SHARE_REWARD' } });
      if (done) return { amountCents: done.amountCents, balanceCents: user.balanceCents, duplicated: true };
      const r = await this.apply(tx, user.id, input.amountCents, 'SHARE_REWARD', {
        bizNo: input.bizNo,
        remark: input.remark || '分享奖励',
      });
      return { amountCents: r.applied, balanceCents: r.user.balanceCents, duplicated: false };
    });
  }

  /** 退回一笔消费（生成失败）。没扣过或已退过都不会重复入账 */
  async refundConsume(externalUserId: string, bizNo: string) {
    return this.dataSource.transaction(async (tx) => {
      const user = await this.mustByExternal(tx, externalUserId);
      const spent = await tx.findOne(WalletLedger, { where: { bizNo, type: 'CONSUME', userId: user.id } });
      if (!spent) return { refundedCents: 0, balanceCents: user.balanceCents };
      const done = await tx.findOne(WalletLedger, { where: { bizNo, type: 'CONSUME_REFUND' } });
      if (done) return { refundedCents: done.amountCents, balanceCents: user.balanceCents };
      const r = await this.apply(tx, user.id, spent.amountCents, 'CONSUME_REFUND', {
        bizNo,
        remark: '生成失败，自动退回',
      });
      return { refundedCents: spent.amountCents, balanceCents: r.user.balanceCents };
    });
  }

  /** 用户账单。amountCents 带正负号：加钱为正，花钱为负 */
  async ledgerPage(externalUserId: string, q: { page?: number; pageSize?: number }) {
    const user = await this.byExternal(externalUserId);
    const p = paging(q);
    const [rows, total] = await this.ledgers.findAndCount({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
      skip: p.skip,
      take: p.take,
    });
    const items = rows.map((l) => ({
      id: l.id,
      type: l.type,
      amountCents: DEBIT_TYPES.has(l.type) ? -l.amountCents : l.amountCents,
      balanceAfter: l.balanceAfter,
      remark: l.remark,
      createdAt: l.createdAt,
    }));
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  // ───────────────────────── 充值入账与推广奖励 ─────────────────────────

  /** 充值入账。同一订单只记一次。测试单不加余额。 */
  async creditRecharge(tx: EntityManager, userId: string, orderId: string, amountCents: number, remark: string, testPay: boolean) {
    if (testPay) return;
    const exists = await tx.findOne(WalletLedger, { where: { orderId, type: 'RECHARGE' } });
    if (exists) return;
    await this.apply(tx, userId, amountCents, 'RECHARGE', { orderId, remark });
    await this.rewardInviter(tx, userId, amountCents);
  }

  async holdRefund(tx: EntityManager, userId: string, refundId: string, amountCents: number, testPay: boolean) {
    if (testPay) return;
    await this.apply(tx, userId, -amountCents, 'REFUND_DEDUCT', {
      refundId,
      remark: '退款预扣余额',
    });
  }

  async restoreRefund(tx: EntityManager, userId: string, refundId: string, amountCents: number, testPay: boolean) {
    if (testPay) return;
    const held = await tx.findOne(WalletLedger, { where: { refundId, type: 'REFUND_DEDUCT' } });
    if (!held) return;
    const restored = await tx.findOne(WalletLedger, { where: { refundId, type: 'REFUND_RESTORE' } });
    if (restored) return;
    await this.apply(tx, userId, amountCents, 'REFUND_RESTORE', { refundId, remark: '退款失败，退回余额' });
  }

  /** 推广概况：规则、累计数据、被邀请人列表。钱包还没开户时返回空数据 */
  async referralOverview(externalUserId: string, q: { page?: number; pageSize?: number }) {
    const user = await this.users.findOne({ where: { externalUserId } });
    const p = paging(q);
    const rule = await this.rewardRule();
    if (!user) {
      return { rule, invitedCount: 0, rewardedCount: 0, totalRewardCents: 0, items: [], total: 0, page: p.page, pageSize: p.pageSize };
    }
    const [rows, total] = await this.referrals.findAndCount({
      where: { inviterId: user.id },
      relations: { invitee: true },
      order: { createdAt: 'DESC' },
      skip: p.skip,
      take: p.take,
    });
    const sum = await this.referrals
      .createQueryBuilder('r')
      .select('COUNT(*) FILTER (WHERE r.status = :ok)', 'rewarded')
      .addSelect('COALESCE(SUM(r.rewardCents), 0)', 'reward')
      .where('r.inviterId = :id', { id: user.id })
      .setParameter('ok', 'REWARDED')
      .getRawOne<{ rewarded: string; reward: string }>();
    return {
      rule,
      invitedCount: total,
      rewardedCount: Number(sum?.rewarded || 0),
      totalRewardCents: Number(sum?.reward || 0),
      items: rows.map((r) => ({
        inviteeExternalUserId: r.invitee.externalUserId,
        status: r.status,
        rewardCents: r.rewardCents,
        createdAt: r.createdAt,
        rewardedAt: r.rewardedAt,
      })),
      total,
      page: p.page,
      pageSize: p.pageSize,
    };
  }

  // ───────────────────────── 内部 ─────────────────────────

  /** 开户。新用户赠送在这里发，bizNo 保证只发一次 */
  private async openWallet(tx: EntityManager, externalUserId: string, email?: string, nickname?: string) {
    let user = await tx.save(
      tx.create(WalletUser, {
        externalUserId,
        email: (email || '').slice(0, 128),
        nickname: (nickname || '').slice(0, 64),
      }),
    );
    const gift = await this.setting(tx, REWARD_SETTINGS.signupGiftCents);
    if (gift > 0) {
      ({ user } = await this.apply(tx, user.id, gift, 'SIGNUP_GIFT', { bizNo: `gift:${user.id}`, remark: '新用户赠送' }));
    }
    return user;
  }

  /**
   * 绑定邀请关系，只在满足全部条件时生效：不是自己、还没有邀请人、从未充值、不是互相邀请。
   * 邀请人没有钱包时顺手开户，保证之后奖励有地方入账。
   */
  private async bindInviter(tx: EntityManager, invitee: WalletUser, inviterExternalUserId?: string) {
    const inviterKey = inviterExternalUserId?.trim();
    if (!inviterKey || inviterKey === invitee.externalUserId) return;
    if (await tx.count(Referral, { where: { inviteeId: invitee.id } })) return;
    if (await tx.count(WalletLedger, { where: { userId: invitee.id, type: 'RECHARGE' } })) return;
    const inviter =
      (await tx.findOne(WalletUser, { where: { externalUserId: inviterKey } })) ??
      (await this.openWallet(tx, inviterKey));
    if (await tx.count(Referral, { where: { inviterId: invitee.id, inviteeId: inviter.id } })) return;
    await tx.save(tx.create(Referral, { inviterId: inviter.id, inviteeId: invitee.id }));
  }

  /** 被邀请人本次充值达标，就给邀请人发奖。每个被邀请人只发一次 */
  private async rewardInviter(tx: EntityManager, inviteeId: string, rechargeCents: number) {
    const ref = await tx.findOne(Referral, {
      where: { inviteeId, status: 'BOUND' },
      lock: { mode: 'pessimistic_write' },
    });
    if (!ref) return;
    const { rewardCents, minRechargeCents } = await this.rewardRule(tx);
    if (rewardCents <= 0 || rechargeCents < minRechargeCents) return;
    await this.apply(tx, ref.inviterId, rewardCents, 'REFERRAL_REWARD', {
      bizNo: `ref:${ref.id}`,
      remark: '邀请好友首充奖励',
    });
    ref.status = 'REWARDED';
    ref.rewardCents = rewardCents;
    ref.rewardedAt = new Date();
    await tx.save(ref);
  }

  /** 奖励规则：注册赠送、邀请奖励金额与门槛。开放接口和推广页共用 */
  async rewardRule(tx?: EntityManager) {
    const [rewardCents, minRechargeCents, signupGiftCents] = await Promise.all([
      this.setting(tx, REWARD_SETTINGS.referralCents),
      this.setting(tx, REWARD_SETTINGS.referralMinRechargeCents),
      this.setting(tx, REWARD_SETTINGS.signupGiftCents),
    ]);
    return { rewardCents, minRechargeCents, signupGiftCents };
  }

  private async setting(tx: EntityManager | undefined, def: { key: string; fallback: number }) {
    const repo = tx ? tx.getRepository(SysSetting) : this.settings;
    const row = await repo.findOne({ where: { key: def.key } });
    const n = Number(row?.value);
    return Number.isInteger(n) && n >= 0 ? n : def.fallback;
  }

  private async mustByExternal(tx: EntityManager, externalUserId: string) {
    const user = await tx.findOne(WalletUser, { where: { externalUserId } });
    if (!user) throw ApiException.notFound('钱包不存在');
    return user;
  }

  /**
   * 唯一改余额的地方：锁行、校验、记流水。clamp=true 时余额不够就扣到 0（实际变动记在 applied）。
   */
  private async apply(
    tx: EntityManager,
    userId: string,
    delta: number,
    type: LedgerType,
    extra: LedgerExtra & { clamp?: boolean },
  ) {
    const user = await tx.findOne(WalletUser, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!user) throw ApiException.notFound('钱包不存在');
    if (user.status !== 'ACTIVE' && (type === 'ADMIN_GRANT' || type === 'CONSUME' || type === 'SHARE_REWARD')) {
      throw ApiException.bad('用户不可用');
    }
    let applied = delta;
    if (user.balanceCents + delta < 0) {
      if (!extra.clamp) throw type === 'CONSUME' ? insufficient() : ApiException.bad('余额不足');
      applied = -user.balanceCents;
    }
    if (applied === 0) return { user, applied };
    const before = user.balanceCents;
    user.balanceCents = before + applied;
    await tx.save(user);
    await tx.save(
      tx.create(WalletLedger, {
        userId,
        type,
        amountCents: Math.abs(applied),
        balanceBefore: before,
        balanceAfter: user.balanceCents,
        orderId: extra.orderId ?? null,
        refundId: extra.refundId ?? null,
        bizNo: extra.bizNo ?? null,
        remark: extra.remark,
      }),
    );
    return { user, applied };
  }

  publicUser(user: WalletUser) {
    return {
      id: user.id,
      externalUserId: user.externalUserId,
      email: user.email,
      nickname: user.nickname,
      balanceCents: user.balanceCents,
      status: user.status,
      remark: user.remark,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
