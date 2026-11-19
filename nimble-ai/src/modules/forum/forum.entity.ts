import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

/** 公开：所有人可见。admin：仅作者和管理员可见，用来反馈问题 */
export type ForumVisibility = 'public' | 'admin';

/** 仅「仅管理员」帖使用：待处理 / 已处理 */
export type ForumStatus = 'open' | 'resolved';

export interface ForumAttachment {
  /** 对象键，形如 ai-user/{userId}/forum/{uuid}.ext */
  key: string;
  name: string;
  mime: string;
  size: number;
}

/** 论坛帖子。列表按 like_count 排序，不另做筛选维度 */
@Entity('forum_post', { comment: '论坛与反馈' })
export class ForumPostEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 80 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Index('IDX_forum_post_visibility')
  @Column({ type: 'varchar', length: 16, default: 'public' })
  visibility: ForumVisibility;

  @Column({ type: 'varchar', length: 16, default: 'open' })
  status: ForumStatus;

  @Column({ type: 'jsonb', default: [] })
  attachments: ForumAttachment[];

  @Index('IDX_forum_post_author_id')
  @Column({ name: 'author_id', type: 'int' })
  authorId: number;

  @Column({ name: 'author_name', type: 'varchar', length: 100 })
  authorName: string;

  @Index('IDX_forum_post_like_count')
  @Column({ name: 'like_count', type: 'int', default: 0 })
  likeCount: number;

  @Column({ name: 'comment_count', type: 'int', default: 0 })
  commentCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamp', default: () => 'NOW()' })
  updatedAt: Date;
}

@Entity('forum_comment', { comment: '论坛评论' })
@Index('IDX_forum_comment_post', ['postId', 'createdAt'])
export class ForumCommentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'post_id', type: 'uuid' })
  postId: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'author_id', type: 'int' })
  authorId: number;

  @Column({ name: 'author_name', type: 'varchar', length: 100 })
  authorName: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

/** 一人一帖只能赞一次，再点即取消。帖子上的 like_count 由此表维护，供列表排序 */
@Entity('forum_like', { comment: '论坛点赞' })
export class ForumLikeEntity {
  @PrimaryColumn({ name: 'post_id', type: 'uuid' })
  postId: string;

  @PrimaryColumn({ name: 'user_id', type: 'int' })
  userId: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
