import { Column, Entity, PrimaryColumn } from 'typeorm';

const decimal = {
  to: (value: number | null | undefined) => value ?? null,
  from: (value: string | null) => (value == null ? null : Number(value)),
};

/** 本地计价怎么把「一次询价的总价」放大成当次用量 */
export type QuoteScale = 'second' | 'image' | 'thousand_chars' | 'each' | 'token';

/**
 * Atlas 询价快照。只有管理员点击「重新询价」才写入。
 * 价目表和生成扣费都读这里，不再临时请求 Atlas。
 */
@Entity('model_quote', { comment: 'Atlas 询价快照' })
export class ModelQuote {
  @PrimaryColumn({ type: 'varchar', length: 160, comment: 'Atlas 模型 id' })
  id: string;

  @Column({ type: 'varchar', length: 16, comment: 'video/image/audio/llm/vision' })
  kind: string;

  /** second=按秒，image=按张，thousand_chars=按千字，each=按次，token=按百万 token */
  @Column({ type: 'varchar', length: 32, default: 'each', comment: '用量折算方式' })
  scale: QuoteScale;

  /** 媒体模型：这次询价的总价（美元）。文本模型为空，单价在 input_usd 等列 */
  @Column({ type: 'numeric', precision: 14, scale: 8, nullable: true, transformer: decimal, comment: '询价总价（美元）' })
  usd: number | null;

  @Column({ name: 'official_usd', type: 'numeric', precision: 14, scale: 8, nullable: true, transformer: decimal, comment: '询价官方价（美元）' })
  officialUsd: number | null;

  @Column({ type: 'numeric', precision: 8, scale: 4, nullable: true, transformer: decimal, comment: 'Atlas 折扣，100 为无折扣' })
  discount: number | null;

  @Column({ type: 'varchar', length: 32, default: '', comment: '计价单位，如秒、张、千字' })
  unit: string;

  /** usd 对应几个计价单位。视频询 5 秒则 per=5，单价 = usd / per */
  @Column({ type: 'numeric', precision: 12, scale: 4, default: 1, transformer: decimal, comment: '询价总价对应的单位数量' })
  per: number;

  @Column({ type: 'varchar', length: 128, default: '', comment: '询价场景说明' })
  scenario: string;

  @Column({ name: 'display_name', type: 'varchar', length: 200, default: '', comment: '账单里用的模型名' })
  displayName: string;

  @Column({ type: 'jsonb', nullable: true, comment: '询价时提交给 Atlas 的请求体' })
  probe: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true, comment: 'Atlas 返回的报价原文' })
  raw: Record<string, unknown> | null;

  @Column({ name: 'input_usd', type: 'numeric', precision: 14, scale: 8, nullable: true, transformer: decimal, comment: '文本模型输入单价，美元 / 百万 token' })
  inputUsd: number | null;

  @Column({ name: 'output_usd', type: 'numeric', precision: 14, scale: 8, nullable: true, transformer: decimal, comment: '文本模型输出单价，美元 / 百万 token' })
  outputUsd: number | null;

  @Column({ name: 'cache_usd', type: 'numeric', precision: 14, scale: 8, nullable: true, transformer: decimal, comment: '文本模型缓存单价，美元 / 百万 token' })
  cacheUsd: number | null;

  @Column({ name: 'official_input_usd', type: 'numeric', precision: 14, scale: 8, nullable: true, transformer: decimal, comment: '文本模型官方输入单价，美元 / 百万 token' })
  officialInputUsd: number | null;

  @Column({ name: 'official_output_usd', type: 'numeric', precision: 14, scale: 8, nullable: true, transformer: decimal, comment: '文本模型官方输出单价，美元 / 百万 token' })
  officialOutputUsd: number | null;

  /** 该形态询价失败时，沿用同系列另一个形态的报价 */
  @Column({ name: 'inherited_from', type: 'varchar', length: 160, nullable: true, comment: '沿用的 Atlas 模型 id，空表示本身询价成功' })
  inheritedFrom: string | null;

  /** 最近一次询价失败的原因。有历史报价时价格仍保留 */
  @Column({ name: 'quote_error', type: 'text', nullable: true, comment: '最近一次询价失败原因' })
  quoteError: string | null;

  /** 最近一次成功询价的时间。失败保留旧价时不改这个时间 */
  @Column({ name: 'quoted_at', type: 'timestamp', nullable: true, comment: '最近一次成功询价时间' })
  quotedAt: Date | null;
}
