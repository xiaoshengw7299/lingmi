import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type AssetKind = 'image' | 'video' | 'audio' | 'prompt';

export interface AssetMeta {
  /** 生成该素材时用的提示词 / 模型，方便之后复用 */
  prompt?: string;
  modelName?: string;
  /** 来源：workbench=视频制作 canvas=无限画布 library=提示词库 upload=本地上传 */
  from?: 'workbench' | 'canvas' | 'library' | 'upload';
}

/** 我的资产：每条媒体资产在对象存储里是独立副本，源项目删除后依然可用 */
@Entity('user_assets', { comment: '用户资产（图片/视频/音频/提示词）' })
@Index(['userId', 'kind', 'createdAt'])
export class UserAssetEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 20 })
  kind: AssetKind;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** 媒体资产的对象键；提示词没有 */
  @Column({ type: 'varchar', length: 500, nullable: true, name: 'object_key' })
  objectKey: string | null;

  /** 提示词资产的正文 */
  @Column({ type: 'text', nullable: true })
  content: string | null;

  @Column({ type: 'jsonb', nullable: true })
  meta: AssetMeta | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
