import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Status } from '../../../common/enums';

/** 个人账号。微信扫码第一次登录时创建，并分配登录账号。 */
@Entity('account', { comment: '个人账号' })
export class User {
  @PrimaryGeneratedColumn({ comment: '主键ID' })
  id: number;

  /** 首次登录时分配，微信账号可在账号安全中修改。 */
  @Index('UQ_account_login_name', { unique: true })
  @Column({ name: 'login_name', type: 'varchar', length: 32, nullable: true, comment: '登录账号，首次登录时分配' })
  loginName: string | null;

  @Column({ nullable: true, comment: '昵称' })
  nickname: string;

  @Column({ nullable: true, comment: '头像 URL' })
  avatar: string;

  @Column({ select: false, nullable: true, comment: '密码（bcrypt）' })
  password: string;

  @Column({ name: 'wechat_open_id', unique: true, nullable: true, comment: '微信开放平台 openid' })
  wechatOpenId: string;

  @Column({ name: 'wechat_union_id', nullable: true, comment: '微信开放平台 unionid' })
  wechatUnionId: string;

  @Column({ name: 'is_admin', default: false, comment: '是否平台超管' })
  isAdmin: boolean;

  /** 默认管理员，全平台只有一个：能指定或取消其他管理员，自己不能被取消。其他管理员除此之外权限一致。 */
  @Column({ name: 'is_super_admin', default: false, comment: '是否默认管理员（唯一，可任命其他管理员）' })
  isSuperAdmin: boolean;

  @Column({ type: 'smallint', default: Status.Enabled, comment: '0=禁用 1=启用' })
  status: Status;

  /** 预留给后续套餐，本期不参与鉴权。 */
  @Column({ default: 'free', comment: '套餐标识，后续接支付' })
  plan: string;

  @Column({ name: 'last_login_at', nullable: true, comment: '最后登录时间' })
  lastLoginAt: Date;

  @Column({ name: 'referral_code', type: 'varchar', length: 16, unique: true, nullable: true, comment: '推广码，首次打开用户中心时生成' })
  referralCode: string | null;

  @Column({ name: 'invited_by', type: 'int', nullable: true, comment: '邀请人账号 ID，首次登录时绑定，不可更改' })
  invitedBy: number | null;

  @Column({ name: 'is_distributor', default: false, comment: '是否现任分销商。一级由默认管理员任命，二级由一级指定' })
  isDistributor: boolean;

  /** 取消后仍保留，管理员用户列表据此显示级别。0 普通，1 一级，2 二级 */
  @Column({ name: 'distributor_level', type: 'smallint', default: 0, comment: '分销级别：0 普通，1 一级，2 二级' })
  distributorLevel: number;

  /** 二级的上级。一级为空。二级看到的后台不暴露这个字段 */
  @Index('IDX_account_parent_distributor')
  @Column({ name: 'parent_distributor_id', type: 'int', nullable: true, comment: '二级分销的上级（一级）账号 ID' })
  parentDistributorId: number | null;

  @Column({ name: 'commission_percent', type: 'float', default: 0, comment: '分销商佣金比例（%），按名下用户产生的利润计算。二级的比例从上级的比例里分出，不能超过上级' })
  commissionPercent: number;

  /**
   * 所属分销商。注册时一次算定，之后不再改：邀请人是现任分销商就归邀请人（一级或二级），
   * 否则沿用邀请人的归属。用户直接带着分销商 ID，统计不用递归。
   */
  @Index('IDX_account_distributor')
  @Column({ name: 'distributor_id', type: 'int', nullable: true, comment: '所属分销商账号 ID，注册时确定，不可更改' })
  distributorId: number | null;

  @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', comment: '更新时间' })
  updatedAt: Date;
}
