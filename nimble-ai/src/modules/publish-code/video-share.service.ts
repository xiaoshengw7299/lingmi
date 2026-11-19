import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../common/types/auth-user';
import { UserAssetEntity } from '../asset/asset.entity';
import { CanvasExampleEntity } from '../canvas/canvas-example.entity';
import { CanvasProjectEntity } from '../canvas/canvas.entity';
import { ForumService } from '../forum/forum.service';
import { GenerationTaskEntity } from '../generation/generation.entity';
import { MediaToolTask } from '../media-tools/entities/media-tool-task.entity';
import {
  EXAMPLE_PREFIX,
  TOOL_CONTENT,
} from '../media-tools/media-tools.content';
import { PromptEntity } from '../prompt/prompt.entity';
import { ShortVideoTaskEntity } from '../short-video/entities/short-video-task.entity';
import { readStockVideoShareRef } from '../short-video/short-video.options';
import { StorageService } from '../storage';
import { VideoProjectEntity } from '../video/entities/video-project.entity';
import { VideoService } from '../video/video.service';
import { VideoShareDto } from './publish-code.dto';
import {
  DOUYIN_H5_VIDEO_MAX_BYTES,
  ShareOpenService,
} from './share-open.service';

type VideoFile = { url?: string | null; title?: string };

@Injectable()
export class VideoShareService {
  constructor(
    private readonly db: DataSource,
    private readonly storage: StorageService,
    private readonly open: ShareOpenService,
    private readonly video: VideoService,
    private readonly forum: ForumService,
  ) {}

  async prepare(dto: VideoShareDto, viewer?: AuthUser) {
    if (!this.open.platforms()[dto.platform]) {
      throw new BadRequestException(
        `暂未开通${dto.platform === 'douyin' ? '抖音' : '小红书'}发布`,
      );
    }
    const file = await this.resolve(dto, viewer);
    if (!file?.url)
      throw new NotFoundException('视频不存在、尚未生成完成或已删除');
    const video = await this.shareUrl(
      file.url,
      dto.platform,
      dto.source === 'stock',
    );
    const caption = (dto.caption?.trim() || file.title?.trim() || '').slice(
      0,
      1000,
    );
    if (dto.platform === 'douyin') {
      const schema = await this.open.douyinSchema({
        videoUrl: video,
        title: caption,
        hashtags: [],
        poiId: '',
      });
      return { schema };
    }
    return {
      ...(await this.open.xhsVerify()),
      video,
      title: Array.from(caption).slice(0, 20).join(''),
      content: caption,
    };
  }

  private async resolve(
    dto: VideoShareDto,
    viewer?: AuthUser,
  ): Promise<VideoFile | undefined> {
    const { id, source, video } = dto;
    if (source === 'stock') {
      const url = readStockVideoShareRef(id);
      if (!url) throw new BadRequestException('素材已过期，请重新获取后再发布');
      return { url };
    }
    if (source === 'tool-example') {
      const examples = Object.prototype.hasOwnProperty.call(TOOL_CONTENT, id)
        ? (TOOL_CONTENT[id].showcase ?? [])
        : [];
      const files = examples
        .flatMap((example) => example.items)
        .filter((item) => item.kind === 'video' && item.key)
        .map((item) => ({
          url: `${EXAMPLE_PREFIX}/${item.key}`,
          title: item.label,
        }));
      return this.selected(files, video);
    }
    if (!isUUID(id)) throw new NotFoundException('视频不存在');

    switch (source) {
      case 'video-example': {
        const example = await this.video.getExample(id);
        if (!example.snapshot) return;
        return this.selected(
          this.projectVideos(example.snapshot, example.title),
          video,
        );
      }
      case 'canvas-example': {
        const example = await this.db
          .getRepository(CanvasExampleEntity)
          .findOneBy({ id });
        if (!example) return;
        const file = this.selected(
          this.canvasVideos(example.doc.nodes, example.title),
          video,
        );
        if (!file?.url) return;
        const key = this.storage.toObjectName(file.url);
        if (
          key.startsWith(`ai-user/${example.createdBy}/share/${id}/`) ||
          /^https?:\/\//i.test(key)
        )
          return file;
        return;
      }
      case 'prompt': {
        const prompt = await this.db
          .getRepository(PromptEntity)
          .findOneBy({ id });
        if (!prompt) return;
        return this.selected(
          [
            ...(prompt.type === 'video'
              ? [{ url: prompt.mediaKey, title: prompt.title }]
              : []),
            ...prompt.references
              .filter((ref) => ref.kind === 'video')
              .map((ref) => ({ url: ref.key, title: ref.name })),
          ],
          video,
        );
      }
      case 'forum': {
        const attachments = await this.forum.shareableVideoAttachments(id, viewer);
        return this.selected(
          attachments.map((item) => ({ url: item.key, title: item.name })),
          video,
        );
      }
    }

    if (!viewer) throw new UnauthorizedException('请登录后发布');
    const userId = String(viewer.userId);
    switch (source) {
      case 'short-video': {
        const task = await this.db
          .getRepository(ShortVideoTaskEntity)
          .findOneBy({ id, userId, status: 'success' });
        if (!task) return;
        const keys = task.videoObjectKeys?.length
          ? task.videoObjectKeys
          : [task.videoObjectKey];
        return this.selected(
          keys.map((url) => ({ url, title: task.subject })),
          video,
        );
      }
      case 'tool': {
        const task = await this.db
          .getRepository(MediaToolTask)
          .findOneBy({ id, userId, status: 'succeeded' });
        return this.selected(
          task?.outputs
            .filter((item) => item.kind === 'video')
            .map((item) => ({ url: item.key, title: item.label })) ?? [],
          video,
        );
      }
      case 'generation': {
        const task = await this.db
          .getRepository(GenerationTaskEntity)
          .findOneBy({ id, userId, kind: 'video', status: 'succeeded' });
        if (task) return { url: task.resultKey };
        return;
      }
      case 'asset': {
        const asset = await this.db
          .getRepository(UserAssetEntity)
          .findOneBy({ id, userId, kind: 'video' });
        if (asset) return { url: asset.objectKey, title: asset.name };
        return;
      }
      case 'project': {
        const project = await this.video.getProjectForUser(id, userId, false);
        return this.selected(
          [
            ...this.projectVideos(project, project.title),
            ...project.shots.flatMap((shot) =>
              (shot.takes ?? [])
                .filter((take) => take.status === 'success')
                .map((take) => ({ url: take.videoUrl, title: shot.name })),
            ),
            ...(project.composeHistory ?? []).map((item) => ({
              url: item.videoUrl,
              title: project.title,
            })),
          ],
          video,
        );
      }
      case 'canvas': {
        const canvas = await this.db
          .getRepository(CanvasProjectEntity)
          .findOneBy({ id, userId });
        if (!canvas) return;
        const file = this.selected(
          this.canvasVideos(canvas.doc.nodes, canvas.title),
          video,
        );
        if (!file?.url) return;
        const key = this.storage.toObjectName(file.url);
        if (
          /^https?:\/\//i.test(key) ||
          (await this.canShareCanvasFile(userId, key))
        )
          return file;
      }
    }
  }

