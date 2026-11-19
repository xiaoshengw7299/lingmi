import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { parsePage } from '../../common/hot-rank';
import { StorageService } from '../storage';
import { CreateAssetDto, QueryAssetDto } from './asset.dto';
import { AssetKind, AssetMeta, UserAssetEntity } from './asset.entity';

/** 单用户资产上限，防止对象存储被无限占用 */
const MAX_ASSETS_PER_USER = 1000;
const MEDIA_KINDS: AssetKind[] = ['image', 'video', 'audio'];

@Injectable()
export class AssetService {
  constructor(
    @InjectRepository(UserAssetEntity) private readonly repo: Repository<UserAssetEntity>,
    private readonly storage: StorageService,
  ) {}

  async list(userId: string, query: QueryAssetDto) {
    const { page, pageSize } = parsePage(query.page, query.pageSize, 100);
    const qb = this.repo.createQueryBuilder('a').where('a.user_id = :userId', { userId });
    if (query.kind) qb.andWhere('a.kind = :kind', { kind: query.kind });
    if (query.keyword?.trim()) qb.andWhere('a.name ILIKE :kw', { kw: `%${query.keyword.trim()}%` });
    const [items, total] = await qb
      .orderBy('a.created_at', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getManyAndCount();
    return { items: items.map((item) => this.present(item)), total, page, pageSize };
  }

  /** 加入资产：媒体复制成独立副本，提示词直接存正文 */
  async create(userId: string, dto: CreateAssetDto) {
    await this.assertQuota(userId);
    const id = randomUUID();
    let objectKey: string | null = null;
    if (dto.kind !== 'prompt') {
      const source = this.storage.toObjectName(dto.url ?? '');
      if (!source) throw new BadRequestException('缺少素材地址');
      const dest = `ai-user/${userId}/assets/${id}.${this.extOf(source, dto.kind)}`;
      objectKey = /^https?:\/\//i.test(source)
        ? await this.storage.uploadFromUrl(dest, source)
        : await this.storage.copyObject(source, dest);
    }
    const saved = await this.repo.save(
      this.repo.create({
        id,
        userId,
        kind: dto.kind,
        name: dto.name.trim() || '未命名',
        objectKey,
        content: dto.kind === 'prompt' ? dto.content?.trim() || null : null,
        meta: dto.meta ?? null,
      }),
    );
    return this.present(saved);
  }

  /** 本地上传直接入库 */
  async upload(userId: string, file: Express.Multer.File, name?: string) {
    const kind = MEDIA_KINDS.find((k) => file.mimetype.startsWith(`${k}/`));
    if (!kind) throw new BadRequestException('仅支持图片、视频、音频文件');
    await this.assertQuota(userId);
    const id = randomUUID();
    const objectKey = await this.storage.upload(
      `ai-user/${userId}/assets/${id}.${this.extOf(file.originalname, kind)}`,
      file.buffer,
      file.mimetype,
    );
    const meta: AssetMeta = { from: 'upload' };
    const saved = await this.repo.save(
      this.repo.create({ id, userId, kind, name: name?.trim() || file.originalname.slice(0, 255), objectKey, meta }),
    );
    return this.present(saved);
  }

  async remove(userId: string, id: string): Promise<void> {
    const asset = await this.repo.findOne({ where: { id, userId } });
    if (!asset) throw new NotFoundException('资产不存在');
    await this.repo.delete(id);
    if (asset.objectKey) await this.storage.remove(asset.objectKey);
  }

  private async assertQuota(userId: string) {
    if ((await this.repo.count({ where: { userId } })) >= MAX_ASSETS_PER_USER) {
      throw new BadRequestException(`资产数量已达上限（${MAX_ASSETS_PER_USER}），请先清理部分资产`);
    }
  }

  private extOf(name: string, kind: AssetKind) {
    const ext = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(name)?.[1]?.toLowerCase();
    return ext ?? { image: 'png', video: 'mp4', audio: 'mp3', prompt: 'txt' }[kind];
  }

  private present(asset: UserAssetEntity) {
    const { objectKey, ...rest } = asset;
    return { ...rest, url: objectKey ? this.storage.toPublicUrl(objectKey) : null };
  }
}
