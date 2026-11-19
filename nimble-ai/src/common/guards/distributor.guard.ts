import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../modules/user/entities/user.entity';

/** 分销后台的入口。分销状态直接查库，不进令牌：任命和取消立刻生效，不用对方重新登录 */
@Injectable()
export class DistributorGuard implements CanActivate {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const userId = context.switchToHttp().getRequest().user?.userId;
    if (!userId || !(await this.users.exist({ where: { id: userId, isDistributor: true } }))) {
      throw new ForbiddenException('需要分销商权限');
    }
    return true;
  }
}
