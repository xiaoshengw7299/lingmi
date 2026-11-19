import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { Request } from 'express';
import { CurrentOpenApp } from '../../common/decorators/current-user';
import { PageQueryDto } from '../../common/dto/page.dto';
import { OpenAppGuard } from '../../common/guards/open-app.guard';
import { PaymentService } from '../payment/payment.service';
import { WalletService } from '../wallet/wallet.service';

class EnsureDto {
  @IsString() @MinLength(1) externalUserId: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() nickname?: string;
  /** 邀请人的 externalUserId，只在开户或首充前生效 */
  @IsOptional() @IsString() inviterExternalUserId?: string;
}

class RechargeDto extends EnsureDto {
  @Type(() => Number) @IsInt() @Min(1) amountCents: number;
  @IsString() @MinLength(6) clientOrderNo: string;
  @IsOptional() @IsString() clientIp?: string;
}

class ConsumeDto {
  @IsString() @MinLength(1) externalUserId: string;
  @Type(() => Number) @IsInt() @Min(1) amountCents: number;
  /** 业务幂等号，同一个只扣一次，退回时也靠它定位 */
  @IsString() @MinLength(6) bizNo: string;
  @IsOptional() @IsString() remark?: string;
  /** 余额不足时扣到 0，不报错。事后按用量结算时使用 */
  @IsOptional() @IsBoolean() partial?: boolean;
}

class SummariesDto {
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) externalUserIds: string[];
}

class GrantDto {
  @IsString() @MinLength(1) externalUserId: string;
  @Type(() => Number) @IsInt() @Min(1) amountCents: number;
  @IsString() @MinLength(6) bizNo: string;
  @IsOptional() @IsString() remark?: string;
}

class ConsumeRefundDto {
  @IsString() @MinLength(1) externalUserId: string;
  @IsString() @MinLength(6) bizNo: string;
}

@Controller('open/v1')
@UseGuards(OpenAppGuard)
export class OpenApiController {
  constructor(
    private readonly wallet: WalletService,
    private readonly payment: PaymentService,
  ) {}

  @Post('wallet/ensure')
  ensure(@Body() dto: EnsureDto) {
    return this.wallet.ensure(dto);
  }

  @Get('wallet/:externalUserId')
  async walletOf(@Param('externalUserId') externalUserId: string) {
    const user = await this.wallet.byExternal(externalUserId);
    return this.wallet.publicUser(user);
  }

  @Post('wallet/summaries')
  summaries(@Body() dto: SummariesDto) {
    return this.wallet.summaries(dto.externalUserIds);
  }

  /** 平台统计页用的充值汇总（不含测试单） */
  @Get('stats')
  stats() {
    return this.payment.stats();
  }

  /** 业务奖励入账，同一 bizNo 只记一次 */
  @Post('wallet/grant')
  grant(@Body() dto: GrantDto) {
    return this.wallet.grant(dto);
  }

  @Post('wallet/consume')
  consume(@Body() dto: ConsumeDto) {
    return this.wallet.consume(dto);
  }

  @Post('wallet/consume/refund')
  refundConsume(@Body() dto: ConsumeRefundDto) {
    return this.wallet.refundConsume(dto.externalUserId, dto.bizNo);
  }

  @Get('wallet/:externalUserId/ledgers')
  ledgers(@Param('externalUserId') externalUserId: string, @Query() q: PageQueryDto) {
    return this.wallet.ledgerPage(externalUserId, q);
  }

  /** 奖励规则，不涉及具体用户。nimble 首页的活动横幅用 */
  @Get('reward-rule')
  rewardRule() {
    return this.wallet.rewardRule();
  }

  @Get('referral/:externalUserId')
  referral(@Param('externalUserId') externalUserId: string, @Query() q: PageQueryDto) {
    return this.wallet.referralOverview(externalUserId, q);
  }

  @Post('pay/recharge')
  recharge(
    @Body() dto: RechargeDto,
    @CurrentOpenApp() app: Express.Request['openApp'],
    @Req() req: Request,
  ) {
    return this.payment.create({
      appId: app!.appId,
      externalUserId: dto.externalUserId,
      amountCents: dto.amountCents,
      clientOrderNo: dto.clientOrderNo,
      email: dto.email,
      nickname: dto.nickname,
      clientIp: dto.clientIp || req.ip,
    });
  }

  @Get('pay/orders/:orderNo')
  order(
    @Param('orderNo') orderNo: string,
    @Query('externalUserId') externalUserId: string,
    @CurrentOpenApp() app: Express.Request['openApp'],
  ) {
    return this.payment.getByNo(orderNo, externalUserId, app!.appId);
  }

  @Post('pay/orders/:orderNo/close')
  close(@Param('orderNo') orderNo: string, @Body() dto: EnsureDto) {
    return this.payment.close(orderNo, dto.externalUserId);
  }
}
