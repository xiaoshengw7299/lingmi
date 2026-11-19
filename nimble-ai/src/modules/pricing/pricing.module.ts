import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModelQuote } from './entities/model-quote.entity';
import { PricingRule } from './entities/pricing-rule.entity';
import { PriceBoardService } from './price-board.service';
import { AdminPricingController, PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

/** 定价中心。全局模块：Atlas 客户端、计费、各业务页都要用到价格 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([PricingRule, ModelQuote])],
  controllers: [PricingController, AdminPricingController],
  providers: [PricingService, PriceBoardService],
  exports: [PricingService, PriceBoardService],
})
export class PricingModule {}
