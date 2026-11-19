import { createWriteStream } from 'fs';
import { unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ACLType, HttpMethodType, TosClient, TosServerError } from '@volcengine/tos-sdk';
import axios from 'axios';

/** 浏览器可匿名读取的对象前缀。方舟拉参考文件不走这条，走内网预签名。 */
const PUBLIC_PREFIXES = ['ai-video/', 'ai-short-video/', 'ai-avatar/', 'ai-user/', 'ai-ecom-video/', 'ai-tool/'];
const OBJECT_KEY = /(?:^|\/)((?:ai-video|ai-short-video|ai-avatar|ai-user|ai-ecom-video|ai-tool)\/.+)$/;
/** 浏览器直传的预签名 PUT 有效期，盖住大文件上传即可 */
const UPLOAD_PRESIGN_SEC = 3600;

/**
 * 对象存储服务（火山引擎 TOS）
 *
 * 视频：`ai-video/<projectId>/<category>/<filename>`
 * 一键成片：`ai-short-video/<userId>/<taskId>/final.mp4`
 * 电商视频：`ai-ecom-video/<userId>/<projectId>/...`
 * 用户头像：`ai-avatar/<userId>/<timestamp>.<ext>`
 * 用户媒体（生成结果 / 我的资产 / 提示词库示例 / 论坛附件）：`ai-user/<userId>/<gen|assets|prompt|forum|up>/<id>.<ext>`
 * 视频工具 / 通用工具：`ai-tool/<userId>/<recordId>/...`
 * 库里只存对象键。浏览器和海外模型用公网地址；火山方舟、MediaKit 用同地域内网预签名地址。
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: TosClient | null;
  private readonly internalClient: TosClient | null;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly presignExpires: number;
  private readonly configured: boolean;

  constructor(private readonly configService: ConfigService) {
    const accessKeyId = this.configService.get<string>('TOS_ACCESS_KEY_ID', '').trim();
    const accessKeySecret = this.configService.get<string>('TOS_SECRET_ACCESS_KEY', '').trim();
    const region = this.configService.get<string>('TOS_REGION', 'cn-beijing').trim();
    const endpoint = cleanHost(this.configService.get<string>('TOS_ENDPOINT', 'tos-cn-beijing.volces.com'));
    const internalEndpoint = cleanHost(
      this.configService.get<string>('TOS_INTERNAL_ENDPOINT', endpoint.replace('.volces.com', '.ivolces.com')),
    );
    this.bucket = this.configService.get<string>('TOS_BUCKET', '').trim();
    this.configured = Boolean(accessKeyId && accessKeySecret && this.bucket);
    this.presignExpires = clampExpires(Number(this.configService.get<string>('TOS_PRESIGN_EXPIRES', '86400')));
    const customBase = this.configService.get<string>('TOS_PUBLIC_BASE_URL', '').trim().replace(/\/$/, '');
    this.publicBaseUrl = customBase || (this.bucket ? `https://${this.bucket}.${endpoint}` : '');
    const useInternal = this.configService.get<string>('TOS_VOLC_INTERNAL', region === 'cn-beijing' ? 'true' : 'false') === 'true';

    if (!this.configured) {
      this.client = null;
      this.internalClient = null;
      return;
    }

    const credentials = { accessKeyId, accessKeySecret, region, requestTimeout: 600_000 };
    this.client = new TosClient({ ...credentials, endpoint });
    this.internalClient = useInternal && internalEndpoint
      ? new TosClient({ ...credentials, endpoint: internalEndpoint })
      : null;
  }

  async onModuleInit() {
    if (!this.client) {
      this.logger.error('未配置火山引擎 TOS（TOS_ACCESS_KEY_ID / TOS_SECRET_ACCESS_KEY / TOS_BUCKET），上传会失败');
      return;
    }
    try {
      await this.ensureBucket();
      await this.ensurePublicRead();
      await this.ensureCors();
    } catch (error) {
      this.logger.warn(
        `TOS bucket check failed (${this.bucket}), uploads may fail`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  getBucket(): string {
    return this.bucket;
  }

  /** 拼接公开访问 URL（虚拟主机：https://{bucket}.{endpoint}/{objectKey}） */
  getPublicUrl(objectName: string): string {
    const key = encodeKey(objectName.replace(/^\//, ''));
    return this.publicBaseUrl ? `${this.publicBaseUrl}/${key}` : key;
  }

  /**
   * 完整 URL 或对象键 → 对象键。
   * 认本服务的前缀，因此旧公网地址、TOS 公网地址、内网预签名地址都能还原成对象键。
   * 外部链接原样返回。
   */
  toObjectName(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    const tos = /^tos:\/\/([^/]+)\/(.+)$/i.exec(trimmed);
    if (tos) return tos[1] === this.bucket ? tos[2] : trimmed;
    if (!this.isHttpUrl(trimmed)) return trimmed.replace(/^\//, '');
    try {
      const url = new URL(trimmed);
      const pathname = safeDecode(url.pathname).replace(/^\/+/, '');
      const known = pathname.match(OBJECT_KEY);
      if (known) return known[1];
      if (this.bucket && url.hostname.startsWith(`${this.bucket}.`)) return pathname;
      const marker = `${this.bucket}/`;
      if (this.bucket && pathname.startsWith(marker)) return pathname.slice(marker.length);
    } catch {
      // 非法 URL 原样返回
    }
    return trimmed;
  }

  toPublicUrl(value: string): string {
    const key = this.toObjectName(value);
    return this.isHttpUrl(key) ? key : this.getPublicUrl(key);
  }

  /**
   * 交给火山方舟 / MediaKit 的地址。
   * 桶和方舟同在华北2时签内网预签名。广州等其他地域用公网地址，方舟跨地域读不到内网。
   * 外部地址原样返回。
   */
  toVolcengineUrl(value: string): string {
    const original = value.trim();
    if (!original) return original;
    const key = this.toObjectName(original);
    if (this.isHttpUrl(key)) return original;
    if (!this.internalClient) return this.getPublicUrl(key);
    this.assertReady();
    return this.internalClient.getPreSignedUrl({
      method: 'GET',
      bucket: this.bucket,
      key,
      expires: this.presignExpires,
    });
  }

  /** MediaKit 产物写回本桶的目标目录 */
  toTosUri(prefix: string): string {
    return `tos://${this.bucket}/${prefix.replace(/^\/+|\/+$/g, '')}`;
  }

  /** 浏览器直传本桶用的预签名 PUT 地址。读权限由公共前缀策略决定，上传时不带 ACL */
  presignUpload(objectName: string): string {
    this.assertReady();
    return this.client!.getPreSignedUrl({ method: 'PUT', bucket: this.bucket, key: objectName, expires: UPLOAD_PRESIGN_SEC });
  }

  presignDownload(objectName: string, fileName: string): string {
    this.assertReady();
    const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return this.client!.getPreSignedUrl({
      bucket: this.bucket,
      key: objectName,
      expires: 600,
      response: { contentDisposition: `attachment; filename*=UTF-8''${encoded}` },
    });
  }

  private isHttpUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
  }

  /** 上传 Buffer，返回对象键（不是完整 URL） */
  async upload(objectName: string, buffer: Buffer, contentType?: string): Promise<string> {
    this.assertReady();
    await this.client!.putObject({
      bucket: this.bucket,
      key: objectName,
      body: buffer,
      contentLength: buffer.length,
      contentType,
      contentDisposition: 'inline',
      acl: ACLType.ACLPublicRead,
    });
    return objectName;
  }

  /** 从外部 URL 下载并转存，返回对象键 */
  async uploadFromUrl(objectName: string, sourceUrl: string): Promise<string> {
    const tmp = join(tmpdir(), `tos-in-${randomUUID()}`);
    try {
      const contentType = await this.writeHttpToFile(sourceUrl, tmp);
      return await this.uploadFile(objectName, tmp, contentType);
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
  }

  /** 把外部链接下载到本地文件，返回响应的 Content-Type */
  downloadUrl(url: string, destPath: string): Promise<string | undefined> {
    return this.writeHttpToFile(url, destPath);
  }

  /** 下载对象为 Buffer */
  async download(objectName: string): Promise<Buffer> {
    this.assertReady();
    const { data } = await this.client!.getObjectV2({
      bucket: this.bucket,
      key: this.toObjectName(objectName),
      dataType: 'buffer',
    });
    return data.content;
  }

  /** 读取对象大小。文件不存在时返回 null，不把存储错误抛到业务层。 */
  async stat(objectName: string): Promise<{ size: number } | null> {
    if (!this.client) return null;
    try {
      const { data } = await this.client.headObject({
        bucket: this.bucket,
        key: this.toObjectName(objectName),
      });
      return { size: Number(data['content-length'] || 0) };
    } catch (error) {
      if (isMissing(error)) return null;
      this.logger.warn(
        `TOS 读取对象信息失败: ${objectName}`,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  /** 删除对象（不存在时忽略） */
  async remove(objectName: string): Promise<void> {
    if (!this.client || !objectName) return;
    const key = this.toObjectName(objectName);
    if (this.isHttpUrl(key)) return;
    try {
      await this.client.deleteObject({ bucket: this.bucket, key });
    } catch (error) {
      if (isMissing(error)) return;
      this.logger.warn(
        `TOS 删除失败: ${key}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * 同桶内复制单个对象。优先服务端复制，大文件再走分片复制，避免整文件进内存。
   */
  async copyObject(srcKey: string, destKey: string): Promise<string> {
    this.assertReady();
    const src = this.toObjectName(srcKey);
    const dest = destKey.replace(/^\//, '');
    if (!src || this.isHttpUrl(src)) throw new Error(`无法复制外部地址: ${srcKey}`);
    if (src === dest) return dest;
    try {
      await this.client!.copyObject({
        bucket: this.bucket,
        key: dest,
        srcBucket: this.bucket,
        srcKey: src,
        acl: ACLType.ACLPublicRead,
      });
      return dest;
    } catch (error) {
      this.logger.warn(
        `TOS copyObject 失败，改用分片复制: ${src} -> ${dest}`,
        error instanceof Error ? error.message : String(error),
      );
      await this.client!.resumableCopyObject({
        bucket: this.bucket,
        key: dest,
        srcBucket: this.bucket,
        srcKey: src,
        acl: ACLType.ACLPublicRead,
        taskNum: 3,
      });
      return dest;
    }
  }

  /** 删除某个前缀下的全部对象（如 `ai-video/{projectId}/`），用于项目整体清理 */
  async removePrefix(prefix: string): Promise<void> {
    if (!this.client) return;
    const normalized = prefix.replace(/^\//, '').replace(/\/?$/, '/');
    const objectNames: string[] = [];
    try {
      let token: string | undefined;
      do {
        const { data } = await this.client.listObjectsType2({
          bucket: this.bucket,
          prefix: normalized,
          maxKeys: 1000,
          continuationToken: token,
          listOnlyOnce: true,
        });
        for (const item of data.Contents ?? []) {
          if (item.Key) objectNames.push(item.Key);
        }
        token = data.IsTruncated ? data.NextContinuationToken : undefined;
      } while (token);
    } catch (error) {
      this.logger.warn(
        `TOS 列举失败: ${normalized}`,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    for (let i = 0; i < objectNames.length; i += 1000) {
      const objects = objectNames.slice(i, i + 1000).map((key) => ({ key }));
      try {
        const { data } = await this.client.deleteMultiObjects({
          bucket: this.bucket,
          objects,
          quiet: true,
        });
        for (const item of data.Error ?? []) {
          this.logger.warn(`TOS 删除失败: ${item.Key} ${item.Message}`);
        }
      } catch (error) {
        this.logger.warn(
          `TOS 批量删除失败: ${normalized}`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  /** 下载到本地临时文件（对象键走 TOS，完整外部 URL 走 HTTP） */
  async downloadToTemp(urlOrKey: string, destPath: string): Promise<void> {
    const key = this.toObjectName(urlOrKey);
    if (this.isHttpUrl(key)) {
      await this.writeHttpToFile(key, destPath);
      return;
    }
    this.assertReady();
    await this.client!.getObjectToFile({ bucket: this.bucket, key, filePath: destPath });
  }

  /** 上传本地文件 */
  async uploadFile(objectName: string, filePath: string, contentType?: string): Promise<string> {
    this.assertReady();
    await this.client!.uploadFile({
      bucket: this.bucket,
      key: objectName,
      file: filePath,
      contentType,
      contentDisposition: 'inline',
      acl: ACLType.ACLPublicRead,
      taskNum: 3,
    });
    return objectName;
  }

  buildObjectName(
    projectId: string,
    category: 'assets' | 'shots' | 'uploads' | 'final',
    filename: string,
  ): string {
    return `ai-video/${projectId}/${category}/${filename}`;
  }

  private async ensureBucket(): Promise<void> {
    try {
      if (await this.client!.doesBucketExist({ bucket: this.bucket })) return;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    try {
      await this.client!.createBucket({ bucket: this.bucket });
      this.logger.log(`Created TOS bucket: ${this.bucket}`);
    } catch (error) {
      if (error instanceof TosServerError && (error.code === 'BucketAlreadyOwnedByYou' || error.code === 'BucketAlreadyExists')) {
        return;
      }
      throw error;
    }
  }

  private assertReady(): void {
    if (!this.client) {
      throw new Error('未配置火山引擎对象存储：请填写 TOS_ACCESS_KEY_ID、TOS_SECRET_ACCESS_KEY、TOS_BUCKET');
    }
  }

  /** 浏览器 <img>/<video> 与海外模型拉取参考文件依赖匿名 GetObject。桶若开启了阻止公共访问，这里会失败。 */
  private async ensurePublicRead(): Promise<void> {
    const desired = {
      Sid: 'lingmi-public-read',
      Effect: 'Allow' as const,
      Principal: ['*'],
      Action: ['tos:GetObject'],
      Resource: PUBLIC_PREFIXES.map((prefix) => `trn:tos:::${this.bucket}/${prefix}*`),
    };
    let statements = [];
    try {
      const { data } = await this.client!.getBucketPolicy(this.bucket);
      statements = data?.Statement ?? [];
    } catch (error) {
      if (!isPolicyMissing(error)) {
        this.logger.warn(
          'TOS 公共读策略未写上。请在控制台关闭该桶的「阻止公共访问」，否则浏览器打不开图片和视频',
          error instanceof Error ? error.message : String(error),
        );
        return;
      }
    }
    const others = statements.filter((item) => item.Sid !== desired.Sid);
    const current = statements.find((item) => item.Sid === desired.Sid);
    const same = current
      && JSON.stringify(current.Action) === JSON.stringify(desired.Action)
      && JSON.stringify(current.Resource) === JSON.stringify(desired.Resource);
    if (same) return;
    try {
      await this.client!.putBucketPolicy({
        bucket: this.bucket,
        policy: { Statement: [...others, desired] },
      });
      this.logger.log(`TOS bucket policy set: anonymous GetObject on public prefixes (${this.bucket})`);
    } catch (error) {
      this.logger.warn(
        'TOS 公共读策略未写上。请在控制台关闭该桶的「阻止公共访问」，否则浏览器打不开图片和视频',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async ensureCors(): Promise<void> {
    try {
      await this.client!.putBucketCORS({
        bucket: this.bucket,
        CORSRules: [
          {
            AllowedOrigins: ['*'],
            AllowedMethods: [HttpMethodType.HttpMethodGet, HttpMethodType.HttpMethodHead, HttpMethodType.HttpMethodPut],
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag', 'Content-Length', 'Content-Type'],
            MaxAgeSeconds: 3600,
          },
        ],
      });
    } catch (error) {
      this.logger.warn(
        'TOS CORS 未写上，浏览器跨域读取文件可能失败',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async writeHttpToFile(url: string, destPath: string): Promise<string | undefined> {
    const res = await axios.get<NodeJS.ReadableStream>(url, {
      responseType: 'stream',
      timeout: 600_000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    try {
      await pipeline(res.data, createWriteStream(destPath));
    } catch (error) {
      (res.data as { destroy?: () => void }).destroy?.();
      throw error;
    }
    const contentType = String(res.headers['content-type'] || '').split(';')[0].trim();
    return contentType || undefined;
  }
}

function cleanHost(value: string): string {
  return value.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

function encodeKey(key: string): string {
  return key.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function clampExpires(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 86_400;
  return Math.min(Math.floor(value), 604_800);
}

function isMissing(error: unknown): boolean {
  if (!(error instanceof TosServerError)) return false;
  return error.statusCode === 404 || error.code === 'NoSuchKey' || error.code === 'NoSuchBucket';
}

function isPolicyMissing(error: unknown): boolean {
  return error instanceof TosServerError && (error.statusCode === 404 || error.code === 'NoSuchBucketPolicy');
}
