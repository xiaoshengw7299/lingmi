import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { AlipayChannelError, ApiException, errorMessage, isAlipayTradeMissing, isTransientAlipayError } from '../../common/api-exception';
import { paging, PageQueryDto } from '../../common/dto/page.dto';
import { genNo } from '../../common/ids';
import { alipayIdentityType, amountMatches, assertAlipayIdentity, assertCents } from '../../common/money';
import { TransferOrder } from '../../entities';
import { AlipayNotifyPayload, AlipayService } from '../../infra/alipay/alipay.service';
import { RedisService } from '../../infra/redis/redis.service';
import { OpenAppService } from '../open-app/open-app.service';

const WAITING = new Set(['', 'DEALING', 'WAIT_PAY']);

@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(
    @InjectRepository(TransferOrder) private readonly rows: Repository<TransferOrder>,
    private readonly alipay: AlipayService,
    private readonly redis: RedisService,
    private readonly apps: OpenAppService,
  ) {}

  async create(input: {
    amountCents: number;
    accountNo: string;
    accountName: string;
    identityType?: string;
    orderTitle?: string;
    remark: string;
    operatorId: string;
  }) {
    assertCents(input.amountCents, 1);
    const app = await this.apps.ensure();
    const identityType = input.identityType || alipayIdentityType(input.accountNo);
    if (identityType !== 'ALIPAY_USER_ID' && identityType !== 'ALIPAY_LOGON_ID') {
      throw ApiException.bad('收款账户类型无效');
    }
    assertAlipayIdentity(identityType, input.accountNo);
    return this.redis.withLock(`transfer:${input.operatorId}`, 30, async () => {
      const row = await this.rows.save(
        this.rows.create({
          transferNo: genNo('NT'),
          appId: app.appId,
          amountCents: input.amountCents,
          accountNo: input.accountNo.trim(),
          accountName: input.accountName.trim(),
          identityType,
          orderTitle: input.orderTitle || input.remark || '余额转账',
          remark: input.remark,
          status: 'PROCESSING',
          operatorId: input.operatorId,
        }),
      );
      try {
        const resp = await this.alipay.transfer({
          transferNo: row.transferNo,
          amountCents: input.amountCents,
          accountNo: row.accountNo,
          accountName: row.accountName,
          identityType,
          orderTitle: row.orderTitle,
          remark: input.remark,
        });
        await this.applyChannelStatus(row.id, resp.status, resp.order_id, JSON.stringify(resp), resp.pay_date);
        return this.rows.findOneByOrFail({ id: row.id });
      } catch (e) {
        const msg = errorMessage(e);
        if (isTransientAlipayError(e)) {
          await this.rows.update({ id: row.id }, { channelResp: msg, failReason: '系统繁忙，待查询确认' });
          return this.rows.findOneByOrFail({ id: row.id });
        }
        await this.rows.update({ id: row.id }, { status: 'FAIL', failReason: msg, channelResp: msg });
        throw e;
      }
    });
  }

  async sync(transferNo: string) {
    const row = await this.rows.findOne({ where: { transferNo } });
    if (!row) throw ApiException.notFound('转账单不存在');
    try {
      const resp = await this.alipay.queryTransfer(row.transferNo, row.channelOrderNo || undefined);
      await this.applyChannelStatus(row.id, resp.status, resp.order_id, JSON.stringify(resp), resp.pay_date, resp.fail_reason);
    } catch (e) {
      if (isAlipayTradeMissing(e) || (e instanceof AlipayChannelError && /ORDER_NOT_EXIST/i.test(e.subCode))) return row;
      throw e;
    }
    return this.rows.findOneByOrFail({ transferNo });
  }

  async handleNotify(payload: AlipayNotifyPayload) {
    const ok = await this.alipay.verifyNotify(payload);
    if (!ok) throw ApiException.bad('转账通知验签失败');
    const transferNo = payload.out_biz_no;
    if (!transferNo) throw ApiException.bad('通知缺少商户单号');
    const row = await this.rows.findOne({ where: { transferNo } });
    if (!row) throw ApiException.notFound('转账单不存在');
    if (payload.trans_amount && !amountMatches(row.amountCents, payload.trans_amount)) {
      throw ApiException.bad('转账通知金额与本地不一致');
    }
    await this.applyChannelStatus(row.id, payload.status, payload.order_id, JSON.stringify(payload), payload.pay_date, payload.fail_reason);
  }

  async page(q: PageQueryDto & { keyword?: string; status?: string }) {
    const p = paging(q);
    const qb = this.rows.createQueryBuilder('t').orderBy('t.createdAt', 'DESC');
    if (q.status) qb.andWhere('t.status = :status', { status: q.status });
    if (q.keyword) qb.andWhere('(t.transferNo ILIKE :k OR t.accountNo ILIKE :k)', { k: `%${q.keyword}%` });
    const [items, total] = await qb.skip(p.skip).take(p.take).getManyAndCount();
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  async syncProcessing() {
    const since = new Date(Date.now() - 48 * 3600 * 1000);
    const list = await this.rows.find({
      where: [{ status: 'PROCESSING' }, { status: 'FAIL', updatedAt: MoreThan(since) }],
      take: 30,
    });
    for (const t of list) {
      try {
        await this.sync(t.transferNo);
      } catch (e) {
        this.logger.warn(`transfer query ${t.transferNo} ${errorMessage(e)}`);
      }
    }
  }

  private async applyChannelStatus(id: string, status?: string, orderId?: string, channelResp?: string, payDate?: string, failReason?: string) {
    const row = await this.rows.findOne({ where: { id } });
    if (!row) return;
    const st = (status || '').toUpperCase();
    let next = 'PROCESSING';
    if (st === 'SUCCESS') next = 'SUCCESS';
    else if (st === 'FAIL') next = 'FAIL';
    else if (st === 'REFUND' || st === 'RETURNED') next = 'RETURNED';
    else if (WAITING.has(st)) next = 'PROCESSING';
    if (row.status === 'SUCCESS' && next !== 'SUCCESS' && next !== 'RETURNED') next = 'SUCCESS';
    if (row.status === 'RETURNED' && next === 'PROCESSING') next = 'RETURNED';
    row.status = next;
    row.channelOrderNo = orderId || row.channelOrderNo;
    row.channelResp = channelResp || row.channelResp;
    row.failReason = failReason || (next === 'FAIL' ? status || '' : '');
    row.paidAt = next === 'SUCCESS' ? row.paidAt || (payDate ? new Date(payDate) : new Date()) : row.paidAt;
    row.notifyPayload = channelResp || row.notifyPayload;
    await this.rows.save(row);
  }
}
