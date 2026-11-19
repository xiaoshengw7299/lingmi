import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('np_sys_user', { comment: '后台系统用户' })
export class SysUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  @Column({ default: '' })
  realName: string;

  @Column()
  passwordHash: string;

  @Column({ default: false })
  isSuperAdmin: boolean;

  @Column({ default: 'ACTIVE' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => SysUserRole, (r) => r.user)
  roles: SysUserRole[];
}

@Entity('np_sys_role', { comment: '后台角色' })
export class SysRole {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string;

  @Column()
  name: string;

  @Column({ default: '' })
  remark: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => SysRolePermission, (r) => r.role)
  permissions: SysRolePermission[];

  @OneToMany(() => SysUserRole, (r) => r.role)
  users: SysUserRole[];
}

@Entity('np_sys_permission', { comment: '后台权限' })
export class SysPermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string;

  @Column()
  name: string;

  @Column()
  group: string;

  @OneToMany(() => SysRolePermission, (r) => r.permission)
  roles: SysRolePermission[];
}

@Entity('np_sys_role_permission', { comment: '角色权限关联' })
export class SysRolePermission {
  @PrimaryColumn()
  roleId: string;

  @PrimaryColumn()
  permissionId: string;

  @ManyToOne(() => SysRole, (r) => r.permissions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roleId' })
  role: SysRole;

  @ManyToOne(() => SysPermission, (p) => p.roles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'permissionId' })
  permission: SysPermission;
}

@Entity('np_sys_user_role', { comment: '用户角色关联' })
export class SysUserRole {
  @PrimaryColumn()
  userId: string;

  @PrimaryColumn()
  roleId: string;

