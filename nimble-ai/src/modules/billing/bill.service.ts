import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as dayjs from 'dayjs';
import { In, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { User } from '../user/entities/user.entity';
import { UsageKind, UsageLog } from './entities/usage-log.entity';

/** 统计页和分销后台共用的时间范围，值是天数，0 表示不限 */
export const USAGE_RANGES = { '7d': 7, '30d': 30, all: 0 } as const;
export type UsageRange = keyof typeof USAGE_RANGES;

/** 范围的起点：近 N 天含今天，全部返回 undefined */
export const rangeSince = (range: UsageRange): Date | undefined =>
  USAGE_RANGES[range] ? dayjs().startOf('day').subtract(USAGE_RANGES[range] - 1, 'day').toDate() : undefined;

export interface BillFilter {
  userId?: number;
  /**
   * 按分销商过滤。一级会带上其二级名下的用户，佣金只算一级自己应得的那一份
   * （直属用户的佣金 + 二级用户分剩下来的）。二级只看自己的用户和自己的佣金。
   */
  distributorId?: number;
  kind?: UsageKind;
  since?: Date;
  until?: Date;
}

/** 一次账单查询怎么圈用户、佣金列按谁的应得来加总 */
interface BillScope {
  /** all：不按分销商过滤，佣金是平台付出的总额。level1 / direct：见 distributorId */
  mode: 'all' | 'level1' | 'direct';
  distributorIds?: number[];
  earnId?: number;
  commissionSql: string;
}

/** 一组账单的汇总，金额单位分。利润 = 用户实付 - 上游成本；佣金是账单上固定下来的分销佣金之和 */
export interface BillTotals {
  calls: number;
  chargeCents: number;
  upstreamCents: number;
  profitCents: number;
  commissionCents: number;
}

export interface ModelBill extends BillTotals {
  model: string;
  modelName: string;
  kind: UsageKind;
  users: number;
}

type RawTotals = Partial<Record<'calls' | 'chargeCents' | 'upstreamCents' | 'commissionCents', string | number | null>>;

const DIRECT_COMMISSION_SQL = 'COALESCE(SUM(l.commissionCents), 0)';

/** 把查询列换成汇总列，需要别的列（分组字段等）再 addSelect。账单表别名默认是 l；左连接时没有账单的用户自然得到 0 */
export function selectTotals<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, alias = 'l', commissionSql = `COALESCE(SUM(${alias}.commissionCents), 0)`) {
  return qb
    .select(`COUNT(${alias}.id)`, 'calls')
    .addSelect(`COALESCE(SUM(${alias}.chargeCents), 0)`, 'chargeCents')
    .addSelect(`COALESCE(SUM(${alias}.upstreamCents), 0)`, 'upstreamCents')
    .addSelect(commissionSql, 'commissionCents');
}

function addTotals(a: BillTotals, b: BillTotals): BillTotals {
  const chargeCents = a.chargeCents + b.chargeCents;
  const upstreamCents = a.upstreamCents + b.upstreamCents;
  return {
    calls: a.calls + b.calls,
    chargeCents,
    upstreamCents,
    profitCents: chargeCents - upstreamCents,
    commissionCents: a.commissionCents + b.commissionCents,
  };
}

export function toTotals(raw: RawTotals | undefined): BillTotals {
  const chargeCents = Number(raw?.chargeCents ?? 0);
  const upstreamCents = Number(raw?.upstreamCents ?? 0);
  return {
    calls: Number(raw?.calls ?? 0),
    chargeCents,
    upstreamCents,
    profitCents: chargeCents - upstreamCents,
    commissionCents: Number(raw?.commissionCents ?? 0),
  };
}