  private selected(files: VideoFile[], video?: string) {
    if (!video) return;
    const key = this.storage.toObjectName(video);
    return files.find(
      (file) => file.url && this.storage.toObjectName(file.url) === key,
    );
  }

  private projectVideos(
    project: {
      finalVideoUrl: string | null;
      assets: Array<{ kind: string; url?: string; name: string }>;
      shots: Array<{ videoUrl?: string | null; name: string }>;
    },
    title: string,
  ): VideoFile[] {
    return [
      { url: project.finalVideoUrl, title },
      ...project.assets
        .filter((asset) => asset.kind === 'video')
        .map((asset) => ({ url: asset.url, title: asset.name })),
      ...project.shots.map((shot) => ({
        url: shot.videoUrl,
        title: shot.name,
      })),
    ];
  }

  private canvasVideos(
    nodes: Array<Record<string, unknown>>,
    title: string,
  ): VideoFile[] {
    return nodes.flatMap((node) =>
      node?.type === 'video' && typeof node.url === 'string'
        ? [
            {
              url: node.url,
              title: typeof node.title === 'string' ? node.title : title,
            },
          ]
        : [],
    );
  }

  /** 私有画布的 JSON 可编辑，节点中的地址还需要校验文件归属。 */
  private async canShareCanvasFile(userId: string, key: string) {
    if (
      ['ai-user', 'ai-short-video', 'ai-tool'].some((prefix) =>
        key.startsWith(`${prefix}/${userId}/`),
      )
    )
      return true;
    if (
      key.startsWith('ai-video/examples/') ||
      /^ai-user\/\d+\/share\//.test(key)
    )
      return true;
    const [folder, projectId] = key.split('/');
    return (
      folder === 'ai-video' &&
      isUUID(projectId) &&
      this.db
        .getRepository(VideoProjectEntity)
        .existsBy({ id: projectId, userId })
    );
  }

  private async shareUrl(
    value: string,
    platform: VideoShareDto['platform'],
    stock: boolean,
  ) {
    const key = stock ? undefined : this.storage.toObjectName(value);
    if (key && /^https?:\/\//i.test(key)) {
      throw new BadRequestException('外部视频请先上传到「我的资产」再发布');
    }
    if (key?.split('/').some((part) => part === '.' || part === '..')) {
      throw new BadRequestException('视频地址无效');
    }
    const url = URL.parse(key ? this.storage.getPublicUrl(key) : value);
    if (
      url?.protocol !== 'https:' ||
      url.username ||
      url.password ||
      /^(localhost$|\[::1\]$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(
        url.hostname,
      ) ||
      /\.(local|localhost)$/i.test(url.hostname)
    ) {
      throw new BadRequestException(
        '发布需要平台可以访问的公网 HTTPS 视频地址',
      );
    }
    if (platform === 'douyin' && !/\.(mp4|mov)$/i.test(url.pathname)) {
      throw new BadRequestException('抖音支持 MP4 和 MOV，请先转换视频格式');
    }
    if (key) {
      const stat = await this.storage.stat(key);
      if (!stat) throw new NotFoundException('视频文件不存在或暂时无法访问');
      if (platform === 'douyin' && stat.size > DOUYIN_H5_VIDEO_MAX_BYTES) {
        throw new BadRequestException(
          '视频超过抖音的 128 MB 限制，请压缩后再发布',
        );
      }
    }
    return url.href;
  }
}
