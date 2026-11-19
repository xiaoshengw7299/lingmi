import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** 画布文档：节点与连线的结构由前端定义，后端只负责原样保存（见 nimble-web/src/views/video-producer/canvas/types.ts） */
export interface CanvasDoc {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  viewport?: { x: number; y: number; zoom: number };
}

@Entity('canvas_projects', { comment: '无限画布项目' })
export class CanvasProjectEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 100, name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  /** 列表封面：画布里第一张图片的地址，保存时自动取 */
  @Column({ type: 'varchar', length: 500, nullable: true, name: 'cover_url' })
  coverUrl: string | null;

  @Column({ type: 'jsonb' })
  doc: CanvasDoc;

  /** 乐观锁版本号：多标签页同时编辑时，后保存的一方会收到冲突提示而不是静默覆盖 */
  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
