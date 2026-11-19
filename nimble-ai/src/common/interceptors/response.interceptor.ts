import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ResponseDto } from '../dto/response.dto';

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ResponseDto<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ResponseDto<T>> {
    return next.handle().pipe(
      map((data) => {
        // 素材预览这类接口已经自己把流写进响应，不能再包一层 JSON
        const res = context.switchToHttp().getResponse<{ headersSent?: boolean }>();
        if (res?.headersSent) return data as ResponseDto<T>;
        if (ResponseDto.isWrapped(data)) {
          return data as ResponseDto<T>;
        }
        return ResponseDto.success(data ?? null);
      }),
    );
  }
}
