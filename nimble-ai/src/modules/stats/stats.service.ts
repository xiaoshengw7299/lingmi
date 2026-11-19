import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as dayjs from 'dayjs';
import { Repository } from 'typeorm';
import { BillService, BillTotals, rangeSince, UsageRange } from '../billing/bill.service';
import { PayClientService, PayStats } from '../pay/pay-client.service';
import { ShortVideoTaskEntity } from '../short-video/entities/short-video-task.entity';
import { User } from '../user/entities/user.entity';
import { VideoProjectEntity } from '../video/entities/video-project.entity';
import { ONLINE_WINDOW_MS, PresenceService } from './presence.service';

const TREND_DAYS = 14;

/** 平台管理员的统计页数据：用户、作品来自本库，充值来自支付服务，模型用量来自消费账单 */
@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(VideoProjectEntity) private readonly videoRepo: Repository<VideoProjectEntity>,
    @InjectRepository(ShortVideoTaskEntity) private readonly shortRepo: Repository<ShortVideoTaskEntity>,
    private readonly bills: BillService,
    private readonly presence: PresenceService,
    private readonly pay: PayClientService,
  ) {}

  async overview(range: UsageRange) {
    const today = dayjs().startOf('day');
    const [users, works, usage, recharge] = await Promise.all([
      this.userStats(today),
      this.workStats(),
      this.usageStats(range),
      this.rechargeStats(),
    ]);
    return { users, works, recharge, usage: { range, ...usage } };
  }

  private async userStats(today: dayjs.Dayjs) {
    const from = today.subtract(TREND_DAYS - 1, 'day');
    const [total, perDay, online, activeToday] = await Promise.all([
      this.userRepo.count(),
      this.userRepo
        .createQueryBuilder('u')
        .select(`TO_CHAR(u.createdAt, 'YYYY-MM-DD')`, 'day')
        .addSelect('COUNT(*)', 'count')
        .where('u.createdAt >= :from', { from: from.toDate() })
        .groupBy('day')
        .getRawMany<{ day: string; count: string }>(),
      this.presence.online(),
      this.presence.countSince(today.valueOf()),
    ]);
    const byDay = new Map(perDay.map((r) => [r.day, Number(r.count)]));
    const trend = Array.from({ length: TREND_DAYS }, (_, i) => {
      const date = from.add(i, 'day').format('YYYY-MM-DD');
      return { date, count: byDay.get(date) ?? 0 };
    });
    return {
      total,
      today: trend[TREND_DAYS - 1].count,
      online,
      onlineWindowMinutes: ONLINE_WINDOW_MS / 60_000,
      activeToday,
      trend,
    };
  }

  private async workStats() {
    const [videos, shortVideos] = await Promise.all([
      this.videoRepo.count(),
      this.shortRepo.count(),
    ]);
    return { videos, shortVideos };
  }

  /** 支付服务没配置或暂时不可用时返回 null，页面对应区块显示"暂不可用"，不影响其他统计 */
  private async rechargeStats(): Promise<PayStats | null> {
    if (!this.pay.enabled()) return null;
    return this.pay.stats().catch((error) => {
      this.logger.warn(`充值统计获取失败：${error instanceof Error ? error.message : error}`);
      return null;
    });
  }

  /** 只统计有效调用（任务失败已退款的不算），按模型汇总，再按类型合计 */
  private async usageStats(range: UsageRange) {
    const rows = await this.bills.byModel({ since: rangeSince(range) });
    const kinds = new Map<string, BillTotals & { kind: string }>();
    for (const r of rows) {
      const item = kinds.get(r.kind) ?? { kind: r.kind, calls: 0, chargeCents: 0, upstreamCents: 0, profitCents: 0, commissionCents: 0 };
      item.calls += r.calls;
      item.chargeCents += r.chargeCents;
      item.upstreamCents += r.upstreamCents;
      item.profitCents += r.profitCents;
      item.commissionCents += r.commissionCents;
      kinds.set(r.kind, item);
    }
    return { kinds: [...kinds.values()], models: rows.sort((a, b) => b.calls - a.calls).slice(0, 30) };
  }
}
