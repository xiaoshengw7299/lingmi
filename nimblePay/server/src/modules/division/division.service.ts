import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ApiException, errorMessage, isTransientAlipayError } from '../../common/api-exception';
import { PAY_SCENE_PAGE } from '../../common/constants';
import { paging, PageQueryDto } from '../../common/dto/page.dto';
import { genNo } from '../../common/ids';
import { alipayAccountType, alipayIdentityType, assertAlipayIdentity, assertBps } from '../../common/money';
import { DivisionReceiver, DivisionRecord, PayOrder } from '../../entities';
import { AlipayService } from '../../infra/alipay/alipay.service';
import { RedisService } from '../../infra/redis/redis.service';

@Injectable()
export class DivisionService {
  private readonly logger = new Logger(DivisionService.name);

  constructor(
    @InjectRepository(DivisionReceiver) private readonly receivers: Repository<DivisionReceiver>,
    @InjectRepository(DivisionRecord) private readonly records: Repository<DivisionRecord>,
    @InjectRepository(PayOrder) private readonly orders: Repository<PayOrder>,
    private readonly alipay: AlipayService,
    private readonly redis: RedisService,
  ) {}

  activeReceivers() {
    return this.receivers.find({ where: { enabled: true, bindStatus: 'BOUND' } });
  }

  async royaltyForRefund(payOrderId: string, refundCents: number) {
    const order = await this.orders.findOne({ where: { id: payOrderId } });
    if (!order || order.divisionState !== 'FINISH' || order.amountCents <= 0) return [];
    const rows = await this.records.find({
      where: { payOrderId, status: 'FINISH' },
      relations: { receiver: true },
    });
    const already = order.refundedCents;
    return rows
      .map((r) => {
        const taken = Math.floor((already * r.amountCents) / order.amountCents);
        const next = Math.min(r.amountCents, Math.floor(((already + refundCents) * r.amountCents) / order.amountCents));
        return { account: r.receiver.accountNo, amountCents: Math.max(0, next - taken) };
      })
      .filter((x) => x.amountCents > 0);
  }

  pageReceivers() {
    return this.receivers.find({ order: { createdAt: 'ASC' } });
  }

  async createReceiver(input: { name: string; accountNo: string; accountName: string; ratioBps: number; remark?: string }) {
    const accountNo = input.accountNo.trim();
    const accountName = input.accountName.trim();
    const name = input.name.trim();
    if (!name || !accountName) throw ApiException.bad('名称和真实姓名不能为空');
    assertAlipayIdentity(alipayIdentityType(accountNo), accountNo);
    assertBps(input.ratioBps);
    const dup = await this.receivers.findOne({ where: { accountNo, enabled: true } });
    if (dup) throw ApiException.bad('该支付宝账号已作为启用中的分账接收方');
    await this.assertTotalBps(input.ratioBps);
    const row = await this.receivers.save(
      this.receivers.create({
        name,
        accountNo,
        accountName,
        accountType: alipayAccountType(accountNo),
        ratioBps: input.ratioBps,
        remark: input.remark || '',
      }),
    );
    return this.bind(row.id);
  }

  async updateReceiver(id: string, input: Partial<{ name: string; ratioBps: number; enabled: boolean; remark: string }>) {
    const row = await this.receivers.findOne({ where: { id } });
    if (!row) throw ApiException.notFound();
    if (input.ratioBps != null) assertBps(input.ratioBps);
    const nextEnabled = input.enabled ?? row.enabled;
    const nextBps = input.ratioBps ?? row.ratioBps;
    if (nextEnabled) await this.assertTotalBps(nextBps, id);
    Object.assign(row, input);
    return this.receivers.save(row);
  }

