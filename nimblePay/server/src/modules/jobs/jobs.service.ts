import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { errorMessage } from '../../common/api-exception';
import { RedisService } from '../../infra/redis/redis.service';
import { DivisionService } from '../division/division.service';
import { PaymentService } from '../payment/payment.service';
import { RefundService } from '../refund/refund.service';
import { TransferService } from '../transfer/transfer.service';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly payment: PaymentService,
    private readonly refunds: RefundService,
    private readonly transfers: TransferService,
    private readonly division: DivisionService,
  ) {}

  @Cron('*/30 * * * * *')
  paying() {
    return this.run('pay-query', 25, () => this.payment.queryPaying());
  }

  @Cron('*/60 * * * * *')
  expire() {
    return this.run('pay-expire', 50, () => this.payment.expirePaying());
  }

  @Cron('*/60 * * * * *')
  refundsJob() {
    return this.run('refund-query', 50, () => this.refunds.syncProcessing());
  }

  @Cron('*/60 * * * * *')
  transfersJob() {
    return this.run('transfer-query', 50, () => this.transfers.syncProcessing());
  }

  @Cron('*/90 * * * * *')
  divisionJob() {
    return this.run('division-retry', 50, () => this.division.retryFailed());
  }

  private async run(name: string, ttl: number, fn: () => Promise<unknown>) {
    const ok = await this.redis.setNx(`lock:${name}`, '1', ttl);
    if (!ok) return;
    try {
      await fn();
    } catch (e) {
      this.logger.warn(`${name} ${errorMessage(e)}`);
    }
  }
}
