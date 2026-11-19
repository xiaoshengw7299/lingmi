import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { ShortVideoTaskEntity } from '../short-video/entities/short-video-task.entity';
import { User } from '../user/entities/user.entity';
import { PublishCodeEntity } from './entities/publish-code.entity';
import { PublicShareDto, UpdatePublishCodeDto } from './publish-code.dto';
import { DOUYIN_H5_VIDEO_MAX_BYTES, ShareOpenService } from './share-open.service';

const CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const WORK_LIMIT = 30;

@Injectable()
export class PublishCodeService implements OnModuleInit {
  constructor(
    @InjectRepository(PublishCodeEntity)
    private readonly codes: Repository<PublishCodeEntity>,
    @InjectRepository(ShortVideoTaskEntity)
    private readonly tasks: Repository<ShortVideoTaskEntity>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly storage: StorageService,
    private readonly open: ShareOpenService,
  ) {}

  async onModuleInit() {
    await this.codes.query(
      `ALTER TABLE "publish_code" ADD COLUMN IF NOT EXISTS "qr_caption" character varying(40) NOT NULL DEFAULT ''`,
    );
  }

  async mine(userId: number) {
    return this.toOwner(await this.ensure(userId));
  }

  async update(userId: number, dto: UpdatePublishCodeDto) {
    const row = await this.ensure(userId);
    const poiId = dto.poiId.trim();
    if (poiId && !/^\d{1,32}$/.test(poiId)) {
      throw new BadRequestException('抖音地点 ID 是一串数字，从地点分享链接里复制。');
    }
    row.enabled = dto.enabled;
    row.displayName = dto.displayName.trim().slice(0, 40);
    row.caption = dto.caption.trim().slice(0, 1000);
    row.hashtags = this.cleanTags(dto.hashtags);
    row.poiId = poiId;
    row.poiName = dto.poiName.trim().slice(0, 80);
    row.xhsTitle = dto.xhsTitle.trim().slice(0, 20);
    row.qrCaption = dto.qrCaption.trim().slice(0, 40);
    await this.codes.save(row);
    return this.toOwner(row);
  }

  async landing(code: string, viewerId?: number) {
    const profile = await this.findActive(code);
    if (viewerId !== profile.userId) {
      void this.codes.increment({ id: profile.id }, 'viewCount', 1).catch(() => undefined);
    }
    const user = await this.users.findOne({
      where: { id: profile.userId },
      select: { id: true, nickname: true, avatar: true },
    });
    const { works, clipped } = await this.worksOf(profile.userId);
    const total = await this.tasks.count({ where: { userId: String(profile.userId), status: 'success' } });
    return {
      displayName: profile.displayName.trim() || user?.nickname?.trim() || '灵米创作者',
      avatar: user?.avatar ? this.storage.toPublicUrl(user.avatar) : null,
      caption: profile.caption,
      hashtags: profile.hashtags ?? [],
      poiName: profile.poiName,
      poiReady: Boolean(profile.poiId),
      xhsTitle: profile.xhsTitle,
      platforms: this.open.platforms(),
      videoReachable: this.videoReachable(),
      truncated: clipped || total > WORK_LIMIT,
      works,
    };
  }

  async douyin(code: string, dto: PublicShareDto) {
    const profile = await this.findActive(code);
    const clip = await this.clipOf(profile, dto.taskId, dto.index);
    const title = this.captionOf(dto.caption, profile.caption, clip.subject);
    const schema = await this.open.douyinSchema({
      videoUrl: clip.url,
      title,
      hashtags: profile.hashtags ?? [],
      poiId: profile.poiId,
    });
    void this.codes.increment({ id: profile.id }, 'douyinCount', 1).catch(() => undefined);
    return { schema, poiAttached: Boolean(profile.poiId) };
  }

  async xhs(code: string, dto: PublicShareDto) {
    const profile = await this.findActive(code);
    const clip = await this.clipOf(profile, dto.taskId, dto.index);
    const caption = this.captionOf(dto.caption, profile.caption, clip.subject);
    const title = (profile.xhsTitle.trim() || caption).slice(0, 20);
    const tags = (profile.hashtags ?? []).map((tag) => `#${tag}`).join(' ');
    const content = [caption, tags, profile.poiName ? `地点：${profile.poiName}` : '']
      .filter(Boolean)
      .join('\n')
      .slice(0, 1000);
    const verify = await this.open.xhsVerify();
    void this.codes.increment({ id: profile.id }, 'xhsCount', 1).catch(() => undefined);
    return { ...verify, video: clip.url, title, content, poiName: profile.poiName };
  }

