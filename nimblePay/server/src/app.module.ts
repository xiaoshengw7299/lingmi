import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { RedisModule } from './infra/redis/redis.module';
import jwtConfig from './config/jwt.config';
import { AlipayModule } from './infra/alipay/alipay.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { BootstrapService } from './modules/bootstrap/bootstrap.service';
import { OpenAppService } from './modules/open-app/open-app.service';
import { WalletService } from './modules/wallet/wallet.service';
import { PaymentService } from './modules/payment/payment.service';
import { PayPageController } from './modules/payment/pay-page.controller';
import { RefundService } from './modules/refund/refund.service';
import { TransferService } from './modules/transfer/transfer.service';
import { DivisionService } from './modules/division/division.service';
import { ReconService } from './modules/recon/recon.service';
import { ChannelConfigService } from './modules/channel-config/channel-config.service';
import { IamService } from './modules/iam/iam.service';
import { JobsService } from './modules/jobs/jobs.service';
import { OpenApiController } from './modules/open-api/open-api.controller';
import { NotifyController } from './modules/notify/notify.controller';
import { HealthController } from './health.controller';
import {
  AdminAuthController,
  AuditAdminController,
  ConfigAdminController,
  DashboardController,
  DivisionAdminController,
  IamAdminController,
  OrderAdminController,
  ReconAdminController,
  RefundAdminController,
  TransferAdminController,
  WalletAdminController,
} from './modules/admin/admin.controllers';
import { AdminAuthGuard } from './common/guards/auth.guard';
import { OpenAppGuard } from './common/guards/open-app.guard';
import { PermissionGuard } from './common/guards/permission.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'production' ? '.env.production' : '.env',
      load: [jwtConfig],
    }),
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        host: config.get('REDIS_HOST', '127.0.0.1'),
        port: Number(config.get('REDIS_PORT', 6379)),
        password: config.get('REDIS_PASSWORD') || undefined,
        db: Number(config.get('REDIS_DB', 0)),
      }),
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: { expiresIn: config.get('jwt.accessExpires', '2h') },
      }),
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    CryptoModule,
    AlipayModule,
  ],
  controllers: [
    HealthController,
    PayPageController,
    NotifyController,
    OpenApiController,
    AdminAuthController,
    DashboardController,
    WalletAdminController,
    OrderAdminController,
    RefundAdminController,
    TransferAdminController,
    DivisionAdminController,
    ReconAdminController,
    ConfigAdminController,
    IamAdminController,
    AuditAdminController,
  ],
  providers: [
    BootstrapService,
    OpenAppService,
    WalletService,
    PaymentService,
    RefundService,
    TransferService,
    DivisionService,
    ReconService,
    ChannelConfigService,
    IamService,
    JobsService,
    AdminAuthGuard,
    OpenAppGuard,
    PermissionGuard,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
