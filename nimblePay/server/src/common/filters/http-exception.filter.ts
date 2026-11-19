import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { errorMessage } from '../api-exception';
import { isApiRoute, PUBLIC_PAY_PREFIX } from '../constants';
import { renderPayPage } from '../../modules/payment/pay-page.view';

@Catch()
export class AllExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest();

    if (isApiRoute(req.originalUrl, `${PUBLIC_PAY_PREFIX}/notify`)) {
      this.logger.error(`notify ${req.originalUrl} ${errorMessage(exception)}`);
      return res.status(200).contentType('text/plain').send('fail');
    }

    if (isApiRoute(req.originalUrl, `${PUBLIC_PAY_PREFIX}/pay`)) {
      const msg =
        exception instanceof HttpException
          ? errorMessage(exception)
          : '页面出错，请返回软件查看订单。';
      return res.status(200).contentType('text/html; charset=utf-8').send(
        renderPayPage({ kind: 'error', title: '页面出错', message: msg }),
      );
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      let message = exception.message;
      if (typeof raw === 'string') message = raw;
      else if (typeof raw === 'object' && raw && 'message' in raw) {
        const m = (raw as { message: string | string[] }).message;
        message = Array.isArray(m) ? m.join('; ') : m;
      }
      return res.status(status).json({ code: status, message, data: null, timestamp: new Date().toISOString() });
    }

    this.logger.error(exception);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: HttpStatus.INTERNAL_SERVER_ERROR,
      message: '服务器内部错误',
      data: null,
      timestamp: new Date().toISOString(),
    });
  }
}
