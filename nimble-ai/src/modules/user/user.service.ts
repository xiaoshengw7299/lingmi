import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Status } from '../../common/enums';
import { PayClientService, PayWalletSummary } from '../pay/pay-client.service';
import { RedisService } from '../redis/redis.service';
import { VideoProjectEntity } from '../video/entities/video-project.entity';
import { ShortVideoTaskEntity } from '../short-video/entities/short-video-task.entity';

type Wallet = Pick<PayWalletSummary, 'balanceCents' | 'rechargeCents' | 'consumeCents'>;
/** 支付服务里还没开过户：余额和流水都是 0 */
const EMPTY_WALLET: Wallet = { balanceCents: 0, rechargeCents: 0, consumeCents: 0 };

/** 管理后台只需要这些字段，不把微信 openid 等内部信息带出去 */
const present = (u: User) => ({
  id: u.id,
  loginName: u.loginName,
  nickname: u.nickname,
  isAdmin: u.isAdmin,
  isSuperAdmin: u.isSuperAdmin,
  isDistributor: u.isDistributor,
  distributorLevel: u.distributorLevel ?? 0,
  commissionPercent: u.commissionPercent,
  distributorId: u.distributorId,
  status: u.status,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
});

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(VideoProjectEntity)
    private readonly videoRepo: Repository<VideoProjectEntity>,
    @InjectRepository(ShortVideoTaskEntity)
    private readonly shortRepo: Repository<ShortVideoTaskEntity>,
    private readonly pay: PayClientService,
    private readonly redis: RedisService,
  ) {}

  async findPage(page = 1, pageSize = 20, keyword?: string) {
    const qb = this.userRepo.createQueryBuilder('u').orderBy('u.createdAt', 'DESC');
    if (keyword?.trim()) {
      // 关键词里的 % 和 _ 是通配符，转义后才是按字面搜索
      const kw = keyword.trim().replace(/[\\%_]/g, '\\$&');
      qb.where('(u.loginName ILIKE :kw OR u.nickname ILIKE :kw)', { kw: `%${kw}%` });
    }
    const [users, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    const wallets = await this.walletsOf(users.map((u) => u.id));
    return {
      list: users.map((u) => ({ ...present(u), wallet: wallets ? (wallets.get(String(u.id)) ?? EMPTY_WALLET) : null })),
      total,
      page,
      pageSize,
    };
  }

  async setStatus(id: number, status: Status) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) return null;
    if (user.isAdmin && status === Status.Disabled) {
      throw new ForbiddenException('不能禁用平台管理员');
    }
    await this.userRepo.update(id, { status });
    // 登录守卫以会话是否存在为准，禁用时删掉会话，对方已发出的令牌立刻失效
    if (status === Status.Disabled) await this.redis.del(`session:${id}`);
    return present({ ...user, status });
  }

  /** 任命 / 取消管理员。默认管理员自己不能被改；权限变了就让对方重新登录，新令牌才带上正确的身份 */
  async setAdmin(id: number, isAdmin: boolean) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) return null;
    if (user.isSuperAdmin) throw new ForbiddenException('不能修改默认管理员');
    if (user.isAdmin !== isAdmin) {
      await this.userRepo.update(id, { isAdmin });
      await this.redis.del(`session:${id}`);
    }
    return present({ ...user, isAdmin });
  }

  /**
   * 管理员任命一级、调整比例、取消或恢复。已经是二级的，仍按二级处理，不会被提成一级。
   * 只影响之后注册的用户，已有用户的归属不会改。取消一级时，其二级一并停用。
   * 分销状态每次请求都从库里判断，不进令牌，立刻生效，不用对方重新登录。
   */
  async setDistributor(id: number, isDistributor: boolean, commissionPercent?: number) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) return null;
    if (user.distributorLevel === 2) {
      await this.applyChild(user, { isDistributor, commissionPercent });
      return present({ ...user, isDistributor, commissionPercent: commissionPercent ?? user.commissionPercent });
    }
    const percent = commissionPercent ?? user.commissionPercent;
    this.assertPercent(percent, 100);
    if (user.distributorLevel === 1) await this.assertCoversChildren(user.id, percent);
    const appointing = user.distributorLevel === 0 && isDistributor;
    if (!isDistributor && user.isDistributor && user.distributorLevel === 1) {
      await this.userRepo.update({ parentDistributorId: id, distributorLevel: 2, isDistributor: true }, { isDistributor: false });
    }
    const patch = {
      isDistributor,
      commissionPercent: percent,
      distributorLevel: appointing ? 1 : user.distributorLevel,
      ...(appointing ? { parentDistributorId: null as number | null } : {}),
    };
    await this.userRepo.update(id, patch);
    return present({ ...user, ...patch });
  }

  /**
   * 一级指定或调整自己的下级。对方后台同样叫分销后台，接口不返回级别。
   * creating 为真时 targetId 是还不是分销商的直属用户；否则是已经在自己名下的二级。
   */
  async saveChild(
    actorId: number,
    targetId: number,
    patch: { isDistributor?: boolean; commissionPercent?: number },
    creating: boolean,
  ) {
    const actor = await this.userRepo.findOne({ where: { id: actorId } });
    if (!actor?.isDistributor || actor.distributorLevel !== 1) throw new ForbiddenException('没有权限');
    if (creating) {
      if (targetId === actorId) throw new BadRequestException('不能指定自己');
      const target = await this.userRepo.findOne({ where: { id: targetId } });
      if (!target) throw new NotFoundException('用户不存在');
      if (target.distributorId !== actorId) throw new BadRequestException('只能指定归在你名下的用户');
      if (target.distributorLevel !== 0 || target.isDistributor) throw new BadRequestException('该用户已经是分销商');
      if (patch.commissionPercent == null) throw new BadRequestException('请填写佣金比例');
      this.assertPercent(patch.commissionPercent, actor.commissionPercent);
      await this.userRepo.update(targetId, {
        isDistributor: true,
        distributorLevel: 2,
        parentDistributorId: actorId,
        commissionPercent: patch.commissionPercent,
      });
      return;
    }
    const child = await this.userRepo.findOne({ where: { id: targetId } });
    if (!child || child.distributorLevel !== 2 || child.parentDistributorId !== actorId) throw new NotFoundException('分销商不存在');
    await this.applyChild(child, patch);
  }

  /** 二级的比例不能超过其一级当前的比例；恢复时一级必须仍在任 */
  private async applyChild(user: User, patch: { isDistributor?: boolean; commissionPercent?: number }) {
    if (!user.parentDistributorId) throw new BadRequestException('缺少上级分销商');
    const parent = await this.userRepo.findOne({ where: { id: user.parentDistributorId } });
    if (!parent || parent.distributorLevel !== 1) throw new BadRequestException('上级分销商不存在');
    const percent = patch.commissionPercent ?? user.commissionPercent;
    this.assertPercent(percent, parent.commissionPercent);
    const active = patch.isDistributor ?? user.isDistributor;
    if (active && !parent.isDistributor) throw new BadRequestException('上级分销已取消，请先恢复上级');
    await this.userRepo.update(user.id, { isDistributor: active, commissionPercent: percent });
  }

  /** 一级的比例不能低于任何下级（含已取消的），否则下级会比上级拿得多 */
  private async assertCoversChildren(parentId: number, percent: number) {
    const children = await this.userRepo.find({
      where: { parentDistributorId: parentId, distributorLevel: 2 },
      select: { id: true, nickname: true, loginName: true, commissionPercent: true },
    });
    const over = children.filter((c) => c.commissionPercent - percent > 1e-9);
    if (!over.length) return;
    const names = over
      .slice(0, 3)
      .map((c) => c.nickname || c.loginName || `#${c.id}`)
      .join('、');
    const top = Math.max(...over.map((c) => c.commissionPercent));
    throw new BadRequestException(`比例不能低于下级分销商（${names}）当前的 ${top}%`);
  }

  private assertPercent(percent: number, cap: number) {
    if (percent < 0 || percent - cap > 1e-9 || percent > 100) {
      throw new BadRequestException(`比例需在 0～${cap}% 之间`);
    }
  }

  async overview(id: number) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) return null;
    const owner = String(id);
    const [videos, shortVideos, wallets] = await Promise.all([
      this.videoRepo.count({ where: { userId: owner } }),
      this.shortRepo.count({ where: { userId: owner } }),
      this.walletsOf([id]),
    ]);
    return {
      user: present(user),
      wallet: wallets ? (wallets.get(owner) ?? EMPTY_WALLET) : null,
      counts: { videos, shortVideos },
    };
  }

  /** 余额流水。没开过户的用户没有流水，按空列表返回 */
  async ledgers(id: number, page: number, pageSize: number) {
    try {
      return await this.pay.ledgers(String(id), page, pageSize);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 404) return { items: [], total: 0, page, pageSize };
      throw error;
    }
  }

  /** 批量取钱包概况。支付服务没配置或暂时不可用时返回 null，页面显示"—"，不影响用户管理本身 */
  private async walletsOf(ids: number[]): Promise<Map<string, PayWalletSummary> | null> {
    if (!ids.length) return new Map();
    if (!this.pay.enabled()) return null;
    try {
      const rows = await this.pay.summaries(ids.map(String));
      return new Map(rows.map((r) => [r.externalUserId, r]));
    } catch (error) {
      this.logger.warn(`钱包概况获取失败：${error instanceof Error ? error.message : error}`);
      return null;
    }
  }
}
