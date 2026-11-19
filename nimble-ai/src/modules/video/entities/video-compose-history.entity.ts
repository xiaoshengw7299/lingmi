import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { MediaStatus } from './video-project.entity';

/**
 * 成片合成历史记录
 *
 * 每次「合成完整视频」成功都会新增一条，而不是覆盖 `video_projects` 上的单值字段，
 * 使"生成结果"页可以按时间顺序回看历次合成产出（不同分镜版本/多次合成的结果都保留）。
 */
@Entity('video_compose_history', { comment: '成片合成历史' })
export class VideoComposeHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'project_id' })
  projectId: string;

  /** 对象键，接口出站再拼公网 URL */
  @Column({ type: 'varchar', length: 500, nullable: true, name: 'video_url' })
  videoUrl: string | null;

  /** 对象键，接口出站再拼公网 URL */
  @Column({ type: 'varchar', length: 500, nullable: true, name: 'cover_url' })
  coverUrl: string | null;

  @Column({ type: 'varchar', length: 20, default: 'success' })
  status: MediaStatus;

  @Column({ type: 'int', nullable: true, name: 'duration_sec' })
  durationSec: number | null;

  @Column({ type: 'int', name: 'shot_count', default: 0 })
  shotCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
