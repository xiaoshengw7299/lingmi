import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { CanvasDoc } from './canvas.entity';

/**
 * 分享的画布作品：把画布整份复制一份（含媒体文件），别人先预览效果，再一键复制成自己的画布。
 * 与工作台案例（video_examples）并列出现在创作首页。
 */
@Entity('canvas_examples', { comment: '分享的画布作品' })
export class CanvasExampleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'cover_url' })
  coverUrl: string | null;

  @Column({ type: 'jsonb' })
  doc: CanvasDoc;

  @Column({ type: 'uuid', nullable: true, name: 'source_canvas_id' })
  sourceCanvasId: string | null;

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
