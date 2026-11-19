import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { DistributorGuard } from '../../common/guards/distributor.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { AuthUser } from '../../common/types/auth-user';
import { USAGE_RANGES, UsageRange } from '../billing/bill.service';
import { DistributorService } from './distributor.service';

class AppointSubDto {
  @Type(() => Number)
  @IsInt()
  userId: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionPercent: number;
}

class UpdateSubDto {
  @IsOptional()
  @IsBoolean()
  isDistributor?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionPercent?: number;
}

class DistributorQueryDto {
  @IsOptional()
  @IsIn(Object.keys(USAGE_RANGES))
  range?: UsageRange;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/** 分销商后台：只能看自己名下的数据，身份由 DistributorGuard 判断 */
@Controller('distributor')
@UseGuards(DistributorGuard)
export class DistributorController {
  constructor(private readonly distributor: DistributorService) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthUser, @Query() q: DistributorQueryDto) {
    return this.distributor.overview(user.userId, q.range ?? '30d');
  }

  @Get('users')
  members(@CurrentUser() user: AuthUser, @Query() q: DistributorQueryDto) {
    return this.distributor.members(user.userId, q.page ?? 1, q.pageSize ?? 20);
  }

  @Get('pricing')
  pricing() {
    return this.distributor.pricing();
  }

  /** 一级的下级。二级会被拒绝，页面上也不出现这个入口 */
  @Get('subordinates')
  subordinates(@CurrentUser() user: AuthUser) {
    return this.distributor.subordinates(user.userId);
  }

  @Post('subordinates')
  appoint(@CurrentUser() user: AuthUser, @Body() dto: AppointSubDto) {
    return this.distributor.appoint(user.userId, dto.userId, dto.commissionPercent);
  }

  @Patch('subordinates/:id')
  updateSub(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSubDto) {
    return this.distributor.updateSubordinate(user.userId, id, dto);
  }
}

/** 管理员查看全部分销商的业绩；任命和调整佣金比例在用户管理里（PATCH admin/users/:id/distributor） */
@Controller('admin/distributors')
@UseGuards(PlatformAdminGuard)
export class AdminDistributorController {
  constructor(private readonly distributor: DistributorService) {}

  @Get()
  list() {
    return this.distributor.list();
  }
}
