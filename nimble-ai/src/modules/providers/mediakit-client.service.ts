import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosInstance } from 'axios';
import { createRetryableHttpClient, formatHttpError } from '../../common/http/retryable-http-client';

export type MediaKitTaskStatus = 'running' | 'completed' | 'failed';

export interface MediaKitTask {
  status: MediaKitTaskStatus;
  result?: Record<string, unknown>;
  error?: string;
}

export interface MediaKitUpload {
  fileId: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

interface MediaKitResponse {
  success?: boolean;
  task_id?: string;
  status?: string;
  result?: Record<string, unknown>;
  error?: { code?: string; message?: string } | null;
}

/**
 * 火山 AI MediaKit。异步工具走 tools/<name> + tasks/<id>，同步工具走 tools-sync/<name>。
 * 接口在业务失败时也可能返回 200，以响应体里的 success / error 为准。
 */
@Injectable()
export class MediaKitClientService {
  private readonly logger = new Logger(MediaKitClientService.name);
  private readonly http: AxiosInstance;
  readonly configured: boolean;
  readonly baseUrl: string;
  readonly apiKey: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('MEDIAKIT_API_KEY', '');
    this.configured = Boolean(this.apiKey);
    this.baseUrl = config.get<string>('MEDIAKIT_BASE_URL', 'https://mediakit.cn-beijing.volces.com/api/v1').replace(/\/$/, '');
    this.http = createRetryableHttpClient({ baseURL: this.baseUrl, apiKey: this.apiKey, timeoutMs: 120_000, logger: this.logger });
  }

  assertConfigured(): void {
    if (!this.configured) throw new Error('未配置 MEDIAKIT_API_KEY，暂时无法使用该功能');
  }

  /** 提交异步任务，返回任务 ID */
  async submit(tool: string, body: Record<string, unknown>): Promise<string> {
    const data = await this.post(`/tools/${tool}`, body);
    if (!data.task_id) throw new Error('任务未返回任务 ID');
    return data.task_id;
  }

  /** 调用同步工具，直接返回 result */
  async run(tool: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const data = await this.post(`/tools-sync/${tool}`, body, 180_000);
    return data.result ?? {};
  }

  async task(taskId: string): Promise<MediaKitTask> {
    this.assertConfigured();
    let data: MediaKitResponse;
    try {
      ({ data } = await this.http.get<MediaKitResponse>(`/tasks/${encodeURIComponent(taskId)}`, { timeout: 20_000 }));
    } catch (error) {
      throw new Error(formatHttpError(error));
    }
    const status = String(data?.status ?? '').toLowerCase();
    if (status === 'completed') return { status: 'completed', result: data.result ?? {} };
    if (status === 'failed') return { status: 'failed', error: data.error?.message || data.error?.code || '处理失败' };
    return { status: 'running' };
  }

  /** 申请本地文件直传地址。浏览器拿 uploadUrl 直接 PUT，提交任务时用 fileId */
  async requestUpload(): Promise<MediaKitUpload> {
    const result = await this.run('request-media-upload-url', {});
    const fileId = String(result.file_id ?? '');
    const uploadUrl = String(result.upload_url ?? '');
    if (!fileId || !uploadUrl) throw new Error('上传地址申请失败');
    const headers = Object.fromEntries(
      ((result.upload_headers as Array<{ key?: string; value?: string }> | undefined) ?? [])
        .filter((item) => item?.key)
        .map((item) => [String(item.key), String(item.value ?? '')]),
    );
    return { fileId: fileId.startsWith('mediakit://') ? fileId : `mediakit://${fileId}`, uploadUrl, headers };
  }

  /** 剪辑工程 API（/editing/...）。HTTP 层统一 200，成功看 data，失败看 error */
  async editing<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: Record<string, unknown>): Promise<T> {
    this.assertConfigured();
    let data: { data?: T; error?: { code?: string; message?: string } };
    try {
      ({ data } = await this.http.request({ method, url: `/editing${path}`, data: body }));
    } catch (error) {
      throw new Error(formatHttpError(error));
    }
    if (data?.error || data?.data === undefined) throw new Error(data?.error?.message || data?.error?.code || '剪辑服务请求失败');
    return data.data;
  }

  private async post(path: string, body: Record<string, unknown>, timeout?: number): Promise<MediaKitResponse> {
    this.assertConfigured();
    let data: MediaKitResponse;
    try {
      ({ data } = await this.http.post<MediaKitResponse>(path, body, timeout ? { timeout } : undefined));
    } catch (error) {
      throw new Error(formatHttpError(error));
    }
    if (data?.success === false || data?.error) {
      throw new Error(data.error?.message || data.error?.code || '请求失败');
    }
    return data;
  }
}
