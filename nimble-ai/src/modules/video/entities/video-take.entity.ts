import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { MediaStatus, LoraSelection } from './video-project.entity';
import { ShotEntity } from './shot.entity';

export interface VideoQcReport {
  result: 'passed' | 'warning' | 'failed';
  summary?: string;
  issues?: string[];
  durationSec?: number;
  width?: number;
  height?: number;
}

@Entity('video_takes', { comment: '分镜视频版本' })
@Unique(['shotId', 'version'])
export class VideoTakeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'shot_id' })
  shotId: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'varchar', length: 20, default: 'idle' })
  status: MediaStatus;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'task_id' })
  taskId: string | null;

  /** 对象键，接口出站再拼公网 URL */
  @Column({ type: 'varchar', length: 500, nullable: true, name: 'video_url' })
  videoUrl: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** 上游返回的生成进度（0–1）；仅 Provider 真正上报时才有值 */
  @Column({ type: 'real', nullable: true })
  progress: number | null;

  @Column({ type: 'text', name: 'prompt_snapshot' })
  promptSnapshot: string;

  /** 生成该版本时使用的模型 id 快照（分镜的模型选择之后可能变化，这里固定记录当时实际使用的模型） */
  @Column({ type: 'varchar', length: 100, nullable: true, name: 'model_id' })
  modelId: string | null;

  /** 生成该版本时挂载的 LoRA 快照 */
  @Column({ type: 'jsonb', nullable: true })
  lora: LoraSelection | null;

  @Column({ type: 'text', nullable: true, name: 'effective_prompt' })
  effectivePrompt: string | null;

  @Column({ type: 'varchar', length: 20, name: 'generation_mode', default: 'parallel' })
  generationMode: 'continuous' | 'parallel';

  @Column({ type: 'int', name: 'duration_sec' })
  durationSec: number;

  /** 生成该版本时使用的画面比例快照 */
  @Column({ type: 'varchar', length: 20, nullable: true })
  ratio: string | null;

  /** 生成该版本时使用的清晰度快照 */
  @Column({ type: 'varchar', length: 20, nullable: true })
  resolution: string | null;

  /** 生成时引用的参考图对象键 */
  @Column({ type: 'jsonb', default: [], name: 'reference_images' })
  referenceImages: string[];

  /** 生成时引用的参考视频对象键（上传素材或已生成的分镜视频） */
  @Column({ type: 'jsonb', default: [], name: 'reference_videos' })
  referenceVideos: string[];

  /** 生成时引用的参考音频对象键 */
  @Column({ type: 'jsonb', default: [], name: 'reference_audios' })
  referenceAudios: string[];

  @Column({ type: 'jsonb', nullable: true, name: 'qc_report' })
  qcReport: VideoQcReport | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => ShotEntity, (shot) => shot.takes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shot_id' })
  shot: ShotEntity;
}
