import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosInstance } from 'axios';
import { createRetryableHttpClient } from '../../common/http/retryable-http-client';
import { formatArkError, translateArkError } from './ark-error';

export type UpstreamTaskState = 'running' | 'succeeded' | 'failed';

export interface UpstreamTask {
  state: UpstreamTaskState;
  url?: string;
  error?: string;
}

/**
 * 火山方舟。视频走内容生成任务，图片走 images/generations，文本走 OpenAI 兼容 chat。
 */
@Injectable()
export class ArkClientService {
  private readonly logger = new Logger(ArkClientService.name);
  private readonly http: AxiosInstance;
  readonly configured: boolean;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('ARK_API_KEY', '');
    this.configured = Boolean(apiKey);
    this.http = createRetryableHttpClient({
      baseURL: config.get<string>('ARK_BASE_URL', 'https://ark.cn-beijing.volces.com/api/v3'),
      apiKey,
      timeoutMs: Number(config.get<string>('ARK_TIMEOUT', '180000')),
      logger: this.logger,
    });
  }

  assertConfigured(): void {
    if (!this.configured) throw new Error('未配置 ARK_API_KEY，无法调用火山方舟');
  }

  async submitVideo(body: Record<string, unknown>): Promise<string> {
    this.assertConfigured();
    try {
      const { data } = await this.http.post('/contents/generations/tasks', body);
      const id = data?.id ?? data?.data?.id;
      if (!id) throw new Error('任务创建失败：模型未返回任务 ID');
      return String(id);
    } catch (error) {
      throw new Error(formatArkError(error));
    }
  }

  async getVideo(taskId: string): Promise<UpstreamTask> {
    this.assertConfigured();
    try {
      const { data } = await this.http.get(`/contents/generations/tasks/${taskId}`, { timeout: 20_000 });
      return this.normalizeVideo(data);
    } catch (error) {
      throw new Error(formatArkError(error));
    }
  }

  /** 图片生成是同步接口，成功直接返回图片 URL */
  async generateImage(body: Record<string, unknown>): Promise<string> {
    this.assertConfigured();
    try {
      const { data } = await this.http.post('/images/generations', body, { timeout: 180_000 });
      const url = data?.data?.[0]?.url ?? data?.data?.[0]?.b64_json;
      if (!url || typeof url !== 'string') throw new Error('图片生成失败：模型未返回图片');
      if (url.startsWith('data:') || !url.startsWith('http')) {
        throw new Error('图片生成失败：模型未返回可下载的图片地址');
      }
      return url;
    } catch (error) {
      throw new Error(formatArkError(error));
    }
  }

  private normalizeVideo(data: Record<string, unknown> | undefined): UpstreamTask {
    const status = String(data?.status ?? '').toLowerCase();
    const content = data?.content as { video_url?: string } | undefined;
    const error = data?.error as { code?: string; message?: string } | string | undefined;
    const message = typeof error === 'string' ? error : error?.message;
    if (status === 'succeeded' || status === 'success') {
      return { state: 'succeeded', url: content?.video_url };
    }
    if (status === 'failed' || status === 'cancelled' || status === 'expired') {
      return { state: 'failed', error: translateArkError(typeof error === 'object' ? error?.code : undefined, message || '视频生成失败') };
    }
    return { state: 'running' };
  }
}
