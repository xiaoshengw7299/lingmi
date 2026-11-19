import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable, tap } from 'rxjs';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { isApiRoute } from '../constants';
import { AuditLog } from '../../entities';

const SENSITIVE = /password|secret|privatekey|cert|token|credential/i;

function sanitize(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const clone: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const k of Object.keys(clone)) {
    if (SENSITIVE.test(k)) clone[k] = '***';
  }
  const text = JSON.stringify(clone);
  return text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(@InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const path = String(req.originalUrl || '');
    if (!isApiRoute(path, 'admin') || req.method === 'GET') return next.handle();
    return next.handle().pipe(
      tap({
        next: () => void this.write(req, 200),
        error: (err: { status?: number }) => void this.write(req, err?.status ?? 500),
      }),
    );
  }

  private async write(req: Request, status: number) {
    try {
      await this.logs.save(
        this.logs.create({
          userId: req.admin?.id,
          username: req.admin?.username ?? '',
          ip: String(req.headers?.['x-forwarded-for'] ?? req.ip ?? ''),
          method: req.method,
          path: req.originalUrl,
          action: `${req.method} ${req.originalUrl.split('?')[0]}`,
          status,
          reqBody: sanitize(req.body),
        }),
      );
    } catch {
      // 审计失败不影响主流程
    }
  }
}
