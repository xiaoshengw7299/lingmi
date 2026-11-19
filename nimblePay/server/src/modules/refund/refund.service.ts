import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, MoreThan, Repository } from 'typeorm';
import { ApiException, errorMessage, isAlipayTradeMissing, isTransientAlipayError } from '../../common/api-exception';
import { paging, PageQueryDto } from '../../common/dto/page.dto';
import { genNo } from '../../common/ids';
import { amountMatches, assertCents } from '../../common/money';
import { PayOrder, RefundOrder } from '../../entities';
import { AlipayNotifyPayload, AlipayService } from '../../infra/alipay/alipay.service';
import { RedisService } from '../../infra/redis/redis.service';
import { DivisionService } from '../division/division.service';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(RefundOrder) private readonly refunds: Repository<RefundOrder>,
    @InjectRepository(PayOrder) private readonly orders: Repository<PayOrder>,
    private readonly alipay: AlipayService,
    private readonly redis: RedisService,
    private readonly wallet: WalletService,
    private readonly division: DivisionService,
  ) {}

  async create(input: { orderNo: string; amountCents?: number; reason: string; operatorId: string }) {
    return this.redis.withLock(`refund:${input.orderNo}`, 30, async () => {
      const order = await this.orders.findOne({ where: { orderNo: input.orderNo } });
      if (!order) throw ApiException.notFound('支付订单不存在');
      if (order.status !== 'SUCCESS' && order.status !== 'REFUNDED') throw ApiException.bad('仅成功订单可退款');
      const inflight = await this.refunds
        .createQueryBuilder('r')
        .select('COALESCE(SUM(r.amountCents), 0)', 'sum')
        .where('r.payOrderId = :id AND r.status IN (:...st)', { id: order.id, st: ['PROCESSING', 'CREATED'] })
        .getRawOne<{ sum: string }>();
      const occupied = Number(inflight?.sum || 0);
      const remain = order.amountCents - order.refundedCents;
      const amount = input.amountCents ?? remain - occupied;
      assertCents(amount, 1);
      if (amount > remain - occupied) throw ApiException.bad('退款金额超过可退余额（含处理中的退款）');
      if (order.divisionState === 'ING') throw ApiException.bad('分账进行中，请待分账完成或失败后再退款');

      const royalty = await this.division.royaltyForRefund(order.id, amount);
      const royaltySum = royalty.reduce((s, x) => s + x.amountCents, 0);
      if (royaltySum > amount) throw ApiException.bad('退分账金额超过本次退款额');

      const refund = await this.dataSource.transaction(async (tx) => {
        const row = await tx.save(
          tx.create(RefundOrder, {
            refundNo: genNo('NR'),
            payOrderId: order.id,
            appId: order.appId,
            userId: order.userId,
            amountCents: amount,
            reason: input.reason || '充值退款',
            status: 'PROCESSING',
            operatorId: input.operatorId,
            balanceHeld: !order.testPay,
          }),
        );
        await this.wallet.holdRefund(tx, order.userId, row.id, amount, order.testPay);
        return row;
      });

      try {
        const resp = await this.alipay.refund({
          orderNo: order.orderNo,
          refundNo: refund.refundNo,
          amountCents: amount,
          reason: input.reason || '充值退款',
          tradeNo: order.channelTradeNo,
          royalty,
        });
        if (resp.refund_fee && !amountMatches(amount, resp.refund_fee)) {
          this.logger.warn(`refund fee mismatch ${refund.refundNo}`);
        }
        await this.markSuccess(refund.id, order.id, JSON.stringify(resp));
        return this.refunds.findOneByOrFail({ id: refund.id });
      } catch (e) {
        const msg = errorMessage(e);
        if (isTransientAlipayError(e)) {
          await this.refunds.update({ id: refund.id }, { status: 'PROCESSING', channelResp: msg });
          return this.refunds.findOneByOrFail({ id: refund.id });
        }
        await this.failAndRestore(refund.id, msg);
        throw e;
      }
    });
  }

  async handleNotify(payload: AlipayNotifyPayload) {
    const ok = await this.alipay.verifyNotify(payload);
    if (!ok) throw ApiException.bad('退款通知验签失败');
    const refundNo = payload.out_request_no || payload.out_biz_no;
    if (!refundNo) throw ApiException.bad('通知缺少退款单号');
    const refund = await this.refunds.findOne({ where: { refundNo } });
    if (!refund) throw ApiException.notFound('退款单不存在');
    if (isRefundFailed(payload)) {
      await this.failAndRestore(refund.id, JSON.stringify(payload));
      return;
    }
    if (!isRefundSuccess(payload)) return;
    if (payload.refund_fee && !amountMatches(refund.amountCents, payload.refund_fee)) {
      throw ApiException.bad('退款通知金额与本地不一致');
    }
    await this.markSuccess(refund.id, refund.payOrderId, JSON.stringify(payload));
  }

  async markSuccess(refundId: string, payOrderId: string, channelResp: string) {
    await this.dataSource.transaction(async (tx) => {
      const updated = await tx.update(RefundOrder, { id: refundId, status: In(['CREATED', 'PROCESSING', 'FAIL']) }, {
        status: 'SUCCESS',
        channelResp,
        notifyPayload: channelResp,
        succeedAt: new Date(),
      });
      if (!updated.affected) return;
      const refund = await tx.findOneByOrFail(RefundOrder, { id: refundId });
      const order = await tx.findOne(PayOrder, { where: { id: payOrderId }, lock: { mode: 'pessimistic_write' } });
      if (!order) throw ApiException.notFound('支付订单不存在');
      const refundedCents = order.refundedCents + refund.amountCents;
      if (refundedCents > order.amountCents) throw ApiException.bad('累计退款超过订单金额');
      order.refundedCents = refundedCents;
      order.refundState = refundedCents >= order.amountCents ? 'FULL' : 'PARTIAL';
      order.status = order.refundState === 'FULL' ? 'REFUNDED' : 'SUCCESS';
      await tx.save(order);
    });
  }

  private async failAndRestore(refundId: string, channelResp: string) {
    await this.dataSource.transaction(async (tx) => {
      const refund = await tx.findOne(RefundOrder, { where: { id: refundId }, lock: { mode: 'pessimistic_write' } });
      if (!refund || refund.status === 'SUCCESS') return;
      const order = await tx.findOneBy(PayOrder, { id: refund.payOrderId });
      refund.status = 'FAIL';
      refund.channelResp = channelResp;
      await tx.save(refund);
      if (order) await this.wallet.restoreRefund(tx, refund.userId, refund.id, refund.amountCents, order.testPay);
    });
  }

  async sync(refundNo: string) {
    const refund = await this.refunds.findOne({ where: { refundNo }, relations: { payOrder: true } });
    if (!refund) throw ApiException.notFound('退款单不存在');
    if (refund.status === 'SUCCESS') return refund;
    try {
      const resp = await this.alipay.queryRefund(refund.payOrder.orderNo, refund.refundNo);
      if (resp.refund_status === 'REFUND_SUCCESS') {
        if (resp.refund_amount && !amountMatches(refund.amountCents, resp.refund_amount)) {
          throw ApiException.bad('渠道退款金额与本地不一致');
        }
        await this.markSuccess(refund.id, refund.payOrderId, JSON.stringify(resp));
      } else if (isRefundStatusFailed(resp.refund_status)) {
        await this.failAndRestore(refund.id, JSON.stringify(resp));
      }
    } catch (e) {
      if (!isAlipayTradeMissing(e)) throw e;
      const age = Date.now() - new Date(refund.createdAt).getTime();
      if (age > 3 * 60 * 1000 && refund.status !== 'SUCCESS') {
        await this.failAndRestore(refund.id, '渠道无此退款，已退回预扣余额');
      }
    }
    return this.refunds.findOneByOrFail({ refundNo });
  }

  async page(q: PageQueryDto & { keyword?: string }) {
    const p = paging(q);
    const qb = this.refunds
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.payOrder', 'o')
      .leftJoinAndSelect('r.user', 'u')
      .orderBy('r.createdAt', 'DESC');
    if (q.keyword) {
      qb.where('r.refundNo ILIKE :k OR o.orderNo ILIKE :k', { k: `%${q.keyword}%` });
    }
    const [items, total] = await qb.skip(p.skip).take(p.take).getManyAndCount();
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  async syncProcessing() {
    const since = new Date(Date.now() - 48 * 3600 * 1000);
    const list = await this.refunds.find({
      where: [{ status: In(['PROCESSING', 'CREATED']) }, { status: 'FAIL', updatedAt: MoreThan(since) }],
      take: 20,
    });
    for (const r of list) {
      try {
        await this.sync(r.refundNo);
      } catch (e) {
        this.logger.warn(`refund query ${r.refundNo} ${errorMessage(e)}`);
      }
    }
  }
}

function isRefundSuccess(payload: AlipayNotifyPayload) {
  if (payload.refund_status === 'REFUND_SUCCESS') return true;
  if (payload.gmt_refund) return true;
  return false;
}

function isRefundFailed(payload: AlipayNotifyPayload) {
  if (isRefundSuccess(payload)) return false;
  return isRefundStatusFailed(payload.refund_status) || isRefundStatusFailed(payload.status);
}

function isRefundStatusFailed(status?: string) {
  const st = (status || '').toUpperCase();
  return st === 'REFUND_FAIL' || st === 'FAIL' || st === 'FAILED';
}
