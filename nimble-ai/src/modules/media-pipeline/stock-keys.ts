import axios from 'axios';

/**
 * 解析免费素材 API Key：同一环境变量可配多个，逗号 / 分号 / 竖线 / 换行分隔。
 * 限流或失效时按配置顺序切到下一个，默认从第一个开始。
 */
export function parseApiKeys(raw?: string | null): string[] {
  return [...new Set((raw ?? '').split(/[\n,;|]+/).map((item) => item.trim()).filter(Boolean))];
}

export class StockKeyPool {
  private cursor = 0;

  constructor(private readonly keys: string[]) {}

  get configured(): boolean {
    return this.keys.length > 0;
  }

  get size(): number {
    return this.keys.length;
  }

  /** 从当前 Key 开始尝试；遇到 401/403/429/402 才切下一个，成功后钉在这把 Key 上。 */
  async withKey<T>(run: (key: string) => Promise<T>, onRotate?: (status?: number) => void): Promise<T> {
    if (!this.keys.length) throw new Error('未配置 API Key');
    const start = this.cursor;
    let lastError: unknown;
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (start + i) % this.keys.length;
      try {
        const result = await run(this.keys[idx]);
        this.cursor = idx;
        return result;
      } catch (error) {
        lastError = error;
        if (!isRotatableKeyError(error) || i === this.keys.length - 1) throw error;
        onRotate?.(axiosStatus(error));
        this.cursor = (idx + 1) % this.keys.length;
      }
    }
    throw lastError;
  }
}

export function isRotatableKeyError(error: unknown): boolean {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  return status === 401 || status === 403 || status === 429 || status === 402;
}

export function axiosStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}