  private async toOwner(row: PublishCodeEntity) {
    const workCount = await this.tasks.count({ where: { userId: String(row.userId), status: 'success' } });
    return {
      code: row.code,
      enabled: row.enabled,
      displayName: row.displayName,
      caption: row.caption,
      hashtags: Array.isArray(row.hashtags) ? row.hashtags : [],
      poiId: row.poiId,
      poiName: row.poiName,
      xhsTitle: row.xhsTitle,
      qrCaption: row.qrCaption ?? '',
      viewCount: row.viewCount,
      douyinCount: row.douyinCount,
      xhsCount: row.xhsCount,
      workCount,
      platforms: this.open.platforms(),
      videoReachable: this.videoReachable(),
    };
  }

  private async ensure(userId: number) {
    const found = await this.codes.findOne({ where: { userId } });
    if (found) return found;
    for (let i = 0; i < 5; i++) {
      try {
        return await this.codes.save(
          this.codes.create({
            userId,
            code: this.newCode(),
            enabled: true,
            displayName: '',
            caption: '',
            hashtags: [],
            poiId: '',
            poiName: '',
            xhsTitle: '',
            qrCaption: '',
            viewCount: 0,
            douyinCount: 0,
            xhsCount: 0,
          }),
        );
      } catch (error) {
        const again = await this.codes.findOne({ where: { userId } });
        if (again) return again;
        if (i === 4) throw error;
      }
    }
    throw new BadRequestException('发布码生成失败，请重试');
  }

  private async findActive(code: string) {
    if (!/^[a-z0-9]{8}$/.test(code)) throw new NotFoundException('发布码不存在');
    const profile = await this.codes.findOne({ where: { code } });
    if (!profile) throw new NotFoundException('发布码不存在');
    if (!profile.enabled) throw new NotFoundException('发布码已停用');
    return profile;
  }

  private async worksOf(userId: number) {
    const tasks = await this.tasks.find({
      where: { userId: String(userId), status: 'success' },
      order: { createdAt: 'DESC' },
      take: WORK_LIMIT,
      select: {
        id: true,
        subject: true,
        aspect: true,
        videoObjectKey: true,
        videoObjectKeys: true,
        createdAt: true,
      },
    });
    const works: Array<{
      taskId: string;
      index: number;
      subject: string;
      aspect: string;
      videoUrl: string;
      createdAt: Date;
    }> = [];
    let clipped = false;
    for (const task of tasks) {
      const keys = this.clipKeys(task);
      for (let index = 0; index < keys.length; index++) {
        if (works.length >= 60) {
          clipped = true;
          return { works, clipped };
        }
        works.push({
          taskId: task.id,
          index,
          subject: task.subject,
          aspect: task.aspect || '9:16',
          videoUrl: this.storage.getPublicUrl(keys[index]),
          createdAt: task.createdAt,
        });
      }
    }
    return { works, clipped };
  }

  private async clipOf(profile: PublishCodeEntity, taskId: string, index: number) {
    const task = await this.tasks.findOne({
      where: { id: taskId, userId: String(profile.userId), status: 'success' },
    });
    if (!task) throw new NotFoundException('作品不存在或已删除');
    const key = this.clipKeys(task)[index];
    if (!key) throw new NotFoundException('这个版本不存在');
    const stat = await this.storage.stat(key);
    if (!stat) throw new BadRequestException('视频文件不存在，请重新生成后再发布');
    if (stat.size > DOUYIN_H5_VIDEO_MAX_BYTES) {
      throw new BadRequestException('这条视频超过 128MB，抖音和小红书无法拉取');
    }
    return { subject: task.subject || '', url: this.storage.getPublicUrl(key) };
  }

  private clipKeys(task: Pick<ShortVideoTaskEntity, 'videoObjectKey' | 'videoObjectKeys'>) {
    const keys = task.videoObjectKeys?.length
      ? task.videoObjectKeys
      : task.videoObjectKey
        ? [task.videoObjectKey]
        : [];
    return keys.map((key) => key.trim()).filter(Boolean);
  }

  private captionOf(input: string | undefined, preset: string, subject: string) {
    return ((input ?? '').trim() || preset.trim() || subject.trim()).slice(0, 1000);
  }

  private cleanTags(tags: string[]) {
    const out: string[] = [];
    for (const raw of tags.flatMap((tag) => tag.split(/[,，\s#]+/))) {
      const tag = raw.trim().slice(0, 20);
      if (!tag || out.includes(tag)) continue;
      out.push(tag);
      if (out.length >= 5) break;
    }
    return out;
  }

  private videoReachable() {
    try {
      const url = new URL(this.storage.getPublicUrl('a.mp4'));
      if (url.protocol !== 'https:') return false;
      const host = url.hostname.toLowerCase();
      if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return false;
      if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return false;
      return true;
    } catch {
      return false;
    }
  }

  private newCode() {
    const bytes = randomBytes(8);
    let code = '';
    for (let i = 0; i < 8; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return code;
  }
}
