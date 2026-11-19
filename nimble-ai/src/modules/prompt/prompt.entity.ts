import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type PromptType = 'image' | 'video';

export interface PromptParams {
  ratio?: string;
  resolution?: string;
  durationSec?: number;
}

/** 提示词附带的参考素材：提示词里用 @名称 引用，别人可以拿同样的素材去复现 */
export interface PromptReference {
  name: string;
  kind: 'image' | 'video' | 'audio';
  /** 对象键 */
  key: string;
}

/** 提示词库（全员共享）：一条提示词 + 它在指定模型上生成出来的示例成品 */
@Entity('prompts', { comment: '共享提示词库' })
export class PromptEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  type: PromptType;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'model_id' })
  modelId: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'model_name' })
  modelName: string | null;

  @Column({ type: 'jsonb', nullable: true })
  params: PromptParams | null;

  @Column({ type: 'jsonb', default: [] })
  references: PromptReference[];

  /** 示例成品（图片或视频）的对象键 */
  @Column({ type: 'varchar', length: 500, name: 'media_key' })
  mediaKey: string;

  @Column({ type: 'varchar', length: 100, name: 'created_by' })
  createdBy: string;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'created_by_name' })
  createdByName: string | null;

  @Column({ type: 'int', default: 0, name: 'view_count' })
  viewCount: number;

  @Column({ type: 'int', default: 0, name: 'copy_count' })
  copyCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
