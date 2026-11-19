import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ShotEntity } from './shot.entity';
import { VideoComposeHistoryEntity } from './video-compose-history.entity';
import { LoraSelection } from '../../atlas/atlas.types';

export type MediaStatus = 'idle' | 'queued' | 'generating' | 'success' | 'failed';
export type GenerationMode = 'continuous' | 'parallel';
export type AssetSource = 'generated' | 'uploaded';
/** 素材类型：图片、文本可生成可手写；视频与音频目前只支持上传 */
export type AssetKind = 'image' | 'video' | 'audio' | 'text';
/** 会落成文件的素材。文本只有正文，不走上传校验 */
export type FileAssetKind = Exclude<AssetKind, 'text'>;

/** LoraSelection 的规范定义已迁到 atlas.types.ts（模型配置的一部分），这里保留 re-export 避免改动一堆既有 import */
export type { LoraSelection };

/**
 * 素材库条目（角色定妆图 / 场景环境图 / 参考视频 / 参考音频共用结构）
 *
 * 语义一致：一次准备好、供多个分镜通过 `@名称` 引用复用，
 * 生成分镜视频时按 kind 分别落到上游的 reference_image / reference_video / reference_audio。
 */
export interface MediaAsset {
  id: string;
  name: string;
  kind: AssetKind;
  source: AssetSource;
  /** 特征提示词。图片素材用于生成参考图；文本素材是让 AI 写正文的要求；视频/音频仅作备注 */
  prompt: string;
  /** 文本素材的正文（手写或 AI 生成）。分镜里 @名称 会把这段拼进提示词 */
  text?: string;
  /** 对象键（ai-video/...），接口出站再拼公网 URL */
  url?: string;
  status: MediaStatus;
  error?: string;
  /** 每次重新生成 +1，前端据此识别新任务，避免成功态挡住重新排队 */
  epoch?: number;
  /** 视频/音频素材时长（秒），上传时探测，用于参考素材的时长上限校验 */
  durationSec?: number;
  /** 生成该素材使用的图片模型 id（config/atlas-models.json 中的 id）；为空时使用当前默认图片模型 */
  modelId?: string;
  /** 挂载的 LoRA；仅 modelId 对应模型 supportsLora=true 时生效 */
  lora?: LoraSelection | null;
  /** 画面比例，如 9:16；为空时生成时回退为所选图片模型默认比例 */
  ratio?: string;
  /** 清晰度档位，如 2K；为空时回退为所选模型官方默认 */
  resolution?: string;
  /** 输出格式 jpeg/png；仅支持该参数的模型生效 */
  outputFormat?: string;
  /** 提示词优化 standard/fast；仅支持该参数的模型生效 */
  promptOptimizeMode?: string;
  /** 当前这次 Atlas 任务 id。回调和对账靠它把迟到的成功结果写回来 */
  predictionId?: string;
  /** 本次提交时间（毫秒），便于排查。本地到点不退款。 */
  predictionStartedAt?: number;
}

export type ProjectStatus = 'draft' | 'composing' | 'done' | 'failed';

/**
 * AI 视频制作项目
 *
 * 一个项目 = 一次"文字需求 → 分镜脚本 → 图片 → 视频 → 合成"全流程，
 * 与对话 session 绑定（由 generate_storyboard 工具在对话中创建）。
 */
@Entity('video_projects', { comment: 'AI 视频制作项目' })
export class VideoProjectEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, name: 'session_id' })
  sessionId: string;

  @Column({ type: 'varchar', length: 100, name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  /** 用户原始文字需求（生成分镜脚本时的输入） */
  @Column({ type: 'text' })
  requirement: string;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: ProjectStatus;

  @Column({ type: 'varchar', length: 20, default: 'continuous', name: 'generation_mode' })
  generationMode: GenerationMode;

  /** 统一素材库（图片 / 视频 / 音频）。 */
  @Column({ type: 'jsonb', default: [] })
  assets: MediaAsset[];

  /** 对象键，接口出站再拼公网 URL */
  @Column({ type: 'varchar', length: 500, nullable: true, name: 'final_video_url' })
  finalVideoUrl: string | null;

  /** 最新一次合成的封面截图对象键（FFmpeg 截首帧），供"生成示例"取用 */
  @Column({ type: 'varchar', length: 500, nullable: true, name: 'final_video_cover_url' })
  finalVideoCoverUrl: string | null;

  @Column({ type: 'varchar', length: 20, default: 'idle', name: 'final_video_status' })
  finalVideoStatus: MediaStatus;

  @Column({ type: 'text', nullable: true, name: 'final_video_error' })
  finalVideoError: string | null;

  /** 合成任务版本令牌，防止过期 Worker 覆盖较新的时间线状态 */
  @Column({ type: 'uuid', nullable: true, name: 'compose_token' })
  composeToken: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /**
   * 分镜列表。
   *
   * 有意不用 `@OneToMany` 声明为 TypeORM 关联：分镜的增删改查全部走 `ShotEntity` 自己的仓库
   * （见 `VideoService.persistShots` 等），此字段只是 `getProject()` 单独查询后临时挂载、
   * 供业务逻辑读取的普通字段。若声明成真正的关联，任何一次 `projectRepo.save(project)`
   * 都会被 TypeORM 当作关联变更来处理，可能把分镜的 `project_id` 误置空（历史上已踩过两次坑）。
   */
  shots: ShotEntity[];

  /** 合成历史（按时间倒序），由 VideoService.getProject 单独查询填充，非 TypeORM 关联字段 */
  composeHistory?: VideoComposeHistoryEntity[];

  /** 该项目已生成的示例 id（若有），由 VideoService.getProject 单独查询填充，非 TypeORM 关联字段 */
  exampleId?: string | null;
}