  @ManyToOne(() => SysUser, (u) => u.roles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: SysUser;

  @ManyToOne(() => SysRole, (r) => r.users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roleId' })
  role: SysRole;
}

@Entity('np_audit_log', { comment: '操作审计日志' })
@Index(['createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  userId: string;

  @Column({ default: '' })
  username: string;

  @Column({ default: '' })
  ip: string;

  @Column()
  method: string;

  @Column()
  path: string;

  @Column({ default: '' })
  action: string;

  @Column({ default: 200 })
  status: number;

  @Column({ default: '' })
  reqBody: string;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity('np_sys_setting', { comment: '系统配置' })
export class SysSetting {
  @PrimaryColumn()
  key: string;

  @Column()
  name: string;

  @Column()
  group: string;

  @Column()
  value: string;
}

@Entity('np_alipay_config', { comment: '支付宝配置' })
export class AlipayConfig {
  @PrimaryColumn({ default: 'default' })
  id: string;

  @Column({ default: false })
  enabled: boolean;

  @Column({ default: true })
  sandbox: boolean;

  @Column({ default: '' })
  appId: string;

  @Column({ default: 'RSA2' })
  signType: string;

  @Column({ default: 'PKCS1' })
  keyType: string;

  @Column({ default: false })
  useCert: boolean;

  @Column({ default: '' })
  privateKeyEnc: string;

  @Column({ default: '' })
  alipayPublicKeyEnc: string;

  @Column({ default: '' })
  appCertEnc: string;

  @Column({ default: '' })
  alipayPublicCertEnc: string;

  @Column({ default: '' })
  alipayRootCertEnc: string;

  @Column({ default: '' })
  notifyUrlOverride: string;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('np_open_app', { comment: '开放应用' })
export class OpenApp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  appId: string;

  @Column()
  appName: string;

  @Column()
  secretEnc: string;

  @Column({ default: '' })
  secretHint: string;

  @Column({ default: 'ACTIVE' })
  status: string;

  @Column({ default: '' })
  remark: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/** nimble 账号在支付侧的钱包。externalUserId 是 nimble account.id */
@Entity('np_wallet_user', { comment: '用户钱包' })
@Index(['createdAt'])
export class WalletUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  externalUserId: string;

  @Column({ default: '' })
  email: string;

  @Column({ default: '' })
  nickname: string;

  @Column({ default: 0 })
  balanceCents: number;

  @Column({ default: 'ACTIVE' })
  status: string;

  @Column({ default: '' })
  remark: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => PayOrder, (o) => o.user)
  payOrders: PayOrder[];

  @OneToMany(() => WalletLedger, (l) => l.user)
  ledgers: WalletLedger[];
}

@Entity('np_wallet_ledger', { comment: '钱包流水' })
@Index(['userId', 'createdAt'])
@Index(['orderId', 'type'], { unique: true })
@Index(['refundId', 'type'], { unique: true })
@Index(['bizNo', 'type'], { unique: true })
export class WalletLedger {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({ type: 'varchar', nullable: true })
  orderId: string | null;

  @Column({ type: 'varchar', nullable: true })
  refundId: string | null;

  /** 业务幂等号：消费、消费退回、推广奖励、注册赠送、分享奖励。同一 bizNo + type 只记一次 */
  @Column({ type: 'varchar', nullable: true })
  bizNo: string | null;

  /** RECHARGE | REFUND_DEDUCT | REFUND_RESTORE | ADMIN_GRANT | ADMIN_REVOKE | CONSUME | CONSUME_REFUND | REFERRAL_REWARD | SIGNUP_GIFT | SHARE_REWARD */
  @Column()
  type: string;

  @Column()
  amountCents: number;

  @Column()
  balanceBefore: number;

  @Column()
  balanceAfter: number;

  @Column({ default: '' })
  remark: string;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => WalletUser, (u) => u.ledgers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: WalletUser;
}

/** 推广关系：一个被邀请人只能有一个邀请人。被邀请人首次充值达标后发奖，状态变 REWARDED */
@Entity('np_referral', { comment: '推广关系' })
@Index(['inviterId', 'createdAt'])
export class Referral {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  inviterId: string;

  @Column({ unique: true })
  inviteeId: string;

  /** BOUND 已绑定待首充 | REWARDED 已发奖 */
  @Column({ default: 'BOUND' })
  status: string;

  @Column({ default: 0 })
  rewardCents: number;

  @Column({ type: 'timestamptz', nullable: true })
  rewardedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => WalletUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inviterId' })
  inviter: WalletUser;

  @ManyToOne(() => WalletUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inviteeId' })
  invitee: WalletUser;
}

@Entity('np_pay_order', { comment: '支付订单' })
@Index(['userId', 'createdAt'])
@Index(['status', 'expiredAt'])
@Index(['appId', 'clientOrderNo'], { unique: true })
export class PayOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  orderNo: string;

  @Column()
  clientOrderNo: string;

  @Column()
  appId: string;

  @Column()
  userId: string;

  @Column()
  amountCents: number;

  @Column()
  subject: string;

  @Column({ default: '' })
  body: string;

  @Column({ default: 'INIT' })
  status: string;

  @Column({ default: 'NONE' })
  refundState: string;

  @Column({ default: 0 })
  refundedCents: number;

  @Column({ default: 'FORBID' })
  divisionMode: string;

  @Column({ default: 'NONE' })
  divisionState: string;

  @Column({ default: 'PAGE' })
  payScene: string;

  @Column({ default: 'FAST_INSTANT_TRADE_PAY' })
  productCode: string;

  @Column({ type: 'varchar', nullable: true, unique: true })
  payToken: string | null;

  @Column({ default: 'alipay' })
  channel: string;

  @Column({ default: '' })
  channelTradeNo: string;

  @Column({ default: '' })
  buyerLogonId: string;

  @Column({ default: 0 })
  channelFeeCents: number;

  @Column({ default: 0 })
  receiptAmountCents: number;

  @Column({ default: '' })
  clientIp: string;

  @Column({ type: 'timestamptz' })
  expiredAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ default: '' })
  channelResp: string;

  @Column({ default: '' })
  notifyPayload: string;

  @Column({ default: false })
  testPay: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => WalletUser, (u) => u.payOrders)
  @JoinColumn({ name: 'userId' })
  user: WalletUser;

  @OneToMany(() => RefundOrder, (r) => r.payOrder)
  refunds: RefundOrder[];

  @OneToMany(() => DivisionRecord, (r) => r.payOrder)
  divisions: DivisionRecord[];
}

@Entity('np_refund_order', { comment: '退款订单' })
@Index(['payOrderId'])
export class RefundOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  refundNo: string;

  @Column()
  payOrderId: string;

  @Column()
  appId: string;

  @Column()
  userId: string;

  @Column()
  amountCents: number;

  @Column({ default: '' })
  reason: string;

  @Column({ default: 'CREATED' })
  status: string;

  @Column({ default: '' })
  channelRefundNo: string;

  @Column({ default: '' })
  channelResp: string;

  @Column({ default: '' })
  operatorId: string;

  @Column({ default: '' })
  notifyPayload: string;

  @Column({ default: false })
  balanceHeld: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  succeedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => PayOrder, (o) => o.refunds)
  @JoinColumn({ name: 'payOrderId' })
  payOrder: PayOrder;

  @ManyToOne(() => WalletUser)
  @JoinColumn({ name: 'userId' })
  user: WalletUser;
}

