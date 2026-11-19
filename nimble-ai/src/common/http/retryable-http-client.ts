import { Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';

/** 允许自动重试的最大次数（不含首次请求） */
const MAX_RETRIES = 2;
/** 重试前的等待时间（毫秒），按第几次重试线性递增 */
const RETRY_DELAY_MS = 1500;

type RetryableConfig = AxiosRequestConfig & { _retryCount?: number };

export interface RetryableHttpClientOptions {
  baseURL: string;
  /** 拼接为 `Authorization: Bearer <apiKey>`；留空则不发该请求头 */
  apiKey?: string;
  timeoutMs: number;
  logger: Logger;
}

/**
 * 创建带自动重试的 axios 客户端，供 模型平台API HTTP 客户端共用。
 *
 * GET 轮询 prediction 可对网络抖动和 502/503/504 重试；POST 提交任务不是幂等的，
 * 无响应时上游可能已经创建 prediction，只对 429 限流重试，避免重复扣费。
 */
export function createRetryableHttpClient({ baseURL, apiKey, timeoutMs, logger }: RetryableHttpClientOptions): AxiosInstance {
  const http = axios.create({
    baseURL,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    timeout: timeoutMs,
  });

  const shouldRetry = (error: AxiosError): boolean => {
    const method = (error.config?.method || 'get').toLowerCase();
    const isGet = method === 'get';
    // POST 提交任务不是幂等的：无响应时上游可能已创建 prediction，重试会重复扣费
    if (!error.response) return isGet;
    if (error.response.status === 429) return true;
    return isGet && [502, 503, 504].includes(error.response.status);
  };

  http.interceptors.response.use(undefined, async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined;
    if (!config || !shouldRetry(error)) throw error;

    const attempt = (config._retryCount ?? 0) + 1;
    if (attempt > MAX_RETRIES) throw error;
    config._retryCount = attempt;

    logger.warn(
      `请求失败（${error.message}），${RETRY_DELAY_MS * attempt}ms 后进行第 ${attempt}/${MAX_RETRIES} 次重试: ${config.method?.toUpperCase()} ${config.url}`,
    );
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    return http.request(config);
  });

  return http;
}

/** 从 Axios / 生成服务错误体中提取可读信息（避免只剩 status code 400） */
export function formatHttpError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = (error as AxiosError<{
      error?: { message?: string } | string;
      message?: string;
      detail?: string;
      data?: { error?: string; message?: string } | string;
      base_resp?: { status_msg?: string };
    }>).response?.data;
    if (typeof data?.error === 'string') return data.error;
    if (typeof data?.data === 'string' && data.data) return data.data;
    if (data?.data && typeof data.data === 'object') {
      if (typeof data.data.error === 'string' && data.data.error) return data.data.error;
      if (typeof data.data.message === 'string' && data.data.message) return data.data.message;
    }
    return data?.error?.message || data?.message || data?.detail || data?.base_resp?.status_msg || error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
