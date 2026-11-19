import { randomUUID } from 'crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository, SelectQueryBuilder } from 'typeorm';
import { parsePage } from '../../common/hot-rank';
import { AuthUser, displayName } from '../../common/types/auth-user';
import { StorageService } from '../storage';
import {
  CreateForumCommentDto,
  CreateForumPostDto,
  FORUM_MAX_BYTES,
  FORUM_MAX_FILES,
  ForumAttachmentDto,
  QueryForumDto,
  UpdateForumPostDto,
} from './forum.dto';
import {
  ForumAttachment,
  ForumCommentEntity,
  ForumLikeEntity,
  ForumPostEntity,
  ForumStatus,
} from './forum.entity';

/** 存储用扩展名。只认这份清单，不跟客户端报的文件名走，避免把可执行文件存进来 */
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'application/pdf': 'pdf',
};

@Injectable()
export class ForumService implements OnModuleInit {
  constructor(
    @InjectRepository(ForumPostEntity) private readonly posts: Repository<ForumPostEntity>,
    @InjectRepository(ForumCommentEntity) private readonly comments: Repository<ForumCommentEntity>,
    @InjectRepository(ForumLikeEntity) private readonly likes: Repository<ForumLikeEntity>,
    private readonly storage: StorageService,
    private readonly db: DataSource,
  ) {}

  async onModuleInit() {
    await this.ensureSchema();
  }

  /** 生产环境关闭了 synchronize，启动时把论坛表补上 */
  private async ensureSchema() {
    await this.posts.query(`
      CREATE TABLE IF NOT EXISTS "forum_post" (
        "id" uuid PRIMARY KEY,
        "title" character varying(80) NOT NULL,
        "content" text NOT NULL,
        "visibility" character varying(16) NOT NULL DEFAULT 'public',
        "status" character varying(16) NOT NULL DEFAULT 'open',
        "attachments" jsonb NOT NULL DEFAULT '[]',
        "author_id" integer NOT NULL,
        "author_name" character varying(100) NOT NULL,
        "like_count" integer NOT NULL DEFAULT 0,
        "comment_count" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT NOW(),
        "updated_at" timestamp NOT NULL DEFAULT NOW()
      )
    `);
    await this.posts.query(`CREATE INDEX IF NOT EXISTS "IDX_forum_post_visibility" ON "forum_post" ("visibility")`);
    await this.posts.query(`CREATE INDEX IF NOT EXISTS "IDX_forum_post_author_id" ON "forum_post" ("author_id")`);
    await this.posts.query(`CREATE INDEX IF NOT EXISTS "IDX_forum_post_like_count" ON "forum_post" ("like_count")`);
    await this.posts.query(`
      CREATE TABLE IF NOT EXISTS "forum_comment" (
        "id" uuid PRIMARY KEY,
        "post_id" uuid NOT NULL,
        "content" text NOT NULL,
        "author_id" integer NOT NULL,
        "author_name" character varying(100) NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT NOW()
      )
    `);
    await this.posts.query(`CREATE INDEX IF NOT EXISTS "IDX_forum_comment_post" ON "forum_comment" ("post_id", "created_at")`);
    await this.posts.query(`
      CREATE TABLE IF NOT EXISTS "forum_like" (
        "post_id" uuid NOT NULL,
        "user_id" integer NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT NOW(),
        PRIMARY KEY ("post_id", "user_id")
      )
    `);
  }