@Entity('np_transfer_order', { comment: '转账订单' })
@Index(['createdAt'])
export class TransferOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  transferNo: string;

  @Column({ default: '' })
  clientOrderNo: string;

  @Column()
  appId: string;

  @Column()
  amountCents: number;

  @Column()
  accountNo: string;

  @Column({ default: '' })
  accountName: string;

  @Column({ default: 'ALIPAY_LOGON_ID' })
  identityType: string;

  @Column({ default: '余额转账' })
  orderTitle: string;

  @Column({ default: '' })
  remark: string;

  @Column({ default: 'CREATED' })
  status: string;

  @Column({ default: '' })
  failReason: string;

  @Column({ default: '' })
  channelOrderNo: string;

  @Column({ default: '' })
  channelResp: string;

  @Column({ default: '' })
  notifyPayload: string;

  @Column({ default: '' })
  operatorId: string;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('np_division_receiver', { comment: '分账接收方' })
export class DivisionReceiver {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  accountNo: string;

  @Column()
  accountName: string;

  @Column({ default: 'loginName' })
  accountType: string;

  @Column()
  ratioBps: number;

  @Column({ default: 'PENDING' })
  bindStatus: string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ default: '' })
  bindResp: string;

  @Column({ default: '' })
  remark: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => DivisionRecord, (r) => r.receiver)
  records: DivisionRecord[];
}

@Entity('np_division_record', { comment: '分账记录' })
@Index(['payOrderId'])
@Index(['batchNo'])
export class DivisionRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  batchNo: string;

  @Column()
  payOrderId: string;

  @Column()
  receiverId: string;

  @Column()
  amountCents: number;

  @Column({ default: 'WAIT' })
  status: string;

  @Column({ default: '' })
  channelResp: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => PayOrder, (o) => o.divisions)
  @JoinColumn({ name: 'payOrderId' })
  payOrder: PayOrder;

  @ManyToOne(() => DivisionReceiver, (r) => r.records)
  @JoinColumn({ name: 'receiverId' })
  receiver: DivisionReceiver;
}

@Entity('np_recon_batch', { comment: '对账批次' })
@Index(['billDate', 'billType'], { unique: true })
export class ReconBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  billDate: string;

  @Column()
  billType: string;

  @Column({ default: 'PENDING' })
  status: string;

  @Column({ default: '' })
  downloadUrl: string;

  @Column({ default: 0 })
  channelCount: number;

  @Column({ default: 0 })
  localCount: number;

  @Column({ default: 0 })
  matchedCount: number;

  @Column({ default: 0 })
  diffCount: number;

  @Column({ default: 0 })
  channelAmountCents: number;

  @Column({ default: 0 })
  localAmountCents: number;

  @Column({ default: 0 })
  feeCents: number;

  @Column({ default: '' })
  errorMsg: string;

  @Column({ default: '' })
  operatorId: string;

  @CreateDateColumn()
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @OneToMany(() => ReconItem, (i) => i.batch)
  items: ReconItem[];
}

@Entity('np_recon_item', { comment: '对账明细' })
@Index(['batchId', 'diffType'])
export class ReconItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  batchId: string;

  @Column()
  bizType: string;

  @Column()
  diffType: string;

  @Column({ default: 'OPEN' })
  handleStatus: string;

  @Column({ default: '' })
  channelTradeNo: string;

  @Column({ default: '' })
  channelOutNo: string;

  @Column({ default: '' })
  channelRefundNo: string;

  @Column({ default: 0 })
  channelAmountCents: number;

  @Column({ default: 0 })
  channelFeeCents: number;

  @Column({ default: '' })
  channelStatus: string;

  @Column({ default: '' })
  channelTime: string;

  @Column({ default: '' })
  localOrderNo: string;

  @Column({ default: 0 })
  localAmountCents: number;

  @Column({ default: '' })
  localStatus: string;

  @Column({ default: '' })
  rawLine: string;

  @Column({ default: '' })
  remark: string;

  @Column({ default: '' })
  handledBy: string;

  @Column({ type: 'timestamptz', nullable: true })
  handledAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => ReconBatch, (b) => b.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'batchId' })
  batch: ReconBatch;
}

export const ENTITIES = [
  SysUser,
  SysRole,
  SysPermission,
  SysRolePermission,
  SysUserRole,
  AuditLog,
  SysSetting,
  AlipayConfig,
  OpenApp,
  WalletUser,
  WalletLedger,
  Referral,
  PayOrder,
  RefundOrder,
  TransferOrder,
  DivisionReceiver,
  DivisionRecord,
  ReconBatch,
  ReconItem,
];
