import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ShortVideoSettings } from '../short-video.options';
import type { ShortVideoBilling } from '../short-video-pricing.service';

export type ShortVideoTaskStatus = 'queued' | 'generating' | 'success' | 'failed';

export interface ShortVideoMaterial {
  file: string;
  name: string;
  size: number;
}

@Entity('short_video_tasks', { comment: '短视频生成任务' })
@Index('idx_short_video_user_created', ['userId', 'createdAt'])
@Index('idx_short_video_user_status', ['userId', 'status'])
@Index('idx_short_video_user_request', ['userId', 'requestId'], { unique: true })
export class ShortVideoTaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, name: 'user_id' })
  userId: string;

  @Column({ type: 'uuid', nullable: true, name: 'request_id' })
  requestId: string | null;

  /** 受理时确定的计费方式。历史记录为空时仍按用量计费。 */
  @Column({ type: 'jsonb', nullable: true })
  billing: ShortVideoBilling | null;

  @Column({ type: 'varchar', length: 200 })
  subject: string;

  /** 用户填写的旁白；空则由自研流水线按主题 AI 生成（见 ShortVideoService.runPipeline） */
  @Column({ type: 'text', default: '' })
  script: string;

  /** 流水线回写的最终文案（便于回看） */
  @Column({ type: 'text', nullable: true, name: 'generated_script' })
  generatedScript: string | null;

  @Column({ type: 'varchar', length: 16, default: '9:16' })
  aspect: string;

  @Column({ type: 'varchar', length: 80, name: 'voice_name' })
  voiceName: string;

  /** random | custom | none */
  @Column({ type: 'varchar', length: 16, name: 'bgm_type', default: 'random' })
  bgmType: string;

  /** pexels（免费素材）| local（本地上传）| ai（模型平台API 生图 + 缓慢推镜） */
  @Column({ type: 'varchar', length: 16, name: 'video_source', default: 'pexels' })
  videoSource: string;

  @Column({ type: 'jsonb', nullable: true })
  materials: ShortVideoMaterial[] | null;

  /** 生成参数快照（语速、转场、片段时长等） */
  @Column({ type: 'jsonb', nullable: true })
  settings: ShortVideoSettings | null;

  /** 多版本成片对象键，第一条同时写入 video_object_key */
  @Column({ type: 'jsonb', nullable: true, name: 'video_object_keys' })
  videoObjectKeys: string[] | null;

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  status: ShortVideoTaskStatus;

  @Column({ type: 'int', default: 0 })
  progress: number;

  @Column({ type: 'varchar', length: 40, default: '排队中' })
  stage: string;

  /** 对象键，出站再拼公网 URL */
  @Column({ type: 'varchar', length: 500, nullable: true, name: 'video_object_key' })
  videoObjectKey: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
