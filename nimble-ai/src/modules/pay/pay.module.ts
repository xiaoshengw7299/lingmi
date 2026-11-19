import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../user/entities/user.entity';
import { PayClientService } from './pay-client.service';
import { PayController } from './pay.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [PayController],
  providers: [PayClientService, WalletService],
  exports: [PayClientService, WalletService],
})
export class PayModule {}
