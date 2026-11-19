import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type UsageKind = 'image' | 'video' | 'audio' | 'llm' | 'tool';

/**
 * 用户消费账单，每次扣费成功写一行，任务失败退款时标记 refunded，统计只算有效调用。
 * 利润 = 用户实付 - 上游成本，两个金额都在扣费当时定下来，之后汇率或加价变了也不影响历史账单。
 */
@Entity('usage_log', { comment: '用户消费账单' })
@Index('IDX_usage_log_created', ['createdAt'])
@Index('IDX_usage_log_user_created', ['userId', 'createdAt'])
export class UsageLog {
  @PrimaryGeneratedColumn({ comment: '主键ID' })
  id: number;

  @Column({ name: 'user_id', type: 'int', comment: '账号 ID' })
  userId: number;

  @Column({ type: 'varchar', length: 16, comment: '类型：image/video/audio/llm/tool' })
  kind: UsageKind;

  @Column({ type: 'varchar', length: 128, comment: 'Atlas 模型 id' })
  model: string;

  @Column({ name: 'model_name', type: 'varchar', length: 128, comment: '模型展示名' })
  modelName: string;

  /** 文本模型按 token 结算，单次金额不足 1 分，所以用浮点 */
  @Column({ name: 'charge_cents', type: 'float', default: 0, comment: '用户实付（分）' })
  chargeCents: number;

  @Column({ name: 'upstream_cents', type: 'float', default: 0, comment: '上游成本（分）：Atlas 实付价按当时汇率折算，不含加价' })
  upstreamCents: number;

  /**
   * 直属分销商的佣金：利润 × 他当时的比例。用户归一级时这就是一级的全部佣金；
   * 归二级时这是二级拿走的那一份。存下来之后改比例、取消身份都不影响。
   */
  @Column({ name: 'commission_cents', type: 'float', default: 0, comment: '直属分销商佣金（分），扣费当时固定' })
  commissionCents: number;

  /** 用户归二级时，一级从自己的比例里扣掉二级之后剩下的佣金。归一级时为 0 */
  @Column({ name: 'parent_commission_cents', type: 'float', default: 0, comment: '一级分销从二级名下用户分得的佣金（分），扣费当时固定' })
  parentCommissionCents: number;

  @Column({ name: 'biz_no', type: 'varchar', length: 64, nullable: true, comment: '扣款业务号，退款时据此回写' })
  bizNo: string | null;

  @Column({ default: false, comment: '任务失败已退款' })
  refunded: boolean;

  @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
  createdAt: Date;
}
