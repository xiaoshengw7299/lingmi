import { applyDecorators, CanActivate, ExecutionContext, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from '../../common/types/auth-user';
import { BillingService } from './billing.service';

const KEY = 'billing:min-balance';

/** 整条流水线（一键成片）开工前的最低余额：1 元。流水线中途余额耗尽会停在当前一步 */
export const PIPELINE_MIN_BALANCE_CENTS = 100;

/**
 * 标在会触发生成的接口上：余额不够直接 402，别等任务排上队再失败。
 * minCents 默认 1 分，即只要不是零余额；一键成片这类整条流水线建议传大一点。
 */
export const RequireBalance = (minCents = 1) => applyDecorators(SetMetadata(KEY, minCents), UseGuards(BalanceGuard));

@Injectable()
export class BalanceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly billing: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const min = this.reflector.get<number>(KEY, context.getHandler());
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (min !== undefined && user) await this.billing.assertCanSpend(user.userId, min);
    return true;
  }
}
