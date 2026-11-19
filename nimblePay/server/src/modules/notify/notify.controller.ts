import { Controller, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { PUBLIC_PAY_PREFIX } from '../../common/constants';
import { PaymentService } from '../payment/payment.service';
import { RefundService } from '../refund/refund.service';
import { TransferService } from '../transfer/transfer.service';

@Controller(`${PUBLIC_PAY_PREFIX}/notify/alipay`)
export class NotifyController {
  constructor(
    private readonly payment: PaymentService,
    private readonly refunds: RefundService,
    private readonly transfers: TransferService,
  ) {}

  @Post('pay')
  async pay(@Req() req: Request, @Res() res: Response) {
    await this.payment.handleAlipayNotify((req.body || {}) as Record<string, string>);
    res.status(200).contentType('text/plain; charset=utf-8').send('success');
  }

  @Post('refund')
  async refund(@Req() req: Request, @Res() res: Response) {
    await this.refunds.handleNotify((req.body || {}) as Record<string, string>);
    res.status(200).contentType('text/plain; charset=utf-8').send('success');
  }

  @Post('transfer')
  async transfer(@Req() req: Request, @Res() res: Response) {
    await this.transfers.handleNotify((req.body || {}) as Record<string, string>);
    res.status(200).contentType('text/plain; charset=utf-8').send('success');
  }
}
