import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { FfmpegService } from '../media-pipeline/ffmpeg.service';
import { StorageService } from '../storage';
import { ImageToolDto } from './generation.dto';

const MAX_SPLIT_CELLS = 36;
const MAX_UPSCALE_PIXELS = 8192 * 8192;
const DATA_URL_PREFIX = /^data:image\/png;base64,/;

export interface ProcessedMedia {
  key: string;
  url: string;
  thumbUrl: string | null;
}

/**
 * 画布图片小工具：裁剪 / 拆分 / 放大 / 局部重绘标注。全部在服务端用 FFmpeg 完成，
 * 浏览器直接读对象存储图片会遇到跨域，服务端处理则没有这个问题，也不依赖模型、不扣费。
 */
@Injectable()
export class ImageToolsService {
  private readonly logger = new Logger(ImageToolsService.name);

  constructor(
    private readonly ffmpeg: FfmpegService,
    private readonly storage: StorageService,
  ) {}

  /** 返回处理后的图片（拆分会返回多张） */
  async run(userId: string, dto: ImageToolDto): Promise<ProcessedMedia[]> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-tool-'));
    try {
      const input = path.join(dir, 'input');
      await this.storage.downloadToTemp(this.assertOwned(userId, dto.url), input);
      const { width, height } = await this.ffmpeg.probeMedia(input);
      if (!width || !height) throw new BadRequestException('无法读取图片尺寸');

      const outputs: string[] = [];
      switch (dto.op) {
        case 'crop': {
          const r = dto.rect;
          if (!r) throw new BadRequestException('缺少裁剪区域');
          const out = path.join(dir, 'crop.png');
          await this.ffmpeg.cropImage(input, out, this.toPixels(r, width, height));
          outputs.push(out);
          break;
        }
        case 'split': {
          const rows = dto.rows ?? 2;
          const cols = dto.cols ?? 2;
          if (rows * cols > MAX_SPLIT_CELLS) throw new BadRequestException('拆分数量过多');
          const cw = Math.floor(width / cols);
          const ch = Math.floor(height / rows);
          for (let i = 0; i < rows * cols; i++) {
            const out = path.join(dir, `cell-${i}.png`);
            await this.ffmpeg.cropImage(input, out, { x: (i % cols) * cw, y: Math.floor(i / cols) * ch, w: cw, h: ch });
            outputs.push(out);
          }
          break;
        }
        case 'upscale': {
          const factor = dto.factor ?? 2;
          if (width * height * factor * factor > MAX_UPSCALE_PIXELS) throw new BadRequestException('放大后尺寸过大');
          const out = path.join(dir, 'upscale.png');
          await this.ffmpeg.scaleImage(input, out, factor);
          outputs.push(out);
          break;
        }
        case 'mark': {
          if (!dto.mask || !DATA_URL_PREFIX.test(dto.mask)) throw new BadRequestException('缺少标注图');
          const mask = path.join(dir, 'mask.png');
          fs.writeFileSync(mask, Buffer.from(dto.mask.replace(DATA_URL_PREFIX, ''), 'base64'));
          const out = path.join(dir, 'marked.png');
          await this.ffmpeg.overlayMask(input, mask, out);
          outputs.push(out);
          break;
        }
      }
      return await Promise.all(outputs.map((file) => this.save(userId, file)));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /** 为已存在的对象生成缩略图并上传；失败只记日志，不影响主流程（前端会回退到原图） */
  async thumbnailOf(userId: string, objectKey: string, isVideo: boolean): Promise<string | null> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-'));
    try {
      const input = path.join(dir, 'input');
      const output = path.join(dir, 'thumb.jpg');
      await this.storage.downloadToTemp(objectKey, input);
      await this.ffmpeg.thumbnail(input, output, isVideo);
      return await this.storage.uploadFile(`ai-user/${userId}/thumb/${randomUUID()}.jpg`, output, 'image/jpeg');
    } catch (error) {
      this.logger.warn(`缩略图生成失败 ${objectKey}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  private async save(userId: string, file: string): Promise<ProcessedMedia> {
    const key = await this.storage.uploadFile(`ai-user/${userId}/gen/${randomUUID()}.png`, file, 'image/png');
    const thumb = await this.thumbnailOf(userId, key, false);
    return { key, url: this.storage.toPublicUrl(key), thumbUrl: thumb ? this.storage.toPublicUrl(thumb) : null };
  }

  /** 只允许处理自己目录下的文件，避免借这个接口读别人的素材 */
  private assertOwned(userId: string, url: string): string {
    const key = this.storage.toObjectName(url);
    if (!key.startsWith(`ai-user/${userId}/`)) throw new BadRequestException('只能处理自己的图片');
    return key;
  }

  private toPixels(r: { x: number; y: number; w: number; h: number }, width: number, height: number) {
    const x = Math.min(width - 2, Math.max(0, Math.round(r.x * width)));
    const y = Math.min(height - 2, Math.max(0, Math.round(r.y * height)));
    return {
      x,
      y,
      w: Math.max(2, Math.min(width - x, Math.round(r.w * width))),
      h: Math.max(2, Math.min(height - y, Math.round(r.h * height))),
    };
  }
}
