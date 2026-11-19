import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { VideoProjectEntity, MediaStatus, LoraSelection } from './video-project.entity';
import { VideoTakeEntity } from './video-take.entity';

/**
 * 分镜（Shot）
 *
 * 一个分镜 = 一段独立生成的视频，最终按 index 顺序由 FFmpeg 拼接成完整视频。
 * 人物/场景一致性通过 videoPrompt 中的 `@名称` 引用素材图。
 * 一条 4–15 秒视频的提示词内可用 [Shot N] 切换场景，不必拆成多个工作台分镜。
 */
@Entity('video_shots', { comment: '视频分镜' })
export class ShotEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 类型必须与 VideoProjectEntity.id（uuid 主键）一致 —— 该列同时被 @JoinColumn 关联复用，
  // varchar+length 与关联推断出的 uuid 类型冲突会导致 TypeORM 元数据校验失败
  @Column({ type: 'uuid', name: 'project_id' })
  projectId: string;

  /** 分镜顺序（0-based），决定最终合成时的拼接顺序 */
  @Column({ type: 'int' })
  index: number;

  /** 稳定名称：重排时不随 index 改变，供 @分镜名 引用 */
  @Column({ type: 'varchar', length: 100, default: '' })
  name: string;

  /**
   * 视频提示词：镜头运动/人物动作/台词旁白/背景音等；
   * 文本中通过 `@角色名`/`@场景名`/`@本地图名` 引用参考图
   */
  @Column({ type: 'text', name: 'video_prompt' })
  videoPrompt: string;

  /** 目标时长（秒），按所选模型上下限钳制，缺省 15 */
  @Column({ type: 'int', default: 15, name: 'duration_sec' })
  durationSec: number;

  /** 画面比例，如 16:9；为空时生成时回退为所选模型的 defaultRatio */
  @Column({ type: 'varchar', length: 20, nullable: true })
  ratio: string | null;

  /** 清晰度档位，如 2K / 720p；为空时生成时回退为所选模型官方默认 */
  @Column({ type: 'varchar', length: 20, nullable: true })
  resolution: string | null;

  /** 视频生成模型 id（config/atlas-models.json 中的 id）；为空时使用当前默认视频模型 */
  @Column({ type: 'varchar', length: 100, nullable: true, name: 'model_id' })
  modelId: string | null;

  /** 挂载的 LoRA；仅所选模型 supportsLora=true 时生效 */
  @Column({ type: 'jsonb', nullable: true })
  lora: LoraSelection | null;

  /** 对象键，接口出站再拼公网 URL */
  @Column({ type: 'varchar', length: 500, nullable: true, name: 'video_url' })
  videoUrl: string | null;

  @Column({ type: 'varchar', length: 20, default: 'idle', name: 'video_status' })
  videoStatus: MediaStatus;

  @Column({ type: 'text', nullable: true, name: 'video_error' })
  videoError: string | null;

  /** 上游返回的生成进度（0–1）；仅 Provider 真正上报时才有值 */
  @Column({ type: 'real', nullable: true, name: 'video_progress' })
  videoProgress: number | null;

  /** Atlas 异步视频生成任务 id，用于 BullMQ 延时轮询状态 */
  @Column({ type: 'varchar', length: 100, nullable: true, name: 'video_task_id' })
  videoTaskId: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'active_take_id' })
  activeTakeId: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'archived_at' })
  archivedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // 单向关联：VideoProjectEntity 不声明反向的 @OneToMany（见其 shots 字段注释），
  // 避免 save() 项目实体时 TypeORM 把手动挂载的分镜数组当成关联变更、误清空这里的外键。
  @ManyToOne(() => VideoProjectEntity)
  @JoinColumn({ name: 'project_id' })
  project: VideoProjectEntity;

  @OneToMany(() => VideoTakeEntity, (take) => take.shot)
  takes: VideoTakeEntity[];
}
