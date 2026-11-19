import { randomUUID } from 'crypto';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { applyRank, hotScoreSql, parsePage, RankSort } from '../../common/hot-rank';
import { extOf } from '../../common/media';
import { AuthUser, displayName } from '../../common/types/auth-user';
import { EngagementService } from '../engagement/engagement.service';
import { StorageService } from '../storage';
import { CanvasDoc, CanvasProjectEntity } from './canvas.entity';
import { CanvasExampleEntity } from './canvas-example.entity';
import { CanvasService } from './canvas.service';

/** 画布节点里引用媒体的字段 */
const MEDIA_FIELDS = ['url', 'thumb'] as const;
/** 别人分享出来的作品文件，以及工作台转来的项目素材：都是匿名可读的公开文件，任何人的画布都可以引用 */
const isPublicMedia = (key: string) => key.startsWith('ai-video/') || /^ai-user\/[^/]+\/share\//.test(key);

@Injectable()
export class CanvasExampleService {
  constructor(
    @InjectRepository(CanvasExampleEntity) private readonly repo: Repository<CanvasExampleEntity>,
    @InjectRepository(CanvasProjectEntity) private readonly canvasRepo: Repository<CanvasProjectEntity>,
    private readonly storage: StorageService,
    private readonly engagement: EngagementService,
    private readonly canvases: CanvasService,
  ) {}

  /** 列表不带画布正文；hot 一并返回，前端把工作台案例和画布作品按同一把尺子混排 */
  async list(query: { page?: string; pageSize?: string; sort?: RankSort }) {
    const { page, pageSize } = parsePage(query.page, query.pageSize);
    const total = await this.repo.count();
    const qb = this.repo
      .createQueryBuilder('e')
      .select(['e.id', 'e.title', 'e.coverUrl', 'e.createdBy', 'e.createdByName', 'e.viewCount', 'e.copyCount', 'e.createdAt'])
      .addSelect(hotScoreSql('e'), 'hot')
      .addSelect("jsonb_array_length(e.doc->'nodes')", 'node_count');
    const { entities, raw } = await applyRank(qb, 'e', query.sort, page, pageSize).getRawAndEntities();
    const items = entities.map((e, i) => ({
      ...e,
      coverUrl: e.coverUrl ? this.storage.toPublicUrl(e.coverUrl) : null,
      hot: Number(raw[i].hot),
      nodeCount: Number(raw[i].node_count),
    }));
    return { items, total, page, pageSize };
  }

  async get(id: string) {
    const example = await this.find(id);
    return { ...example, coverUrl: example.coverUrl ? this.storage.toPublicUrl(example.coverUrl) : null };
  }

  viewed(id: string, viewer: string) {
    return this.engagement.record(this.repo, 'canvas-example', id, viewer, 'view');
  }

  /** 分享画布：同一块画布只对应一个作品，再次分享就覆盖成最新内容 */
  async publish(user: AuthUser, canvasId: string, title?: string) {
    const userId = String(user.userId);
    const canvas = await this.canvasRepo.findOne({ where: { id: canvasId, userId } });
    if (!canvas) throw new NotFoundException('画布不存在');
    const existing = await this.repo.findOne({ where: { sourceCanvasId: canvasId } });
    const id = existing?.id ?? randomUUID();
    const prefix = `ai-user/${userId}/share/${id}/`;
    if (existing) await this.storage.removePrefix(prefix);
    const doc = await this.cloneMedia(canvas.doc, (i, key) => `${prefix}${i}.${extOf(key, 'bin')}`, (key) => key.startsWith(`ai-user/${userId}/`) || isPublicMedia(key));
    const cover = doc.nodes.find((n) => n.type === 'image' && (n.thumb || n.url));
    const saved = await this.repo.save(
      this.repo.create({
        ...existing,
        id,
        title: title?.trim() || canvas.title,
        coverUrl: ((cover?.thumb || cover?.url) as string | undefined) ?? null,
        doc,
        sourceCanvasId: canvasId,
        createdBy: userId,
        createdByName: displayName(user),
      }),
    );
    return { id: saved.id };
  }

  /** 复制成自己的画布：媒体文件也复制到自己名下，之后作者删除作品不受影响，也能被引入工作台 */
  async use(user: AuthUser, id: string) {
    const example = await this.find(id);
    const userId = String(user.userId);
    const doc = await this.cloneMedia(example.doc, (_i, key) => `ai-user/${userId}/up/${randomUUID()}.${extOf(key, 'bin')}`, isPublicMedia);
    const canvas = await this.canvases.create(userId, { title: example.title, doc });
    await this.engagement.record(this.repo, 'canvas-example', id, userId, 'copy');
    return canvas;
  }

  async remove(user: AuthUser, id: string) {
    const example = await this.find(id);
    if (example.createdBy !== String(user.userId) && !user.isAdmin) throw new ForbiddenException('无权删除他人分享的作品');
    await this.repo.delete(id);
    await this.storage.removePrefix(`ai-user/${example.createdBy}/share/${id}/`);
  }

  private async find(id: string) {
    const example = await this.repo.findOne({ where: { id } });
    if (!example) throw new NotFoundException('作品不存在');
    return example;
  }

  /**
   * 复制画布里的全部媒体到新位置并改写地址。每个文件只复制一次；
   * 不在允许范围内的内部文件直接去掉（防止借分享接口读取别处文件），外部链接原样保留。
   */
  private async cloneMedia(
    doc: CanvasDoc,
    destFor: (index: number, key: string) => string,
    allowed: (key: string) => boolean,
  ): Promise<CanvasDoc> {
    const urls = new Set<string>();
    for (const node of doc.nodes) for (const f of MEDIA_FIELDS) if (typeof node[f] === 'string') urls.add(node[f] as string);
    const mapped = new Map<string, string | undefined>();
    await Promise.all(
      [...urls].map(async (url, i) => {
        const key = this.storage.toObjectName(url);
        if (/^https?:\/\//i.test(key)) return void mapped.set(url, url);
        if (!allowed(key)) return void mapped.set(url, undefined);
        mapped.set(url, this.storage.toPublicUrl(await this.storage.copyObject(key, destFor(i, key))));
      }),
    );
    const nodes = doc.nodes.map((node) => {
      const next = { ...node };
      for (const f of MEDIA_FIELDS) if (typeof node[f] === 'string') next[f] = mapped.get(node[f] as string);
      return next;
    });
    return { ...doc, nodes };
  }
}