  async bind(id: string) {
    const row = await this.receivers.findOne({ where: { id } });
    if (!row) throw ApiException.notFound();
    try {
      const resp = await this.alipay.bindReceivers(genNo('NB'), [{ account: row.accountNo, name: row.accountName }]);
      row.bindStatus = 'BOUND';
      row.accountType = alipayAccountType(row.accountNo);
      row.bindResp = JSON.stringify(resp);
      return this.receivers.save(row);
    } catch (e) {
      row.bindStatus = 'PENDING';
      row.bindResp = errorMessage(e);
      await this.receivers.save(row);
      throw e;
    }
  }

  async unbind(id: string) {
    const row = await this.receivers.findOne({ where: { id } });
    if (!row) throw ApiException.notFound();
    const resp = await this.alipay.unbindReceivers(genNo('NU'), [{ account: row.accountNo, name: row.accountName }]);
    row.bindStatus = 'DISABLED';
    row.enabled = false;
    row.bindResp = JSON.stringify(resp);
    return this.receivers.save(row);
  }

  async execByOrderNo(orderNo: string) {
    const order = await this.orders.findOne({ where: { orderNo } });
    if (!order) throw ApiException.notFound('订单不存在');
    return this.execForOrder(order.id);
  }

  async execForOrder(payOrderId: string) {
    return this.redis.withLock(`div:${payOrderId}`, 30, async () => {
      const order = await this.orders.findOne({ where: { id: payOrderId } });
      if (!order) throw ApiException.notFound('订单不存在');
      if (order.status !== 'SUCCESS') throw ApiException.bad('仅成功订单可分账');
      if (order.divisionMode === 'FORBID') throw ApiException.bad('该订单不允许分账');
      if (order.divisionState === 'FINISH') return { skipped: true };
      if (!order.channelTradeNo) throw ApiException.bad('缺少支付宝交易号');

      const existing = await this.records.find({
        where: { payOrderId: order.id },
        relations: { receiver: true },
        order: { createdAt: 'DESC' },
      });
      if (existing.length) {
        const batchNo = existing[0].batchNo;
        const same = existing.filter((x) => x.batchNo === batchNo);
        if (same.every((x) => x.status === 'FINISH')) {
          await this.orders.update({ id: order.id }, { divisionState: 'FINISH' });
          return { skipped: true, reason: 'already-finished' };
        }
        if (same.some((x) => x.status === 'FINISH')) return this.queryBatch(batchNo);
        return this.settleExisting(order.channelTradeNo, same);
      }

      const receivers = await this.activeReceivers();
      if (!receivers.length) {
        await this.orders.update({ id: order.id }, { divisionState: 'NONE' });
        return { skipped: true, reason: 'no-receiver' };
      }
      const totalBps = receivers.reduce((s, r) => s + r.ratioBps, 0);
      if (totalBps > 10000) throw ApiException.bad('分账比例合计不能超过 100%');
      const batchNo = genNo('ND');
      const items = receivers
        .map((r) => ({ receiver: r, amountCents: Math.floor((order.amountCents * r.ratioBps) / 10000) }))
        .filter((x) => x.amountCents > 0);
      if (!items.length) {
        await this.orders.update({ id: order.id }, { divisionState: 'NONE' });
        return { skipped: true, reason: 'zero-amount' };
      }
      await this.orders.update({ id: order.id }, { divisionState: 'ING' });
      await this.records.save(
        items.map((x) =>
          this.records.create({
            batchNo,
            payOrderId: order.id,
            receiverId: x.receiver.id,
            amountCents: x.amountCents,
            status: 'ING',
          }),
        ),
      );
      const created = await this.records.find({ where: { batchNo }, relations: { receiver: true } });
      return this.settleExisting(order.channelTradeNo, created);
    });
  }

