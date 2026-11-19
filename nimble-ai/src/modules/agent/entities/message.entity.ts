import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SessionEntity } from './session.entity';
import { ContentBlock } from '../content-block/content-block.interface';

/** 消息角色类型 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * AI 消息实体
 *
 * 每条记录代表一轮对话：
 *   input  → 用户提问
 *   blocks → 助手响应（结构化内容块，唯一数据源）
 */
@Entity('ai_messages', { comment: 'AI 会话消息' })
export class MessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 关联的会话ID */
  @Column({ type: 'varchar', length: 100, name: 'session_id' })
  sessionId: string;

  /** 消息角色 */
  @Column({ type: 'varchar', length: 20 })
  role: MessageRole;

  /** 用户的问题/输入 */
  @Column({ type: 'text', nullable: true })
  input: string;

  /** 用户附件文件信息（独立存储，刷新后可恢复） */
  @Column({ type: 'jsonb', nullable: true })
  files: Array<{
    filename: string;
    storedName: string;
    path: string;
    size?: number;
    mimetype?: string;
  }>;

  /** 结构化内容块（唯一响应数据源，支持回放） */
  @Column({ type: 'jsonb', nullable: true })
  blocks: ContentBlock[];

  /** 使用的模型 */
  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string;

  /** Token 使用统计 */
  @Column({ type: 'jsonb', nullable: true, name: 'token_usage' })
  tokenUsage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };

  /** 响应耗时(毫秒) */
  @Column({ type: 'int', nullable: true, name: 'latency_ms' })
  latencyMs: number;

  /** 用户反馈：like=喜欢, dislike=不喜欢, null=未反馈 */
  @Column({ type: 'varchar', length: 20, nullable: true })
  feedback: 'like' | 'dislike' | null;

  /** 消息元数据 */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => SessionEntity, (session) => session.messages)
  @JoinColumn({ name: 'session_id' })
  session: SessionEntity;
}
