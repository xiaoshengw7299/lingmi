import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PayModule } from '../pay/pay.module';
import { User } from '../user/entities/user.entity';
import { UserModule } from '../user/user.module';
import { AdminDistributorController, DistributorController } from './distributor.controller';
import { DistributorService } from './distributor.service';

/** 分销：分销商的专属链接、名下用户和业绩统计。计费、定价模块是全局的，不用再导入 */
@Module({
  imports: [PayModule, UserModule, TypeOrmModule.forFeature([User])],
  controllers: [DistributorController, AdminDistributorController],
  providers: [DistributorService],
})
export class DistributorModule {}
