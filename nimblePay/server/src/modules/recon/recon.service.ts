import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import dayjs from 'dayjs';
import { Between, In, Repository } from 'typeorm';
import { ApiException, errorMessage } from '../../common/api-exception';
import { RECON_MAX_DAYS } from '../../common/constants';
import { paging, PageQueryDto } from '../../common/dto/page.dto';
import { SHANGHAI_TZ, shanghaiNow, shanghaiYmd, shanghaiDayBounds } from '../../common/time';
import { PayOrder, ReconBatch, ReconItem, RefundOrder, TransferOrder } from '../../entities';
import { AlipayService } from '../../infra/alipay/alipay.service';
import { RedisService } from '../../infra/redis/redis.service';
import { PaymentService } from '../payment/payment.service';
import { RefundService } from '../refund/refund.service';
import { TransferService } from '../transfer/transfer.service';
import { BillRow, parseAlipayBill, unzipBillCsv } from './bill-parser';

@Injectable()
export class ReconService {
  private readonly logger = new Logger(ReconService.name);

  constructor(
    @InjectRepository(ReconBatch) private readonly batches: Repository<ReconBatch>,
    @InjectRepository(ReconItem) private readonly items: Repository<ReconItem>,
    @InjectRepository(PayOrder) private readonly orders: Repository<PayOrder>,
    @InjectRepository(RefundOrder) private readonly refunds: Repository<RefundOrder>,
    @InjectRepository(TransferOrder) private readonly transfers: Repository<TransferOrder>,
    private readonly alipay: AlipayService,
    private readonly redis: RedisService,
    private readonly payment: PaymentService,
    private readonly refundSvc: RefundService,
    private readonly transferSvc: TransferService,
  ) {}

  async runRange(startDate: string, endDate: string, operatorId: string) {
    const dates = listBillDates(startDate, endDate || startDate);
    const results: { billDate: string; ok: boolean; error?: string }[] = [];
    for (const billDate of dates) {
      try {
        await this.run(billDate, operatorId);
        results.push({ billDate, ok: true });
      } catch (e) {
        results.push({ billDate, ok: false, error: errorMessage(e) });
      }
    }
    const failedCount = results.filter((x) => !x.ok).length;
    if (failedCount === results.length) {
      throw ApiException.bad(`对账失败：${results.map((x) => `${x.billDate} ${x.error}`).join('；')}`);
    }
    return { results, failedCount };
  }

  async run(billDate: string, operatorId: string) {
    const [date] = listBillDates(billDate, billDate);
    return this.redis.withLock(`recon:${date}`, 180, async () => {
      const trade = await this.runOne(date, 'trade', operatorId);
      let sign: ReconBatch | null = null;
      try {
        sign = await this.runOne(date, 'signcustomer', operatorId);
      } catch (e) {
        this.logger.warn(`signcustomer bill skipped: ${errorMessage(e)}`);
      }
      await this.autoFix(trade.id);
      if (sign) await this.autoFix(sign.id);
      return { trade, signcustomer: sign };
    });
  }