  async list(query: QueryForumDto, user?: AuthUser) {
    const { page, pageSize } = parsePage(query.page, query.pageSize);
    const qb = this.posts.createQueryBuilder('p');
    this.whereVisible(qb, user);
    const keyword = query.keyword?.trim();
    if (keyword) {
      const kw = `%${keyword.replace(/[!%_]/g, (ch) => `!${ch}`)}%`;
      qb.andWhere(`(p.title ILIKE :kw ESCAPE '!' OR p.content ILIKE :kw ESCAPE '!')`, { kw });
    }
    const [items, total] = await qb
      .orderBy('p.like_count', 'DESC')
      .addOrderBy('p.created_at', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getManyAndCount();
    const liked = await this.likedIds(user, items.map((item) => item.id));
    return { items: items.map((item) => this.present(item, liked.has(item.id))), total, page, pageSize };
  }

  async get(id: string, user?: AuthUser) {
    const post = await this.findVisible(id, user);
    const comments = await this.comments.find({ where: { postId: id }, order: { createdAt: 'ASC' } });
    const liked = await this.likedIds(user, [id]);
    return { ...this.present(post, liked.has(id)), comments: comments.map((item) => this.presentComment(item)) };
  }

  async shareableVideoAttachments(id: string, user?: AuthUser) {
    const post = await this.findVisible(id, user && { ...user, isAdmin: false });
    return post.attachments.filter((item) => item.mime.startsWith('video/'));
  }

  async upload(user: AuthUser, file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('请选择要上传的文件');
    if (file.size > FORUM_MAX_BYTES) throw new BadRequestException('单个附件不能超过 20MB');
    const ext = MIME_EXT[file.mimetype];
    if (!ext) throw new BadRequestException('仅支持图片、视频、音频和 PDF');
    const key = `ai-user/${this.uid(user)}/forum/${randomUUID()}.${ext}`;
    await this.storage.upload(key, file.buffer, file.mimetype);
    return {
      key,
      name: this.safeName(file.originalname),
      mime: file.mimetype,
      size: file.size,
      url: this.storage.toPublicUrl(key),
    };
  }

  async create(user: AuthUser, dto: CreateForumPostDto) {
    const attachments = await this.bindAttachments(this.uid(user), dto.attachments ?? []);
    const saved = await this.posts.save(
      this.posts.create({
        title: this.plain(dto.title, '标题'),
        content: this.plain(dto.content, '内容'),
        visibility: dto.visibility ?? 'public',
        status: 'open',
        attachments,
        authorId: this.uid(user),
        authorName: this.authorName(user),
        updatedAt: new Date(),
      }),
    );
    return this.present(saved, false);
  }

  async update(id: string, user: AuthUser, dto: UpdateForumPostDto) {
    const post = await this.findVisible(id, user);
    if (post.authorId !== this.uid(user)) throw new ForbiddenException('只能编辑自己的帖子');
    const attachments = await this.bindAttachments(this.uid(user), dto.attachments ?? [], post);
    const removed = post.attachments.filter((item) => !attachments.some((next) => next.key === item.key));
    post.title = this.plain(dto.title, '标题');
    post.content = this.plain(dto.content, '内容');
    post.visibility = dto.visibility ?? 'public';
    post.attachments = attachments;
    post.updatedAt = new Date();
    const saved = await this.posts.save(post);
    await Promise.all(removed.map((item) => this.storage.remove(item.key)));
    const liked = await this.likedIds(user, [id]);
    return this.present(saved, liked.has(id));
  }

  async remove(id: string, user: AuthUser) {
    const post = await this.findVisible(id, user);
    if (post.authorId !== this.uid(user) && !user.isAdmin) throw new ForbiddenException('无权删除这帖');
    await this.db.transaction(async (m) => {
      await m.delete(ForumLikeEntity, { postId: id });
      await m.delete(ForumCommentEntity, { postId: id });
      await m.delete(ForumPostEntity, { id });
    });
    await Promise.all(post.attachments.map((item) => this.storage.remove(item.key)));
  }

  /** 点过就取消。同一帖的并发点赞先锁帖子行，计数不会被点乱 */
  async like(id: string, user: AuthUser) {
    await this.findVisible(id, user);
    const userId = this.uid(user);
    return this.db.transaction(async (m) => {
      const locked = await m.query(`SELECT id FROM forum_post WHERE id = $1 FOR UPDATE`, [id]);
      if (!locked.length) throw new NotFoundException('帖子不存在');
      const removed = await m.query(`DELETE FROM forum_like WHERE post_id = $1 AND user_id = $2 RETURNING 1`, [id, userId]);
      // Postgres 驱动对 DELETE 返回 [行, 影响行数]，不能直接看外层 length
      const deleted = Array.isArray(removed?.[0]) ? removed[0].length : removed.length;
      const liked = deleted === 0;
      if (liked) {
        await m.query(`INSERT INTO forum_like (post_id, user_id, created_at) VALUES ($1, $2, NOW())`, [id, userId]);
        await m.query(`UPDATE forum_post SET like_count = like_count + 1 WHERE id = $1`, [id]);
      } else {
        await m.query(`UPDATE forum_post SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1`, [id]);
      }
      const rows: Array<{ likeCount: number }> = await m.query(
        `SELECT like_count AS "likeCount" FROM forum_post WHERE id = $1`,
        [id],
      );
      return { liked, likeCount: Number(rows[0]?.likeCount ?? 0) };
    });
  }

  async comment(id: string, user: AuthUser, dto: CreateForumCommentDto) {
    await this.findVisible(id, user);
    const content = this.plain(dto.content, '评论');
    return this.db.transaction(async (m) => {
      const saved = await m.getRepository(ForumCommentEntity).save(
        m.getRepository(ForumCommentEntity).create({
          postId: id,
          content,
          authorId: this.uid(user),
          authorName: this.authorName(user),
        }),
      );
      await m.query(`UPDATE forum_post SET comment_count = comment_count + 1 WHERE id = $1`, [id]);
      return this.presentComment(saved);
    });
  }

  async removeComment(postId: string, commentId: string, user: AuthUser) {
    const post = await this.findVisible(postId, user);
    const comment = await this.comments.findOne({ where: { id: commentId, postId } });
    if (!comment) throw new NotFoundException('评论不存在');
    const uid = this.uid(user);
    if (comment.authorId !== uid && post.authorId !== uid && !user.isAdmin) throw new ForbiddenException('无权删除这条评论');
    await this.db.transaction(async (m) => {
      const res = await m.delete(ForumCommentEntity, { id: commentId, postId });
      if (res.affected) {
        await m.query(`UPDATE forum_post SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = $1`, [postId]);
      }
    });
  }

  async setStatus(id: string, status: ForumStatus, user: AuthUser) {
    const post = await this.findVisible(id, user);
    if (post.visibility !== 'admin') throw new BadRequestException('只有「仅管理员」的帖子需要处理状态');
    post.status = status;
    post.updatedAt = new Date();
    const saved = await this.posts.save(post);
    const liked = await this.likedIds(user, [id]);
    return this.present(saved, liked.has(id));
  }

  /** 游客只看公开帖；登录用户再加上自己的反馈；管理员看全部 */
  private whereVisible(qb: SelectQueryBuilder<ForumPostEntity>, user?: AuthUser) {
    if (user?.isAdmin) return;
    if (!user) {
      qb.andWhere('p.visibility = :vis', { vis: 'public' });
      return;
    }
    qb.andWhere('(p.visibility = :vis OR p.author_id = :uid)', { vis: 'public', uid: this.uid(user) });
  }

  private async findVisible(id: string, user?: AuthUser) {
    const post = await this.posts.findOne({ where: { id } });
    if (!post || !this.canSee(post, user)) throw new NotFoundException('帖子不存在');
    return post;
  }

  private canSee(post: ForumPostEntity, user?: AuthUser) {
    if (post.visibility === 'public' || user?.isAdmin) return true;
    return !!user && post.authorId === this.uid(user);
  }

  /** 新附件必须是自己刚传到论坛目录的文件，且不能挂到两帖上 */
  private async bindAttachments(userId: number, incoming: ForumAttachmentDto[], current?: ForumPostEntity) {
    if (incoming.length > FORUM_MAX_FILES) throw new BadRequestException(`最多 ${FORUM_MAX_FILES} 个附件`);
    const kept = new Set((current?.attachments ?? []).map((item) => item.key));
    const ownedKey = new RegExp(
      `^ai-user/${userId}/forum/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:jpg|png|gif|webp|mp4|webm|mov|mp3|wav|m4a|aac|ogg|pdf)$`,
    );
    const seen = new Set<string>();
    const next: ForumAttachment[] = incoming.map((item) => {
      const key = item.key.trim();
      if (!key || seen.has(key)) throw new BadRequestException('附件无效');
      seen.add(key);
      if (!kept.has(key) && !ownedKey.test(key)) throw new BadRequestException('只能使用自己上传的附件');
      if (!MIME_EXT[item.mime]) throw new BadRequestException('附件类型不支持');
      return { key, name: this.safeName(item.name), mime: item.mime, size: item.size };
    });
    const fresh = next.filter((item) => !kept.has(item.key)).map((item) => item.key);
    if (fresh.length) {
      const rows: Array<{ id: string }> = await this.posts.query(
        `SELECT id FROM forum_post p
         WHERE ($2::uuid IS NULL OR p.id <> $2::uuid)
           AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(p.attachments) a
             WHERE a->>'key' = ANY($1)
           )
         LIMIT 1`,
        [fresh, current?.id ?? null],
      );
      if (rows.length) throw new BadRequestException('附件已被其他帖子使用');
    }
    return next;
  }

  private async likedIds(user: AuthUser | undefined, ids: string[]) {
    if (!user || !ids.length) return new Set<string>();
    const rows = await this.likes.find({
      where: { userId: this.uid(user), postId: In(ids) },
      select: { postId: true, userId: true },
    });
    return new Set(rows.map((row) => row.postId));
  }

  private present(post: ForumPostEntity, liked: boolean) {
    const { attachments, ...rest } = post;
    return {
      ...rest,
      liked,
      attachments: attachments.map((item) => ({ ...item, url: this.storage.toPublicUrl(item.key) })),
    };
  }

  private presentComment(comment: ForumCommentEntity) {
    return comment;
  }

  private plain(value: string, label: string) {
    const text = value.trim();
    if (!text) throw new BadRequestException(`请填写${label}`);
    return text;
  }

  private authorName(user: AuthUser) {
    return displayName(user).slice(0, 100);
  }

  private uid(user: AuthUser) {
    return Number(user.userId);
  }

  private safeName(name: string) {
    const raw = (name || '附件').replace(/\\/g, '/').split('/').pop() ?? '';
    const base = [...raw].filter((ch) => ch.charCodeAt(0) >= 32).join('').trim();
    return (base || '附件').slice(0, 80);
  }
}
