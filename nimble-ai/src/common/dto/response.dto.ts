import * as dayjs from 'dayjs';

/**
 * 统一响应结构：{ code, data, message, timestamp }
 */
export class ResponseDto<T = any> {
  code: number;
  message: string;
  data: T;
  timestamp: string;

  constructor(code: number, message: string, data: T) {
    this.code = code;
    this.message = message;
    this.data = data;
    this.timestamp = dayjs().toISOString();
  }

  static success<T>(data: T, message = '操作成功'): ResponseDto<T> {
    return new ResponseDto(200, message, data);
  }

  static error<T>(code: number, message: string, data: T = null as T): ResponseDto<T> {
    return new ResponseDto(code, message, data);
  }

  /** 是否已是统一响应结构（避免二次包装） */
  static isWrapped(data: unknown): data is ResponseDto {
    if (data instanceof ResponseDto) return true;
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    return typeof obj.code === 'number' && 'message' in obj && 'data' in obj;
  }
}