  async pageBatches(q: PageQueryDto & { startDate?: string; endDate?: string }) {
    const p = paging(q);
    const qb = this.batches.createQueryBuilder('b').orderBy('b.billDate', 'DESC').addOrderBy('b.billType', 'ASC');
    if (q.startDate) qb.andWhere('b.billDate >= :s', { s: q.startDate });
    if (q.endDate) qb.andWhere('b.billDate <= :e', { e: q.endDate });
    const [items, total] = await qb.skip(p.skip).take(p.take).getManyAndCount();
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  async pageItems(q: PageQueryDto & { batchId: string; diffType?: string; onlyDiffs?: boolean }) {
    const p = paging(q);
    const qb = this.items.createQueryBuilder('i').where('i.batchId = :id', { id: q.batchId }).orderBy('i.createdAt', 'DESC');
    if (q.diffType) qb.andWhere('i.diffType = :d', { d: q.diffType });
    else if (q.onlyDiffs) qb.andWhere("i.diffType <> 'MATCHED'");
    const [items, total] = await qb.skip(p.skip).take(p.take).getManyAndCount();
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  async handle(id: string, action: 'ignore' | 'sync' | 'fixed', operatorId: string, remark?: string) {
    const item = await this.items.findOne({ where: { id } });
    if (!item) throw ApiException.notFound('对账明细不存在');
    if (action === 'sync') {
      await this.syncItem(item);
      const linked = await this.refreshLocalNo(item);
      return this.markHandled(linked, 'MANUAL_FIXED', operatorId, remark || '已按渠道同步');
    }
    item.handleStatus = action === 'ignore' ? 'IGNORED' : 'MANUAL_FIXED';
    item.handledBy = operatorId;
    item.handledAt = new Date();
    item.remark = remark || item.remark;
    return this.items.save(item);
  }

  async summary(billDate?: string) {
    const date = billDate || shanghaiYmd(-1);
    const batches = await this.batches.find({ where: { billDate: date } });
    const openDiffs = await this.items
      .createQueryBuilder('i')
      .innerJoin('i.batch', 'b')
      .where('b.billDate = :date AND i.diffType <> :m AND i.handleStatus = :h', { date, m: 'MATCHED', h: 'OPEN' })
      .getCount();
    return { billDate: date, batches, openDiffs };
  }

  private async runOne(billDate: string, billType: 'trade' | 'signcustomer', operatorId: string) {
    let batch = await this.batches.findOne({ where: { billDate, billType } });
    if (!batch) batch = this.batches.create({ billDate, billType, status: 'RUNNING', operatorId });
    else {
      batch.status = 'RUNNING';
      batch.operatorId = operatorId;
      batch.errorMsg = '';
      batch.startedAt = new Date();
      batch.finishedAt = null;
    }
    batch = await this.batches.save(batch);
    await this.items.delete({ batchId: batch.id });
    try {
      const { bill_download_url: url } = await this.alipay.queryBillDownloadUrl(billType, billDate);
      if (!url) throw ApiException.bad('支付宝未返回账单下载地址');
      const zip = await this.alipay.downloadBillFile(url);
      const csv = await unzipBillCsv(zip);
      const rows = parseAlipayBill(csv, billType);
      const matched = await this.match(billDate, billType, rows);
      if (matched.length) {
        await this.items.save(matched.map((x) => this.items.create({ ...x, batchId: batch!.id })));
      }
      return this.refreshBatchStats(batch.id, url, rows.length);
    } catch (e) {
      batch.status = 'FAIL';
      batch.errorMsg = errorMessage(e);
      batch.finishedAt = new Date();
      await this.batches.save(batch);
      throw e;
    }
  }

  private async match(billDate: string, billType: 'trade' | 'signcustomer', rows: BillRow[]) {
    const { start, end } = shanghaiDayBounds(billDate);
    const pays = await this.orders
      .createQueryBuilder('o')
      .where('o.amountCents > 0')
      .andWhere('(o.paidAt BETWEEN :s AND :e OR (o.createdAt BETWEEN :s AND :e AND o.status IN (:...st)))', {
        s: start,
        e: end,
        st: ['SUCCESS', 'REFUNDED'],
      })
      .getMany();
    const refunds = await this.refunds.find({
      where: [{ succeedAt: Between(start, end) }, { createdAt: Between(start, end) }],
      relations: { payOrder: true },
    });
    const transfers = await this.transfers
      .createQueryBuilder('t')
      .where('t.paidAt BETWEEN :s AND :e OR (t.createdAt BETWEEN :s AND :e AND t.status = :ok)', { s: start, e: end, ok: 'SUCCESS' })
      .getMany();
    const usedPay = new Set<string>();
    const usedRefund = new Set<string>();
    const usedTransfer = new Set<string>();
    const items: Partial<ReconItem>[] = [];

    for (const row of rows) {
      if (row.bizType === 'PAY' || (billType === 'trade' && row.bizType === 'OTHER' && row.amountCents > 0)) {
        const pay = await this.findPay(pays, row);
        if (!pay) {
          items.push(this.item('PAY', 'CHANNEL_ONLY', row, '', 0, '', '渠道有交易，本地无对应订单'));
          continue;
        }
        usedPay.add(pay.id);
        if (pay.channelFeeCents !== row.feeCents || (row.receiptCents && pay.receiptAmountCents !== row.receiptCents)) {
          pay.channelFeeCents = row.feeCents;
          pay.receiptAmountCents = row.receiptCents || pay.receiptAmountCents;
          pay.channelTradeNo = pay.channelTradeNo || row.channelTradeNo;
          await this.orders.save(pay);
        }
        const localOk = pay.status === 'SUCCESS' || pay.status === 'REFUNDED';
        const amountOk = Math.abs(pay.amountCents) === Math.abs(row.amountCents);
        items.push(this.item('PAY', !localOk ? 'STATUS_MISMATCH' : amountOk ? 'MATCHED' : 'AMOUNT_MISMATCH', row, pay.orderNo, pay.amountCents, pay.status));
      } else if (row.bizType === 'REFUND') {
        let refund = refunds.find((r) => r.refundNo === row.channelRefundNo || r.refundNo === row.channelOutNo || r.payOrder?.orderNo === row.channelOutNo);
        if (!refund && (row.channelRefundNo || row.channelOutNo)) {
          refund =
            (await this.refunds.findOne({
              where: [{ refundNo: row.channelRefundNo || row.channelOutNo }, { payOrder: { orderNo: row.channelOutNo } }],
              relations: { payOrder: true },
            })) || undefined;
        }
        if (!refund) {
          items.push(this.item('REFUND', 'CHANNEL_ONLY', row, '', 0, '', '渠道有退款，本地无对应退款单'));
          continue;
        }
        usedRefund.add(refund.id);
        const amountOk = Math.abs(refund.amountCents) === Math.abs(row.amountCents);
        items.push(this.item('REFUND', refund.status !== 'SUCCESS' ? 'STATUS_MISMATCH' : amountOk ? 'MATCHED' : 'AMOUNT_MISMATCH', row, refund.refundNo, refund.amountCents, refund.status));
      } else if (row.bizType === 'TRANSFER') {
        let t = transfers.find((x) => x.transferNo === row.channelOutNo || x.channelOrderNo === row.channelTradeNo);
        if (!t && row.channelOutNo) {
          t = (await this.transfers.findOne({ where: [{ transferNo: row.channelOutNo }, { channelOrderNo: row.channelTradeNo || '___' }] })) || undefined;
        }
        if (!t) {
          items.push(this.item('TRANSFER', 'CHANNEL_ONLY', row, '', 0, '', '渠道有转账，本地无对应单'));
          continue;
        }
        usedTransfer.add(t.id);
        const amountOk = Math.abs(t.amountCents) === Math.abs(row.amountCents);
        items.push(this.item('TRANSFER', t.status !== 'SUCCESS' ? 'STATUS_MISMATCH' : amountOk ? 'MATCHED' : 'AMOUNT_MISMATCH', row, t.transferNo, t.amountCents, t.status));
      } else {
        items.push(this.item(row.bizType, 'MATCHED', row, '', Math.abs(row.amountCents), row.status, '账务类明细，仅归档'));
      }
    }

    if (billType === 'trade') {
      for (const pay of pays) {
        if (usedPay.has(pay.id)) continue;
        items.push({ bizType: 'PAY', diffType: 'LOCAL_ONLY', handleStatus: 'OPEN', localOrderNo: pay.orderNo, localAmountCents: pay.amountCents, localStatus: pay.status, remark: '本地成功，账单中无此交易' });
      }
      for (const refund of refunds.filter((r) => r.status === 'SUCCESS')) {
        if (usedRefund.has(refund.id)) continue;
        items.push({ bizType: 'REFUND', diffType: 'LOCAL_ONLY', handleStatus: 'OPEN', localOrderNo: refund.refundNo, localAmountCents: refund.amountCents, localStatus: refund.status, remark: '本地退款成功，账单中无此退款' });
      }
    }
    if (billType === 'signcustomer') {
      for (const t of transfers) {
        if (usedTransfer.has(t.id)) continue;
        items.push({ bizType: 'TRANSFER', diffType: 'LOCAL_ONLY', handleStatus: 'OPEN', localOrderNo: t.transferNo, localAmountCents: t.amountCents, localStatus: t.status, remark: '本地转账成功，账务账单中无此记录' });
      }
    }
    return items;
  }

  private async findPay(pays: PayOrder[], row: BillRow) {
    const hit = pays.find((p) => p.orderNo === row.channelOutNo || p.clientOrderNo === row.channelOutNo || (!!row.channelTradeNo && p.channelTradeNo === row.channelTradeNo));
    if (hit) return hit;
    if (!row.channelOutNo && !row.channelTradeNo) return undefined;
    return (
      (await this.orders.findOne({
        where: [
          ...(row.channelOutNo ? [{ orderNo: row.channelOutNo }, { clientOrderNo: row.channelOutNo }] : []),
          ...(row.channelTradeNo ? [{ channelTradeNo: row.channelTradeNo }] : []),
        ],
      })) || undefined
    );
  }

  private item(bizType: string, diffType: string, row: BillRow, localOrderNo: string, localAmountCents: number, localStatus: string, remark = ''): Partial<ReconItem> {
    return {
      bizType,
      diffType,
      handleStatus: diffType === 'MATCHED' ? 'AUTO_FIXED' : 'OPEN',
      channelTradeNo: row.channelTradeNo,
      channelOutNo: row.channelOutNo,
      channelRefundNo: row.channelRefundNo,
      channelAmountCents: row.amountCents,
      channelFeeCents: row.feeCents,
      channelStatus: row.status,
      channelTime: row.time,
      localOrderNo,
      localAmountCents,
      localStatus,
      rawLine: JSON.stringify(row.raw).slice(0, 4000),
      remark,
    };
  }

  private async refreshLocalNo(item: ReconItem) {
    if (item.localOrderNo) return item;
    if (item.bizType === 'PAY') {
      const pay = await this.findPay([], { channelOutNo: item.channelOutNo, channelTradeNo: item.channelTradeNo, channelRefundNo: '', amountCents: 0, feeCents: 0, receiptCents: 0, status: '', time: '', bizType: 'PAY', raw: {} });
      if (pay) {
        item.localOrderNo = pay.orderNo;
        item.localAmountCents = pay.amountCents;
        item.localStatus = pay.status;
        return this.items.save(item);
      }
    }
    if (item.bizType === 'REFUND' && (item.channelRefundNo || item.channelOutNo)) {
      const refund = await this.refunds.findOne({ where: { refundNo: item.channelRefundNo || item.channelOutNo } });
      if (refund) {
        item.localOrderNo = refund.refundNo;
        item.localAmountCents = refund.amountCents;
        item.localStatus = refund.status;
        return this.items.save(item);
      }
    }
    if (item.bizType === 'TRANSFER' && item.channelOutNo) {
      const t = await this.transfers.findOne({ where: { transferNo: item.channelOutNo } });
      if (t) {
        item.localOrderNo = t.transferNo;
        item.localAmountCents = t.amountCents;
        item.localStatus = t.status;
        return this.items.save(item);
      }
    }
    return item;
  }

  private async syncItem(item: ReconItem) {
    if (item.bizType === 'PAY') {
      const orderNo = item.localOrderNo || item.channelOutNo;
      if (orderNo) await this.payment.syncFromChannel(orderNo);
    } else if (item.bizType === 'REFUND') {
      const refundNo = item.localOrderNo || item.channelRefundNo || item.channelOutNo;
      if (refundNo) await this.refundSvc.sync(refundNo);
    } else if (item.bizType === 'TRANSFER') {
      const transferNo = item.localOrderNo || item.channelOutNo;
      if (transferNo) await this.transferSvc.sync(transferNo);
    }
  }

  private async markHandled(item: ReconItem, handleStatus: string, operatorId: string, remark: string) {
    let diffType = item.diffType;
    if (item.localOrderNo && item.bizType === 'PAY') {
      const pay = await this.orders.findOne({ where: { orderNo: item.localOrderNo } });
      if (pay && (pay.status === 'SUCCESS' || pay.status === 'REFUNDED') && Math.abs(pay.amountCents) === Math.abs(item.channelAmountCents)) diffType = 'MATCHED';
      item.localStatus = pay?.status || item.localStatus;
    }
    item.handleStatus = diffType === 'MATCHED' ? 'AUTO_FIXED' : handleStatus;
    item.diffType = diffType;
    item.handledBy = operatorId;
    item.handledAt = new Date();
    item.remark = remark;
    return this.items.save(item);
  }

  private async autoFix(batchId: string) {
    const opens = await this.items.find({ where: { batchId, handleStatus: 'OPEN', diffType: In(['CHANNEL_ONLY', 'STATUS_MISMATCH']) } });
    for (const item of opens) {
      try {
        await this.syncItem(item);
        const linked = await this.refreshLocalNo(item);
        await this.markHandled(linked, 'OPEN', 'system', '已按渠道结果补单');
      } catch (e) {
        this.logger.warn(`autofix ${item.id} ${errorMessage(e)}`);
      }
    }
    await this.refreshBatchStats(batchId);
  }

  private async refreshBatchStats(batchId: string, downloadUrl?: string, channelCount?: number) {
    const all = await this.items.find({ where: { batchId } });
    const batch = await this.batches.findOneByOrFail({ id: batchId });
    const matched = all.filter((x) => x.diffType === 'MATCHED').length;
    batch.status = 'DONE';
    batch.matchedCount = matched;
    batch.diffCount = all.length - matched;
    batch.localCount = all.filter((x) => x.localOrderNo).length;
    batch.localAmountCents = all.reduce((s, x) => s + Math.abs(x.localAmountCents), 0);
    batch.finishedAt = new Date();
    batch.errorMsg = '';
    if (downloadUrl) batch.downloadUrl = downloadUrl;
    if (typeof channelCount === 'number') {
      batch.channelCount = channelCount;
      batch.channelAmountCents = all.reduce((s, x) => s + Math.abs(x.channelAmountCents), 0);
      batch.feeCents = all.reduce((s, x) => s + Math.abs(x.channelFeeCents), 0);
    }
    return this.batches.save(batch);
  }
}

function listBillDates(startDate: string, endDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw ApiException.bad('账单日期格式应为 YYYY-MM-DD');
  }
  const from = dayjs.tz(startDate, SHANGHAI_TZ);
  const to = dayjs.tz(endDate, SHANGHAI_TZ);
  if (!from.isValid() || !to.isValid()) throw ApiException.bad('账单日期无效');
  if (to.isBefore(from, 'day')) throw ApiException.bad('结束日期不能早于开始日期');
  const today = shanghaiNow().startOf('day');
  if (!from.isBefore(today) || !to.isBefore(today)) throw ApiException.bad('只能对账历史日期（建议 T-1）');
  const days = to.diff(from, 'day') + 1;
  if (days > RECON_MAX_DAYS) throw ApiException.bad(`一次最多对 ${RECON_MAX_DAYS} 天`);
  return Array.from({ length: days }, (_, i) => from.add(i, 'day').format('YYYY-MM-DD'));
}