  async queryBatch(batchNo: string) {
    const records = await this.records.find({ where: { batchNo }, relations: { payOrder: true, receiver: true } });
    if (!records.length) throw ApiException.notFound('分账批次不存在');
    const order = records[0].payOrder;
    const resp = await this.alipay.queryRoyaltyDetails(batchNo, order.channelTradeNo, order.payScene === PAY_SCENE_PAGE);
    const details = resp.royalty_detail_list || [];
    for (const rec of records) {
      const hit = details.find((d) => d.trans_in === rec.receiver.accountNo && d.operation_type === 'transfer');
      if (!hit) continue;
      rec.status = hit.state === 'SUCCESS' ? 'FINISH' : hit.state === 'FAIL' ? 'FAIL' : rec.status;
      rec.channelResp = JSON.stringify(hit);
      await this.records.save(rec);
    }
    const fresh = await this.records.find({ where: { batchNo } });
    const allOk = fresh.every((x) => x.status === 'FINISH');
    const anyFail = fresh.some((x) => x.status === 'FAIL');
    await this.orders.update({ id: order.id }, { divisionState: allOk ? 'FINISH' : anyFail ? 'FAIL' : 'ING' });
    return { batchNo, details };
  }

  async retryFailed() {
    const orders = await this.orders.find({
      where: {
        divisionState: In(['WAIT', 'FAIL', 'ING']),
        status: 'SUCCESS',
        divisionMode: In(['AUTO', 'MANUAL']),
      },
      take: 10,
    });
    for (const o of orders) {
      try {
        if (o.divisionState === 'ING') {
          const rec = await this.records.findOne({ where: { payOrderId: o.id } });
          if (rec) await this.queryBatch(rec.batchNo);
          else await this.execForOrder(o.id);
        } else {
          await this.execForOrder(o.id);
        }
      } catch (e) {
        this.logger.warn(`division ${o.orderNo} ${errorMessage(e)}`);
      }
    }
  }

  async pageRecords(q: PageQueryDto & { keyword?: string }) {
    const p = paging(q);
    const qb = this.records
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.payOrder', 'o')
      .leftJoinAndSelect('d.receiver', 'r')
      .orderBy('d.createdAt', 'DESC');
    if (q.keyword) qb.where('d.batchNo ILIKE :k OR o.orderNo ILIKE :k', { k: `%${q.keyword}%` });
    const [items, total] = await qb.skip(p.skip).take(p.take).getManyAndCount();
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  private async assertTotalBps(addBps: number, exceptId?: string) {
    const list = await this.receivers.find({ where: { enabled: true } });
    const total = list.filter((r) => r.id !== exceptId).reduce((s, r) => s + r.ratioBps, 0) + addBps;
    if (total > 10000) throw ApiException.bad(`启用中的分账比例合计将达到 ${(total / 100).toFixed(2)}%，不能超过 100%`);
  }

  private async settleExisting(
    tradeNo: string,
    records: { id: string; batchNo: string; payOrderId: string; amountCents: number; receiver: { accountNo: string; accountName: string } }[],
  ) {
    const batchNo = records[0].batchNo;
    const payOrderId = records[0].payOrderId;
    await this.records.update({ batchNo }, { status: 'ING' });
    await this.orders.update({ id: payOrderId }, { divisionState: 'ING' });
    try {
      const resp = await this.alipay.settle({
        batchNo,
        tradeNo,
        finish: true,
        items: records.map((x) => ({
          account: x.receiver.accountNo,
          name: x.receiver.accountName,
          amountCents: x.amountCents,
          desc: `分账${batchNo}`,
        })),
      });
      await this.records.update({ batchNo }, { status: 'FINISH', channelResp: JSON.stringify(resp) });
      await this.orders.update({ id: payOrderId }, { divisionState: 'FINISH' });
      return { batchNo, items: records.length, finished: true };
    } catch (e) {
      const msg = errorMessage(e);
      if (isTransientAlipayError(e)) {
        await this.records.update({ batchNo }, { channelResp: msg });
        return { batchNo, items: records.length, finished: false, pending: true };
      }
      await this.records.update({ batchNo }, { status: 'FAIL', channelResp: msg });
      await this.orders.update({ id: payOrderId }, { divisionState: 'FAIL' });
      throw e;
    }
  }
}
