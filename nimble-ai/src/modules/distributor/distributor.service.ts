import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as dayjs from 'dayjs';
import { In, Repository } from 'typeorm';
import { BillService, rangeSince, selectTotals, toTotals, UsageRange } from '../billing/bill.service';
import { UsageLog } from '../billing/entities/usage-log.entity';
import { WalletService } from '../pay/wallet.service';
import { PriceBoardService, toCostRow } from '../pricing/price-board.service';
import { User } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';

const TOP_MODELS = 20;

/**
 * 分销。用户注册时就写好归属（User.distributorId），统计按这个 ID 查，不用递归邀请链。
 * 一级还能看到二级名下的用户：那些用户的 distributorId 指向二级，二级的 parentDistributorId 指向一级。
 * 佣金在扣费时按当时的比例拆开写进账单。分销后台对一级和二级是同一套页面，响应里不带级别。
 */
@Injectable()
export class DistributorService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly bills: BillService,
    private readonly wallet: WalletService,
    private readonly board: PriceBoardService,
    private readonly accounts: UserService,
  ) {}

  /** 自己的总览。一级的人数和消费含二级名下用户，佣金只含一级留下的部分 */
  async overview(id: number, range: UsageRange) {
    const filter = { distributorId: id, since: rangeSince(range) };
    const [me, code, team, totals, models] = await Promise.all([
      this.users.findOneOrFail({ where: { id }, select: { id: true, commissionPercent: true, distributorLevel: true } }),
      this.wallet.referralCode(id),
      this.team(id),
      this.bills.totals(filter),
      this.bills.byModel(filter),
    ]);
    return {
      code,
      commissionPercent: me.commissionPercent,
      // 只有一级需要这个开关。二级的响应里不带该字段，避免从接口看出还有上级
      ...(me.distributorLevel === 1 ? { canAppoint: true } : {}),
      team,
      usage: { range, ...totals },
      models: models.sort((a, b) => b.chargeCents - a.chargeCents).slice(0, TOP_MODELS),
    };
  }

  /** 名下用户。一级含二级的用户，并标出归谁；二级只有自己的用户 */
  async members(id: number, page: number, pageSize: number) {
    const me = await this.users.findOneOrFail({ where: { id }, select: { id: true, distributorLevel: true } });
    const canAppoint = me.distributorLevel === 1;
    const where = '(u.distributorId = :id OR d.parentDistributorId = :id)';
    const base = this.users.createQueryBuilder('u').leftJoin(User, 'd', 'd.id = u.distributorId').where(where, { id });
    const qb = base.clone().leftJoin(UsageLog, 'l', 'l.userId = u.id AND l.refunded = false');
    const [total, rows] = await Promise.all([
      base.clone().getCount(),
      selectTotals(qb.clone())
        .addSelect('u.id', 'id')
        .addSelect('u.loginName', 'loginName')
        .addSelect('u.nickname', 'nickname')
        .addSelect('u.createdAt', 'createdAt')
        .addSelect('u.lastLoginAt', 'lastLoginAt')
        .addSelect('u.invitedBy = :id', 'direct')
        .addSelect('u.distributorId', 'distributorId')
        .addSelect('u.distributorLevel', 'distributorLevel')
        .addSelect('u.isDistributor', 'isDistributor')
        .addSelect('MAX(d.nickname)', 'ownerNickname')
        .addSelect('MAX(d.loginName)', 'ownerLoginName')
        .groupBy('u.id')
        .orderBy('COALESCE(SUM(l.chargeCents), 0)', 'DESC')
        .addOrderBy('u.createdAt', 'DESC')
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .getRawMany(),
    ]);
    const list = rows.map((r) => {
      const distributorId = Number(r.distributorId);
      const level = Number(r.distributorLevel);
      const ownedByChild = distributorId !== id;
      return {
        id: r.id,
        loginName: r.loginName,
        nickname: r.nickname,
        /** 是本人直接邀请的；否则是下线再邀请来的 */
        direct: r.direct,
        /** 归在下级名下时是对方的名字。直属用户、以及二级自己的列表，都是 null */
        ownerName: ownedByChild ? r.ownerNickname || r.ownerLoginName || '下级' : null,
        /** 直属、还不是分销商，一级可以指定 */
        appointable: canAppoint && !ownedByChild && level === 0 && Number(r.id) !== id,
        /** 已被指定成分销商。已取消的显示「已停用」，避免和普通用户分不清 */
        badge: level > 0 ? (flag(r.isDistributor) ? '分销商' : '已停用') : null,
        createdAt: r.createdAt,
        lastLoginAt: r.lastLoginAt,
        ...toTotals(r),
      };
    });
    return { list, total, page, pageSize };
  }

  /** 一级的下级列表。二级调用直接拒绝，避免从接口得知还有上级 */
  async subordinates(actorId: number) {
    await this.assertLevel1(actorId);
    const subs = await this.users.find({
      where: { parentDistributorId: actorId, distributorLevel: 2 },
      order: { createdAt: 'ASC' },
    });
    const ids = subs.map((s) => s.id);
    const [totals, memberCount, mine] = await Promise.all([
      this.bills.byDistributor(ids),
      this.memberCounts(ids),
      this.bills.parentCommissionOf(ids),
    ]);
    return subs.map((s) => ({
      id: s.id,
      loginName: s.loginName,
      nickname: s.nickname,
      isDistributor: s.isDistributor,
      commissionPercent: s.commissionPercent,
      createdAt: s.createdAt,
      members: memberCount.get(s.id) ?? 0,
      ...(totals.get(s.id) ?? toTotals(undefined)),
      myCommissionCents: mine.get(s.id) ?? 0,
    }));
  }

  appoint(actorId: number, userId: number, commissionPercent: number) {
    return this.accounts.saveChild(actorId, userId, { isDistributor: true, commissionPercent }, true);
  }

  updateSubordinate(actorId: number, subId: number, patch: { isDistributor?: boolean; commissionPercent?: number }) {
    return this.accounts.saveChild(actorId, subId, patch, false);
  }

  /** 分销商看到的价目表：用户价、官方价，外加成本价。加价系数和内部模型 id 不外露 */
  async pricing() {
    const rows = await this.board.rows();
    return { currency: 'CNY', rows: rows.map(toCostRow) };
  }

  /** 管理员看的分销商列表：现任的，以及已取消但名下还有用户或曾经是分销商的 */
  async list() {
    const distributors = await this.users
      .createQueryBuilder('u')
      .where('u.isDistributor = true OR u.distributorLevel > 0 OR EXISTS (SELECT 1 FROM account m WHERE m.distributor_id = u.id)')
      .orderBy('u.distributorLevel', 'ASC')
      .addOrderBy('u.createdAt', 'ASC')
      .getMany();
    const ids = distributors.map((d) => d.id);
    const parentIds = [...new Set(distributors.map((d) => d.parentDistributorId).filter((id): id is number => !!id))];
    const [totals, memberCount, parents] = await Promise.all([
      this.bills.byDistributor(ids),
      this.memberCounts(ids),
      parentIds.length
        ? this.users.find({ where: { id: In(parentIds) }, select: { id: true, nickname: true, loginName: true, commissionPercent: true } })
        : Promise.resolve([]),
    ]);
    const parentOf = new Map(parents.map((p) => [p.id, p]));
    return distributors.map((d) => {
      const parent = d.parentDistributorId ? parentOf.get(d.parentDistributorId) : undefined;
      const level = d.distributorLevel === 2 ? 2 : 1;
      return {
        id: d.id,
        loginName: d.loginName,
        nickname: d.nickname,
        isDistributor: d.isDistributor,
        level,
        parentName: level === 2 ? parent?.nickname || parent?.loginName || null : null,
        /** 调整比例时的上限：二级不能超过上级当前比例 */
        rateCap: level === 2 ? (parent?.commissionPercent ?? 0) : 100,
        commissionPercent: d.commissionPercent,
        createdAt: d.createdAt,
        members: memberCount.get(d.id) ?? 0,
        ...(totals.get(d.id) ?? toTotals(undefined)),
      };
    });
  }

  private async assertLevel1(id: number) {
    const me = await this.users.findOne({ where: { id }, select: { id: true, isDistributor: true, distributorLevel: true } });
    if (!me?.isDistributor || me.distributorLevel !== 1) throw new ForbiddenException('没有权限');
  }

  /** 二级计直接归他的用户；一级再叠上二级名下的用户 */
  private async memberCounts(ids: number[]): Promise<Map<number, number>> {
    if (!ids.length) return new Map();
    const people = await this.users.find({ where: { id: In(ids) }, select: { id: true, distributorLevel: true } });
    const level1 = people.filter((p) => p.distributorLevel === 1).map((p) => p.id);
    const directRows = await this.users
      .createQueryBuilder('u')
      .select('u.distributorId', 'id')
      .addSelect('COUNT(*)', 'count')
      .where('u.distributorId IN (:...ids)', { ids })
      .groupBy('u.distributorId')
      .getRawMany<{ id: number; count: string }>();
    const map = new Map(directRows.map((r) => [Number(r.id), Number(r.count)]));
    if (!level1.length) return map;
    const extra = await this.users
      .createQueryBuilder('u')
      .innerJoin(User, 'd', 'd.id = u.distributorId AND d.distributorLevel = 2')
      .select('d.parentDistributorId', 'id')
      .addSelect('COUNT(*)', 'count')
      .where('d.parentDistributorId IN (:...ids)', { ids: level1 })
      .groupBy('d.parentDistributorId')
      .getRawMany<{ id: number; count: string }>();
    for (const row of extra) {
      const id = Number(row.id);
      map.set(id, (map.get(id) ?? 0) + Number(row.count));
    }
    return map;
  }

  /** 团队人数：全部、直接邀请、今日新增。一级含二级的用户 */
  private async team(id: number) {
    const raw = await this.users
      .createQueryBuilder('u')
      .leftJoin(User, 'd', 'd.id = u.distributorId')
      .select('COUNT(*)', 'total')
      .addSelect('COUNT(*) FILTER (WHERE u.invitedBy = :id)', 'direct')
      .addSelect('COUNT(*) FILTER (WHERE u.createdAt >= :today)', 'today')
      .where('(u.distributorId = :id OR d.parentDistributorId = :id)', { id })
      .setParameter('today', dayjs().startOf('day').toDate())
      .getRawOne<{ total: string; direct: string; today: string }>();
    return { total: Number(raw?.total ?? 0), direct: Number(raw?.direct ?? 0), today: Number(raw?.today ?? 0) };
  }
}

const flag = (v: unknown) => v === true || v === 'true' || v === 't' || v === 1 || v === '1';
