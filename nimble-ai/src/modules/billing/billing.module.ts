import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PayModule } from '../pay/pay.module';
import { User } from '../user/entities/user.entity';
import { BillController } from './bill.controller';
import { BillService } from './bill.service';
import { BillingContextInterceptor } from './billing.interceptor';
import { BillingService } from './billing.service';
import { UsageLog } from './entities/usage-log.entity';
import { BalanceGuard } from './require-balance';

/** 计费与账单。全局模块：Atlas 客户端、文本模型和各业务接口都会用到，统计与分销按 BillService 取账单 */
@Global()
@Module({
  imports: [PayModule, TypeOrmModule.forFeature([UsageLog, User])],
  controllers: [BillController],
  providers: [BillingService, BillService, BalanceGuard, { provide: APP_INTERCEPTOR, useClass: BillingContextInterceptor }],
  exports: [BillingService, BillService, BalanceGuard],
})
export class BillingModule {}