/** 用户消费账单的查询。管理员账单页、运营统计和分销商统计都从这里取数，口径一致：已退款的不算 */
@Injectable()
export class BillService {
  constructor(
    @InjectRepository(UsageLog) private readonly usage: Repository<UsageLog>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /** 账单明细，含已退款的行（refunded 标出），汇总只算有效调用。佣金列是当前筛选下应付的那一份 */
  async list(filter: BillFilter, page: number, pageSize: number) {
    const scope = await this.scope(filter);
    const qb = this.query(filter, scope);
    const [rows, total, summary] = await Promise.all([
      qb
        .clone()
        .orderBy('l.createdAt', 'DESC')
        .skip((page - 1) * pageSize)
        .take(pageSize)
        .getMany() as Promise<Array<UsageLog & { user: User }>>,
      qb.clone().getCount(),
      this.totals(filter, scope),
    ]);
    const list = rows.map((l) => ({
      id: l.id,
      createdAt: l.createdAt,
      userId: l.userId,
      loginName: l.user.loginName,
      nickname: l.user.nickname,
      kind: l.kind,
      modelName: l.modelName,
      chargeCents: l.chargeCents,
      upstreamCents: l.upstreamCents,
      profitCents: l.chargeCents - l.upstreamCents,
      commissionCents: this.payable(l, scope),
      refunded: l.refunded,
    }));
    return { list, total, page, pageSize, summary };
  }

  async totals(filter: BillFilter, ready?: BillScope): Promise<BillTotals> {
    const scope = ready ?? (await this.scope(filter));
    return toTotals(await selectTotals(this.valid(filter, scope), 'l', scope.commissionSql).getRawOne<RawTotals>());
  }

  /** 按模型汇总 */
  async byModel(filter: BillFilter): Promise<ModelBill[]> {
    const scope = await this.scope(filter);
    const rows = await selectTotals(this.valid(filter, scope), 'l', scope.commissionSql)
      .addSelect('l.model', 'model')
      .addSelect('MAX(l.modelName)', 'modelName')
      .addSelect('l.kind', 'kind')
      .addSelect('COUNT(DISTINCT l.userId)', 'users')
      .groupBy('l.model')
      .addGroupBy('l.kind')
      .getRawMany<RawTotals & { model: string; modelName: string; kind: UsageKind; users: string }>();
    return rows.map((r) => ({
      ...toTotals(r),
      model: r.model,
      modelName: r.modelName,
      kind: r.kind,
      users: Number(r.users),
    }));
  }

  /**
   * 每个分销商自己应得的业绩。二级只含直接归他的用户。
   * 一级含其二级名下用户的消费，佣金是一级留下的那一份（不含已经分给二级的）。
   */
  async byDistributor(ids: number[]): Promise<Map<number, BillTotals>> {
    const result = new Map<number, BillTotals>();
    if (!ids.length) return result;
    for (const id of ids) result.set(id, toTotals(undefined));
    const people = await this.users.find({ where: { id: In(ids) }, select: { id: true, distributorLevel: true } });
    const level1 = people.filter((p) => p.distributorLevel === 1).map((p) => p.id);

    const directRows = await selectTotals(this.valid({}), 'l', DIRECT_COMMISSION_SQL)
      .addSelect('u.distributorId', 'distributorId')
      .andWhere('u.distributorId IN (:...ids)', { ids })
      .groupBy('u.distributorId')
      .getRawMany<RawTotals & { distributorId: number }>();
    for (const row of directRows) result.set(Number(row.distributorId), toTotals(row));

    if (level1.length) {
      const extra = await this.usage
        .createQueryBuilder('l')
        .innerJoin(User, 'u', 'u.id = l.userId')
        .innerJoin(User, 'd', 'd.id = u.distributorId')
        .select('d.parentDistributorId', 'distributorId')
        .addSelect('COUNT(l.id)', 'calls')
        .addSelect('COALESCE(SUM(l.chargeCents), 0)', 'chargeCents')
        .addSelect('COALESCE(SUM(l.upstreamCents), 0)', 'upstreamCents')
        .addSelect('COALESCE(SUM(l.parentCommissionCents), 0)', 'commissionCents')
        .where('l.refunded = false')
        .andWhere('d.parentDistributorId IN (:...parents)', { parents: level1 })
        .andWhere('d.distributorLevel = 2')
        .groupBy('d.parentDistributorId')
        .getRawMany<RawTotals & { distributorId: number }>();
      for (const row of extra) {
        const id = Number(row.distributorId);
        result.set(id, addTotals(result.get(id) ?? toTotals(undefined), toTotals(row)));
      }
    }
    return result;
  }

  /** 每个二级名下用户给其上级留下的佣金，给一级的下级列表用 */
  async parentCommissionOf(distributorIds: number[]): Promise<Map<number, number>> {
    if (!distributorIds.length) return new Map();
    const rows = await this.usage
      .createQueryBuilder('l')
      .innerJoin(User, 'u', 'u.id = l.userId')
      .select('u.distributorId', 'id')
      .addSelect('COALESCE(SUM(l.parentCommissionCents), 0)', 'cents')
      .where('l.refunded = false')
      .andWhere('u.distributorId IN (:...ids)', { ids: distributorIds })
      .groupBy('u.distributorId')
      .getRawMany<{ id: number; cents: string }>();
    return new Map(rows.map((r) => [Number(r.id), Number(r.cents)]));
  }

  /** 这一行在当前筛选下该展示的佣金 */
  private payable(row: UsageLog & { user: User }, scope: BillScope): number {
    if (scope.mode === 'all') return (row.commissionCents || 0) + (row.parentCommissionCents || 0);
    if (scope.mode === 'level1') return row.user.distributorId === scope.earnId ? row.commissionCents : row.parentCommissionCents;
    return row.commissionCents;
  }

  /** 有效调用：已退款的不算 */
  private valid(filter: BillFilter, scope?: BillScope) {
    return this.query(filter, scope).andWhere('l.refunded = false');
  }

  private query(filter: BillFilter, scope?: BillScope) {
    const { userId, kind, since, until } = filter;
    const qb = this.usage.createQueryBuilder('l').innerJoinAndMapOne('l.user', User, 'u', 'u.id = l.userId');
    if (userId) qb.andWhere('l.userId = :userId', { userId });
    if (scope?.distributorIds?.length) qb.andWhere('u.distributorId IN (:...distributorIds)', { distributorIds: scope.distributorIds });
    else if (filter.distributorId) qb.andWhere('u.distributorId = :distributorId', { distributorId: filter.distributorId });
    if (scope?.earnId) qb.setParameter('earnId', scope.earnId);
    if (kind) qb.andWhere('l.kind = :kind', { kind });
    if (since) qb.andWhere('l.createdAt >= :since', { since });
    if (until) qb.andWhere('l.createdAt <= :until', { until });
    return qb;
  }

  private async scope(filter: BillFilter): Promise<BillScope> {
    if (!filter.distributorId) {
      return { mode: 'all', commissionSql: 'COALESCE(SUM(l.commissionCents + l.parentCommissionCents), 0)' };
    }
    const distributor = await this.users.findOne({
      where: { id: filter.distributorId },
      select: { id: true, distributorLevel: true },
    });
    if (distributor?.distributorLevel === 1) {
      const subs = await this.users.find({
        where: { parentDistributorId: distributor.id, distributorLevel: 2 },
        select: { id: true },
      });
      return {
        mode: 'level1',
        earnId: distributor.id,
        distributorIds: [distributor.id, ...subs.map((s) => s.id)],
        commissionSql: 'COALESCE(SUM(CASE WHEN u.distributorId = :earnId THEN l.commissionCents ELSE l.parentCommissionCents END), 0)',
      };
    }
    return { mode: 'direct', distributorIds: [filter.distributorId], commissionSql: DIRECT_COMMISSION_SQL };
  }
}
