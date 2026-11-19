import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { ApiException } from '../api-exception';
import { SysUser } from '../../entities';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(SysUser) private readonly users: Repository<SysUser>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = bearer(req);
    if (!token) throw ApiException.unauthorized();
    let payload: { sub: string; typ: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw ApiException.unauthorized();
    }
    if (payload.typ !== 'admin') throw ApiException.unauthorized();
    const user = await this.users.findOne({
      where: { id: payload.sub },
      relations: { roles: { role: { permissions: { permission: true } } } },
    });
    if (!user || user.status !== 'ACTIVE') throw ApiException.unauthorized('账号已停用');
    const permissions = user.isSuperAdmin
      ? ['*']
      : [...new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)))];
    req.admin = { id: user.id, username: user.username, isSuperAdmin: user.isSuperAdmin, permissions };
    return true;
  }
}

export function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7);
}
