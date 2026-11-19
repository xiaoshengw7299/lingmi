import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { MessageEntity } from './message.entity';

/**
 * AI 会话实体
 */
@Entity('ai_sessions', { comment: 'AI 会话' })
export class SessionEntity {
  /** 会话ID - 由调用方生成并传入 */
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id: string;

  /** 会话标题 - 默认使用用户输入，异步请求大模型生成 */
  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string;

  /** 标题是否已生成 */
  @Column({ type: 'boolean', default: false, name: 'title_generated' })
  titleGenerated: boolean;

  /** 智能体ID - 调用方自定义标识 */
  @Column({ type: 'varchar', length: 100, name: 'agent_id' })
  agentId: string;

  /** 用户ID */
  @Column({ type: 'varchar', length: 100, name: 'user_id' })
  userId: string;

  /** 会话状态: active, archived, deleted */
  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: string;

  /** 使用的模型 */
  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string;

  /** 会话元数据 (JSON) */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  /** 消息数量 */
  @Column({ type: 'int', default: 0, name: 'message_count' })
  messageCount: number;

  /** 最后活跃时间 */
  @Column({ type: 'timestamp', nullable: true, name: 'last_active_at' })
  lastActiveAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => MessageEntity, (message) => message.session)
  messages: MessageEntity[];
}
