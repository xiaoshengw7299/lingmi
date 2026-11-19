import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { isApiRoute, PUBLIC_PAY_PREFIX } from '../constants';

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    if (isApiRoute(req.originalUrl, `${PUBLIC_PAY_PREFIX}/notify`) || isApiRoute(req.originalUrl, `${PUBLIC_PAY_PREFIX}/pay`)) {
      return next.handle();
    }
    return next.handle().pipe(
      map((data) => {
        if (data && typeof data === 'object' && 'code' in data && 'message' in data && 'data' in data) return data;
        return { code: 200, message: '操作成功', data: data ?? null, timestamp: new Date().toISOString() };
      }),
    );
  }
}
