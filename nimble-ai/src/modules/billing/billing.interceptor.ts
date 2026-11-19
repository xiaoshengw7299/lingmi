import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthUser } from '../../common/types/auth-user';
import { runWithBilling } from './billing-context';

/** 登录用户的 HTTP 请求自动带上计费上下文，请求里触发的所有生成都记在这个用户名下 */
@Injectable()
export class BillingContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user) return next.handle();
    // 控制器在订阅时才执行，必须在上下文里订阅，后续异步调用才拿得到 userId
    return new Observable((subscriber) => {
      runWithBilling(user.userId, () => next.handle().subscribe(subscriber));
    });
  }
}
