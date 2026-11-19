import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StorageService } from '../storage';
import { CanvasDoc, CanvasProjectEntity } from './canvas.entity';
import { CanvasExampleEntity } from './canvas-example.entity';
import { SaveCanvasDto } from './canvas.dto';

const EMPTY_DOC: CanvasDoc = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };

@Injectable()
export class CanvasService {
  constructor(
    @InjectRepository(CanvasProjectEntity) private readonly repo: Repository<CanvasProjectEntity>,
    @InjectRepository(CanvasExampleEntity) private readonly examples: Repository<CanvasExampleEntity>,
    private readonly storage: StorageService,
  ) {}

  /** 列表不带文档正文，几百个节点的画布也不会拖慢列表 */
  list(userId: string) {
    return this.repo.find({
      where: { userId },
      select: { id: true, title: true, coverUrl: true, updatedAt: true, version: true },
      order: { updatedAt: 'DESC' },
    });
  }

  create(userId: string, input: { title?: string; doc?: CanvasDoc }) {
    const doc = input.doc ?? EMPTY_DOC;
    return this.repo.save(
      this.repo.create({ userId, title: input.title?.trim() || '未命名画布', doc, coverUrl: this.coverOf(doc) }),
    );
  }

  async get(userId: string, id: string) {
    const project = await this.repo.findOne({ where: { id, userId } });
    if (!project) throw new NotFoundException('画布不存在');
    const example = await this.examples.findOne({ where: { sourceCanvasId: id }, select: { id: true } });
    return Object.assign(project, { exampleId: example?.id ?? null });
  }

  /** 带版本号保存：基于旧版本的写入会被拒绝，前端据此提示"已在别处修改，请刷新" */
  async save(userId: string, id: string, dto: SaveCanvasDto) {
    const project = await this.get(userId, id);
    if (project.version !== dto.baseVersion) throw new ConflictException('画布已在其他窗口修改，请刷新后再编辑');
    if (dto.title !== undefined) project.title = dto.title.trim() || project.title;
    const removedMedia = dto.doc ? this.droppedMedia(userId, project, dto.doc) : [];
    if (dto.doc) {
      project.doc = dto.doc;
      project.coverUrl = this.coverOf(dto.doc);
    }
    project.version += 1;
    const saved = await this.repo.save(project);
    await this.removeOwnedMedia(removedMedia);
    return { version: saved.version, updatedAt: saved.updatedAt };
  }

  async remove(userId: string, id: string): Promise<void> {
    const project = await this.get(userId, id);
    const media = this.ownedMedia(userId, project.doc, project.coverUrl);
    await this.repo.delete(project.id);
    await this.removeOwnedMedia(media);
  }

  private coverOf(doc: CanvasDoc): string | null {
    const image = doc.nodes.find((node) => node.type === 'image' && typeof node.url === 'string' && node.url);
    return (image?.url as string | undefined)?.slice(0, 500) ?? null;
  }

  /** 这次保存从画布上拿掉的、属于该用户上传或生成结果的文件 */
  private droppedMedia(userId: string, project: CanvasProjectEntity, doc: CanvasDoc): string[] {
    const next = new Set(this.ownedMedia(userId, doc, this.coverOf(doc)));
    return this.ownedMedia(userId, project.doc, project.coverUrl).filter((key) => !next.has(key));
  }

  private ownedMedia(userId: string, doc: CanvasDoc | null | undefined, cover?: string | null): string[] {
    const values: string[] = [];
    for (const node of doc?.nodes ?? []) {
      if (typeof node.url === 'string') values.push(node.url);
      if (typeof node.thumb === 'string') values.push(node.thumb);
    }
    if (cover) values.push(cover);
    const keys = new Set<string>();
    for (const value of values) {
      const key = this.storage.toObjectName(value);
      if (
        key.startsWith(`ai-user/${userId}/up/`)
        || key.startsWith(`ai-user/${userId}/gen/`)
        || key.startsWith(`ai-user/${userId}/thumb/`)
      ) {
        keys.add(key);
      }
    }
    return [...keys];
  }

  /** 别的画布、分享作品、资产、提示词或帖子还在用的文件不删 */
  private async removeOwnedMedia(keys: string[]): Promise<void> {
    for (const key of keys) {
      const rows = await this.repo.manager.query(
        `SELECT (
          EXISTS (SELECT 1 FROM canvas_projects WHERE position($1 in doc::text) > 0 OR position($1 in coalesce(cover_url, '')) > 0)
          OR EXISTS (SELECT 1 FROM canvas_examples WHERE position($1 in doc::text) > 0 OR position($1 in coalesce(cover_url, '')) > 0)
          OR EXISTS (SELECT 1 FROM user_assets WHERE object_key = $1)
          OR EXISTS (SELECT 1 FROM prompts WHERE media_key = $1 OR position($1 in references::text) > 0)
          OR EXISTS (SELECT 1 FROM forum_post WHERE position($1 in attachments::text) > 0)
        ) AS used`,
        [key],
      );
      if (rows[0]?.used === true || rows[0]?.used === 't') continue;
      await this.storage.remove(key);
    }
  }
}
