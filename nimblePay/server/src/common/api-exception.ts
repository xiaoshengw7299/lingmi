import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiException extends HttpException {
  constructor(
    public readonly bizCode: number,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ code: status, message, data: null }, status);
    this.message = message;
  }

  static bad(msg: string, code = 40001) {
    return new ApiException(code, msg, HttpStatus.BAD_REQUEST);
  }

  static unauthorized(msg = '未登录或登录已过期', code = 40101) {
    return new ApiException(code, msg, HttpStatus.UNAUTHORIZED);
  }

  static forbidden(msg = '没有权限', code = 40301) {
    return new ApiException(code, msg, HttpStatus.FORBIDDEN);
  }

  static notFound(msg = '资源不存在', code = 40401) {
    return new ApiException(code, msg, HttpStatus.NOT_FOUND);
  }

  static conflict(msg: string, code = 40901) {
    return new ApiException(code, msg, HttpStatus.CONFLICT);
  }
}

export class AlipayChannelError extends ApiException {
  constructor(
    public readonly subCode: string,
    msg: string,
  ) {
    super(50001, `支付宝: ${msg}${subCode ? ` (${subCode})` : ''}`, HttpStatus.BAD_REQUEST);
  }
}

/** 渠道超时/未知类错误：本地不得标失败，必须查单确认 */
export function isTransientAlipayError(e: unknown): boolean {
  const code = e instanceof AlipayChannelError ? e.subCode : '';
  const msg = errorMessage(e);
  return /SYSTEM_ERROR|UNKNOW-ERROR|UNKNOWN|SERVICE_UNAVAILABLE|aop\.unknow|timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|socket hang up|\b502\b|\b503\b|\b504\b/i.test(
    `${code} ${msg}`,
  );
}

export function isAlipayTradeMissing(e: unknown): boolean {
  const code = e instanceof AlipayChannelError ? e.subCode : '';
  const msg = errorMessage(e);
  return /TRADE_NOT_EXIST|ORDER_NOT_EXIST|REFUND_NOT_EXIST/i.test(`${code} ${msg}`);
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiException) {
    const body = e.getResponse();
    if (typeof body === 'object' && body && 'message' in body && (body as { message?: unknown }).message) {
      return String((body as { message: unknown }).message);
    }
    if (e.message && e.message !== 'Api Exception') return e.message;
  }
  if (e instanceof Error && e.message) return e.message;
  return String(e);
}
