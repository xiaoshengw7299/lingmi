import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 一个账号一张发布码。二维码只打开落地页，不把视频地址写进码里。 */
@Entity('publish_code', { comment: '一键成片发布码' })
@Index('UQ_publish_code_user', ['userId'], { unique: true })
@Index('UQ_publish_code_code', ['code'], { unique: true })
export class PublishCodeEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({ type: 'varchar', length: 16 })
  code: string;

  @Column({ default: true, comment: '停用后扫码页不再打开' })
  enabled: boolean;

  /** 落地页上的名字。空则用昵称 */
  @Column({ name: 'display_name', type: 'varchar', length: 40, default: '' })
  displayName: string;

  /** 默认描述。扫码的人可以在落地页上改，再带进抖音标题 / 小红书正文 */
  @Column({ type: 'varchar', length: 1000, default: '' })
  caption: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  hashtags: string[];

  /** 抖音地点锚点。只有这个 ID 能自动带到发布页，地点名称只用于展示 */
  @Column({ name: 'poi_id', type: 'varchar', length: 32, default: '' })
  poiId: string;

  @Column({ name: 'poi_name', type: 'varchar', length: 80, default: '' })
  poiName: string;

  /** 小红书标题，最多 20 字。空则用描述前 20 字 */
  @Column({ name: 'xhs_title', type: 'varchar', length: 20, default: '' })
  xhsTitle: string;

  /** 下载海报底部的那句话。空则用默认「扫一扫，浏览器打开，一键发布」 */
  @Column({ name: 'qr_caption', type: 'varchar', length: 40, default: '' })
  qrCaption: string;

  @Column({ name: 'view_count', type: 'int', default: 0 })
  viewCount: number;

  @Column({ name: 'douyin_count', type: 'int', default: 0 })
  douyinCount: number;

  @Column({ name: 'xhs_count', type: 'int', default: 0 })
  xhsCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
