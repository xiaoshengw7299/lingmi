import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

const decimal = {
  to: (value: number | null | undefined) => value ?? null,
  from: (value: string | null) => (value == null ? null : Number(value)),
};

/** 全局规则的主键 */
export const GLOBAL_RULE_ID = '*';

/**
 * 定价规则。主键 `*` 是全局规则（默认加价系数），
 * 汇率由接口实时获取，`usd_cny` 列已不再参与计价。
 * 其余行的主键是 Atlas 模型 id，用来给单个模型覆盖加价系数或手填官方价。
 */
@Entity('pricing_rule', { comment: '模型定价规则' })
export class PricingRule {
  @PrimaryColumn({ comment: '`*` 为全局；否则为 Atlas 模型 id' })
  id: string;

  @Column({ type: 'numeric', precision: 8, scale: 4, nullable: true, transformer: decimal, comment: '加价系数，空表示沿用全局' })
  markup: number | null;

  @Column({ name: 'usd_cny', type: 'numeric', precision: 8, scale: 4, nullable: true, transformer: decimal, comment: '已停用：汇率改由接口获取，此列不再参与计价' })
  usdCny: number | null;

  @Column({ name: 'official_unit_cny', type: 'numeric', precision: 12, scale: 6, nullable: true, transformer: decimal, comment: '手填官方单价（元/计价单位），空表示取接口值' })
  officialUnitCny: number | null;

  /** 视频售价系数：用户价 = 所选规格官方价 × 系数。1 为官方价，0.8 为八折。空表示 1 */
  @Column({ type: 'numeric', precision: 8, scale: 4, nullable: true, transformer: decimal, comment: '视频售价系数，乘在所选规格官方价上，空表示 1' })
  discount: number | null;

  @UpdateDateColumn({ name: 'updated_at', comment: '更新时间' })
  updatedAt: Date;
}
