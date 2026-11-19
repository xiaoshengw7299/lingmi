import { randomUUID } from 'crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { applyRank, parsePage } from '../../common/hot-rank';
import { extOf } from '../../common/media';
import { AuthUser, displayName } from '../../common/types/auth-user';
import { EngagementService } from '../engagement/engagement.service';
import { GenerationService } from '../generation/generation.service';
import { StorageService } from '../storage';
import { CreatePromptDto, QueryPromptDto } from './prompt.dto';
import { PromptEntity } from './prompt.entity';

@Injectable()
export class PromptService {
  constructor(
    @InjectRepository(PromptEntity) private readonly repo: Repository<PromptEntity>,
    private readonly storage: StorageService,
    private readonly generation: GenerationService,
    private readonly engagement: EngagementService,
  ) {}

  async list(query: QueryPromptDto) {
    const { page, pageSize } = parsePage(query.page, query.pageSize);
    const qb = this.repo.createQueryBuilder('p');
    if (query.type) qb.andWhere('p.type = :type', { type: query.type });
    if (query.keyword?.trim()) {
      qb.andWhere('(p.title ILIKE :kw OR p.content ILIKE :kw)', { kw: `%${query.keyword.trim()}%` });
    }
    const total = await qb.getCount();
    const items = await applyRank(qb, 'p', query.sort, page, pageSize).getMany();
    return { items: items.map((item) => this.present(item)), total, page, pageSize };
  }

  async get(id: string) {
    return this.present(await this.find(id));
  }

  /** 发布：必须带一个已成功的生成任务，示例成品复制成提示词自己的文件，不受源任务影响 */
  async create(user: AuthUser, dto: CreatePromptDto) {
    const userId = String(user.userId);
    const task = await this.generation.getSucceeded(userId, dto.taskId);
    if (task.kind !== dto.type) throw new BadRequestException('示例类型与提示词类型不一致');
    const id = randomUUID();
    const ext = task.resultKey!.split('.').pop() ?? (dto.type === 'video' ? 'mp4' : 'png');
    const mediaKey = await this.storage.copyObject(task.resultKey!, `ai-user/${userId}/prompt/${id}.${ext}`);
    const references = await this.storeReferences(userId, id, dto.references ?? []);
    const saved = await this.repo.save(
      this.repo.create({
        id,
        title: dto.title.trim(),
        content: dto.content.trim(),
        type: dto.type,
        modelId: dto.modelId ?? task.params.modelId ?? null,
        modelName: task.modelName,
        params: dto.params ?? null,
        references,
        mediaKey,
        createdBy: userId,
        createdByName: displayName(user),
      }),
    );
    return this.present(saved);
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    const prompt = await this.find(id);
    if (prompt.createdBy !== String(user.userId) && !user.isAdmin) throw new ForbiddenException('无权删除他人发布的提示词');
    await this.repo.delete(id);
    await this.storage.remove(prompt.mediaKey);
    await this.storage.removePrefix(`ai-user/${prompt.createdBy}/prompt/${id}/`);
  }

  /**
   * 「使用」这条提示词：把参考素材复制成使用者自己的文件并返回，
   * 前端据此在画布或工作台里搭好同样的参考 + 提示词，使用者之后删改都不影响原作者。
   */
  async use(id: string, user: AuthUser) {
    const prompt = await this.find(id);
    const userId = String(user.userId);
    const references = await Promise.all(
      prompt.references.map(async (ref) => {
        const key = await this.storage.copyObject(ref.key, `ai-user/${userId}/up/${randomUUID()}.${extOf(ref.key, 'bin')}`);
        return { name: ref.name, kind: ref.kind, url: this.storage.toPublicUrl(key) };
      }),
    );
    await this.engagement.record(this.repo, 'prompt', id, String(user.userId), 'copy');
    return {
      title: prompt.title,
      content: prompt.content,
      type: prompt.type,
      modelId: prompt.modelId,
      params: prompt.params,
      references,
    };
  }

  /** 参考素材只允许引用自己上传的文件，复制进提示词自己的目录；名称必须唯一，@ 才不会指错 */
  private async storeReferences(userId: string, promptId: string, refs: CreatePromptDto['references'] = []) {
    if (new Set(refs.map((r) => r.name)).size !== refs.length) throw new BadRequestException('参考素材名称不能重复');
    return Promise.all(
      refs.map(async (ref, i) => {
        const source = this.storage.toObjectName(ref.url);
        if (!source.startsWith(`ai-user/${userId}/`)) throw new BadRequestException('参考素材只能使用自己上传的文件');
        const key = await this.storage.copyObject(source, `ai-user/${userId}/prompt/${promptId}/ref-${i}.${extOf(source, 'bin')}`);
        return { name: ref.name, kind: ref.kind, key };
      }),
    );
  }

  /** 查看 / 复制计数：同一访客同一内容一天只算一次 */
  async record(id: string, viewer: string, kind: 'view' | 'copy'): Promise<boolean> {
    return this.engagement.record(this.repo, 'prompt', id, viewer, kind);
  }

  private async find(id: string) {
    const prompt = await this.repo.findOne({ where: { id } });
    if (!prompt) throw new NotFoundException('提示词不存在');
    return prompt;
  }

  private present(prompt: PromptEntity) {
    const { mediaKey, references, ...rest } = prompt;
    return {
      ...rest,
      mediaUrl: this.storage.toPublicUrl(mediaKey),
      references: references.map((r) => ({ name: r.name, kind: r.kind, url: this.storage.toPublicUrl(r.key) })),
    };
  }
}
