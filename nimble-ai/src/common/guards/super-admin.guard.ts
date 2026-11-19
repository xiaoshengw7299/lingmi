import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../modules/user/entities/user.entity';

/**
 * 只有默认管理员能过，用于任命 / 取消管理员和分销商。
 * 直接查库而不看令牌里的声明：这类操作很少，多一次查询换来的是权限变更立刻生效。
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const userId = context.switchToHttp().getRequest().user?.userId;
    const ok = userId && (await this.users.exist({ where: { id: userId, isSuperAdmin: true } }));
    if (!ok) throw new ForbiddenException('只有默认管理员可以执行此操作');
    return true;
  }
}
