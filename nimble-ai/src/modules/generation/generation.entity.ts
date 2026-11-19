import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type GenerationKind = 'image' | 'video' | 'audio' | 'text';
export type GenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/** 一次生成请求的参数快照（与 GenerateDto 一致，落库便于排查与重试） */
export interface GenerationParams {
  prompt: string;
  modelId?: string;
  ratio?: string;
  resolution?: string;
  outputFormat?: string;
  promptOptimizeMode?: string;
  lora?: { name: string; weight: number } | null;
  durationSec?: number;
  generateAudio?: boolean;
  refImages?: string[];
  refVideos?: string[];
  refAudios?: string[];
  voice?: string;
}

/**
 * 通用生成任务：无限画布、提示词库共用同一个生成入口。
 * 图片 / 视频 / 音频的结果落在对象存储（resultKey），文本结果直接存 resultText。
 */
@Entity('generation_tasks', { comment: '通用生成任务' })
export class GenerationTaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 100, name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 20 })
  kind: GenerationKind;

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  status: GenerationStatus;

  @Column({ type: 'jsonb' })
  params: GenerationParams;

  /** 对象键，接口出站再拼公网 URL */
  @Column({ type: 'varchar', length: 500, nullable: true, name: 'result_key' })
  resultKey: string | null;

  /** 图片/视频结果的缩略图对象键 */
  @Column({ type: 'varchar', length: 500, nullable: true, name: 'thumb_key' })
  thumbKey: string | null;

  @Column({ type: 'text', nullable: true, name: 'result_text' })
  resultText: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'model_name' })
  modelName: string | null;

  /** Atlas prediction id。图片回调晚到或进程重启后靠它把结果写回来 */
  @Index()
  @Column({ type: 'varchar', length: 128, nullable: true, name: 'prediction_id' })
  predictionId: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
