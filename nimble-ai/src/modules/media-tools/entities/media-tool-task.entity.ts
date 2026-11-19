import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { InputFile, OutputKind } from '../media-tools.catalog';

export type MediaToolStatus = 'running' | 'succeeded' | 'failed';

export interface MediaToolOutput {
  kind: OutputKind;
  label: string;
  /** 对象键，出站再拼公网地址 */
  key: string;
}

/**
 * 视频工具 / 通用工具的生成记录。只留记录和结果：输入文件在 MediaKit 侧 30 天自动清理，
 * 结果都在 `ai-tool/<userId>/<id>/` 下，删记录时整个目录一起删。
 */
@Entity('media_tool_task', { comment: '智能工具生成记录' })
@Index('IDX_media_tool_task_user_tool', ['userId', 'tool', 'createdAt'])
export class MediaToolTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'varchar', length: 100 })
  userId: string;

  @Column({ type: 'varchar', length: 40, comment: '工具 id，见 media-tools.catalog' })
  tool: string;

  @Column({ type: 'varchar', length: 40, comment: '工具版本 / 模式' })
  mode: string;

  @Column({ type: 'varchar', length: 20, default: 'running' })
  status: MediaToolStatus;

  @Column({ type: 'jsonb', comment: '输入文件与参数快照' })
  params: { inputs: Record<string, InputFile[]>; values: Record<string, unknown> };

  @Index('IDX_media_tool_task_upstream')
  @Column({ name: 'upstream_id', type: 'varchar', length: 128, nullable: true, comment: 'MediaKit 任务 ID' })
  upstreamId: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  outputs: MediaToolOutput[];

  @Column({ name: 'thumb_key', type: 'varchar', length: 500, nullable: true })
  thumbKey: string | null;

  /** 字幕、剧本 ID、高光片段等结构化结果；爆款复刻还记着后续生成的视频任务 */
  @Column({ type: 'jsonb', nullable: true })
  data: Record<string, unknown> | null;

  @Column({ name: 'charge_cents', type: 'int', default: 0, comment: '已扣金额（分），含补扣' })
  chargeCents: number;

  /** 预扣时按官方价算的金额，完成后和实际用量比，多出来的补扣 */
  @Column({ name: 'prepaid_cny', type: 'float', default: 0 })
  prepaidCny: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
