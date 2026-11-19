import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit } from '../../common/guards/rate-limit.guard';
import { AuthUser } from '../../common/types/auth-user';
import { WalletService } from './wallet.service';

class RechargeDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(50000)
  amountYuan: number;

  @IsOptional()
  @IsString()
  clientOrderNo?: string;
}

class PageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;
}

@Controller('wallet')
export class PayController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  overview(@CurrentUser() user: AuthUser) {
    return this.wallet.overview(user.userId);
  }

  @Public()
  @Get('promo')
  promo() {
    return this.wallet.promo();
  }

  /** 按用户限流：支付服务的下单限流是全应用共用的，不拦的话一个用户刷接口会让所有人下不了单 */
  @Post('recharge')
  @RateLimit(10)
  recharge(@CurrentUser() user: AuthUser, @Body() dto: RechargeDto) {
    return this.wallet.recharge(user.userId, dto.amountYuan, dto.clientOrderNo);
  }

  @Get('orders/:orderNo')
  order(@CurrentUser() user: AuthUser, @Param('orderNo') orderNo: string) {
    return this.wallet.order(user.userId, orderNo);
  }

  @Get('ledgers')
  ledgers(@CurrentUser() user: AuthUser, @Query() q: PageDto) {
    return this.wallet.ledgers(user.userId, q.page ?? 1, q.pageSize ?? 20);
  }

  @Get('referral')
  referral(@CurrentUser() user: AuthUser, @Query() q: PageDto) {
    return this.wallet.referral(user.userId, q.page ?? 1, q.pageSize ?? 10);
  }
}
