import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage';

const BGM_EXTS_RE = /\.(mp3|wav|m4a|aac|flac|ogg)$/i;

/**
 * 背景音乐解析（一键成片）：
 * random=本地曲库，custom=用户上传，none=不带配乐。
 * 旧的 ai 选项不再生成配乐，改走本地曲库。
 */
@Injectable()
export class BgmService {
  private readonly logger = new Logger(BgmService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly storage: StorageService,
  ) {}

  async resolve(bgmType: string, bgmFile: string, workDir: string, _prompt?: string): Promise<string | undefined> {
    if (bgmType === 'none') return undefined;
    if (bgmType === 'custom') {
      if (!bgmFile) return undefined;
      const dest = path.join(workDir, `bgm-custom${path.extname(bgmFile) || '.mp3'}`);
      await this.storage.downloadToTemp(bgmFile, dest);
      return dest;
    }
    const dir = this.configService.get<string>('BGM_LIBRARY_DIR', path.join(process.cwd(), 'resource', 'bgm'));
    try {
      const files = fs.readdirSync(dir).filter((f) => BGM_EXTS_RE.test(f));
      if (!files.length) {
        this.logger.warn(`BGM 素材库为空(${dir})，本次生成将不带背景音乐；可将 mp3 放入该目录或改选自定义配乐`);
        return undefined;
      }
      return path.join(dir, files[Math.floor(Math.random() * files.length)]);
    } catch {
      return undefined;
    }
  }
}
