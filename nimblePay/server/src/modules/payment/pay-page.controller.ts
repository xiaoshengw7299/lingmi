import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { PUBLIC_PAY_PREFIX } from '../../common/constants';
import { flattenQuery } from './pay-page.view';
import { PaymentService } from './payment.service';

@Controller(`${PUBLIC_PAY_PREFIX}/pay`)
export class PayPageController {
  constructor(private readonly payment: PaymentService) {}

  @Get('go/:token')
  async go(@Param('token') token: string, @Res() res: Response) {
    const html = await this.payment.cashierHtml(token);
    res.status(200).contentType('text/html; charset=utf-8').send(html);
  }

  @Get('return')
  async back(@Query() query: Record<string, unknown>, @Res() res: Response) {
    const html = await this.payment.returnHtml(flattenQuery(query));
    res.status(200).contentType('text/html; charset=utf-8').send(html);
  }
}
