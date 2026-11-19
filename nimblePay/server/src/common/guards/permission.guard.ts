import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERM_KEY } from '../decorators/auth';
import { ApiException } from '../api-exception';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const perm = this.reflector.getAllAndOverride<string>(PERM_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!perm) return true;
    const admin = ctx.switchToHttp().getRequest().admin;
    if (!admin) throw ApiException.unauthorized();
    if (admin.isSuperAdmin || admin.permissions.includes('*') || admin.permissions.includes(perm)) {
      return true;
    }
    throw ApiException.forbidden();
  }
}
