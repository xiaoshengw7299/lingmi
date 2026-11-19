import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import {
  AssetKind,
  AssetSource,
  GenerationMode,
  LoraSelection,
  MediaAsset,
  MediaStatus,
  ProjectStatus,
} from './video-project.entity';

export interface ExampleAssetSnapshot {
  name: string;
  kind: AssetKind;
  prompt: string;
  source: AssetSource;
}

export interface ExampleShotSnapshot {
  name: string;
  videoPrompt: string;
  durationSec: number;
  ratio?: string;
  index: number;
}

/** 案例里一条分镜：只保留当前最新成片，不含历史版本 */
export interface ExampleShotFullSnapshot {
  id: string;
  index: number;
  name: string;
  videoPrompt: string;
  durationSec: number;
  ratio?: string | null;
  modelId?: string | null;
  lora?: LoraSelection | null;
  resolution?: string | null;
  videoUrl?: string | null;
  videoStatus: MediaStatus;
  videoError?: string | null;
}

/** 当前工作台快照：素材、分镜成片、成片；不含合成历史和分镜旧版本 */
export interface ExampleProjectSnapshot {
  generationMode: GenerationMode;
  status: ProjectStatus;
  assets: MediaAsset[];
  shots: ExampleShotFullSnapshot[];
  finalVideoUrl: string | null;
  finalVideoCoverUrl: string | null;
  finalVideoStatus: MediaStatus;
}

/**
 * 生成示例（案例库）
 *
 * 把当前工作台的最新内容（素材 / 分镜成片 / 成片）复制一份，
 * 供他人先预览效果，再一键复制成自己的项目。
 */
@Entity('video_examples', { comment: '视频生成案例' })
export class VideoExampleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'cover_url' })
  coverUrl: string | null;

  @Column({ type: 'text' })
  requirement: string;

  @Column({ type: 'jsonb', default: [] })
  assets: ExampleAssetSnapshot[];

  @Column({ type: 'jsonb', default: [] })
  shots: ExampleShotSnapshot[];

  @Column({ type: 'jsonb', nullable: true })
  snapshot: ExampleProjectSnapshot | null;

  @Column({ type: 'uuid', nullable: true, name: 'source_project_id' })
  sourceProjectId: string | null;

  @Column({ type: 'varchar', length: 100, name: 'created_by' })
  createdBy: string;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'created_by_name' })
  createdByName: string | null;

  /** 被他人复制成自己工作台的次数。作者自己复制不计 */
  @Column({ type: 'int', default: 0, name: 'copy_count' })
  copyCount: number;

  /** 打开预览的次数 */
  @Column({ type: 'int', default: 0, name: 'view_count' })
  viewCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
