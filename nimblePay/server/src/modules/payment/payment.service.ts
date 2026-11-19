import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import dayjs from 'dayjs';
import { DataSource, In, LessThan, MoreThan, Repository } from 'typeorm';
import { ApiException, errorMessage, isAlipayTradeMissing, isTransientAlipayError } from '../../common/api-exception';
import {
  ALIPAY_PRODUCT_PAGE,
  MIN_RECHARGE_CENTS,
  OPEN_PAY_RATE_LIMIT_PER_MIN,
  ORDER_EXPIRE_MINUTES,
  PAY_SCENE_PAGE,
  TEST_PAY_AMOUNT_CENTS,
  TEST_PAY_EXTERNAL_ID,
  TEST_PAY_ORDER_PREFIX,
} from '../../common/constants';
import { paging, PageQueryDto } from '../../common/dto/page.dto';
import { genNo, genPayToken } from '../../common/ids';
import { amountMatches, centsToYuan, yuanToCents } from '../../common/money';
import { PayOrder, SysSetting, WalletUser } from '../../entities';
import { AlipayNotifyPayload, AlipayService } from '../../infra/alipay/alipay.service';
import { RedisService } from '../../infra/redis/redis.service';
import { shanghaiDayStart, shanghaiYmd } from '../../common/time';
import { DivisionService } from '../division/division.service';
import { OpenAppService } from '../open-app/open-app.service';
import { WalletService } from '../wallet/wallet.service';
import { renderAlipayJumpPage, renderPayPage } from './pay-page.view';

/** 统计页充值趋势的天数 */
const STATS_TREND_DAYS = 14;

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(PayOrder) private readonly orders: Repository<PayOrder>,
    @InjectRepository(SysSetting) private readonly settings: Repository<SysSetting>,
    @InjectRepository(WalletUser) private readonly users: Repository<WalletUser>,
    private readonly alipay: AlipayService,
    private readonly redis: RedisService,
    private readonly wallet: WalletService,
    private readonly division: DivisionService,
    private readonly apps: OpenAppService,
  ) {}

  async create(input: {
    appId: string;
    externalUserId: string;
    amountCents: number;
    clientOrderNo: string;
    email?: string;
    nickname?: string;
    clientIp?: string;
  }) {
    const rate = await this.redis.incrWindow(`pay:${input.appId}:${Math.floor(Date.now() / 60000)}`, 70);
    if (rate > OPEN_PAY_RATE_LIMIT_PER_MIN) throw ApiException.bad('下单过于频繁', 42901);
    return this.redis.withLock(`paycreate:${input.appId}:${input.clientOrderNo}`, 45, () => this.doCreate(input));
  }

  private async doCreate(input: {
    appId: string;
    externalUserId: string;
    amountCents: number;
    clientOrderNo: string;
    email?: string;
    nickname?: string;
    clientIp?: string;
  }) {
    if (!Number.isInteger(input.amountCents)) throw ApiException.bad('金额须为整数分');
    const min = await this.minRechargeCents();
    if (input.amountCents < min) throw ApiException.bad(`充值金额不能低于 ${centsToYuan(min)} 元`);

    const existing = await this.orders.findOne({
      where: { appId: input.appId, clientOrderNo: input.clientOrderNo },
    });
    const user = await this.users.findOne({
      where: { externalUserId: input.externalUserId },
    });
    if (!user) throw ApiException.bad('请先同步钱包');
    if (user.status !== 'ACTIVE') throw ApiException.bad('用户不可用');
    if (input.email || input.nickname) {
      user.email = input.email || user.email;
      user.nickname = input.nickname || user.nickname;
      await this.users.save(user);
    }

    if (existing) {
      if (existing.userId !== user.id) throw ApiException.conflict('商户订单号已被使用');
      if (existing.amountCents !== input.amountCents) throw ApiException.conflict('同一订单号金额不一致');
      if (existing.status === 'SUCCESS' || existing.status === 'REFUNDED') return this.toPayResult(existing);
      if (existing.status === 'CLOSED') throw ApiException.conflict('商户订单号已关闭，请更换 clientOrderNo');
      if (existing.status === 'PAYING' && existing.expiredAt > new Date()) return this.toPayResult(existing);
      if (existing.status === 'PAYING' && existing.expiredAt <= new Date()) {
        await this.syncFromChannel(existing.orderNo).catch(() => undefined);
        const fresh = await this.mustOrder(existing.orderNo);
        if (fresh.status === 'SUCCESS' || fresh.status === 'REFUNDED') return this.toPayResult(fresh);
        throw ApiException.conflict('原订单已过期，请更换 clientOrderNo');
      }
    }

    await this.alipay.assertAcceptingPayments();
    const receivers = await this.division.activeReceivers();
    const mode = await this.defaultDivisionMode(receivers.length > 0);
    const expireMinutes = await this.expireMinutes();
    const orderNo = existing?.orderNo || genNo('NP');
    const expiredAt = dayjs().add(expireMinutes, 'minute').toDate();
    const payToken = existing?.payToken || genPayToken();
    const subject = '余额充值';
    const payload: Partial<PayOrder> = {
      orderNo,
      amountCents: input.amountCents,
      subject,
      body: `${user.nickname || user.email || user.externalUserId} 充值`,
      status: 'PAYING',
      divisionMode: mode,
      expiredAt,
      payScene: PAY_SCENE_PAGE,
      productCode: ALIPAY_PRODUCT_PAGE,
      payToken,
      clientIp: input.clientIp || '',
      testPay: false,
    };
    const order = existing
      ? await this.orders.save(Object.assign(existing, payload))
      : await this.orders.save(
          this.orders.create({
            ...payload,
            clientOrderNo: input.clientOrderNo,
            appId: input.appId,
            userId: user.id,
          }),
        );

    try {
      await this.alipay.pagePayForm({
        orderNo,
        amountCents: input.amountCents,
        subject: order.subject,
        body: order.body,
        expiredAt,
        royaltyFreeze: mode !== 'FORBID',
        clientIp: input.clientIp,
      });
      order.channelResp = JSON.stringify({ productCode: ALIPAY_PRODUCT_PAGE });
      return this.toPayResult(await this.orders.save(order));
    } catch (e) {
      const msg = errorMessage(e);
      order.channelResp = msg;
      order.status = isTransientAlipayError(e) ? 'PAYING' : 'FAIL';
      await this.orders.save(order);
      if (isTransientAlipayError(e)) {
        throw ApiException.bad('支付宝繁忙，订单已受理，请稍后查询或使用同一 clientOrderNo 重试');
      }
      throw e;
    }
  }

  async getByNo(orderNo: string, externalUserId?: string, appId?: string) {
    let order = await this.mustOrder(orderNo);
    if (appId && order.appId !== appId) throw ApiException.notFound('订单不存在');
    if (externalUserId) {
      const user = await this.users.findOne({ where: { externalUserId } });
      if (!user || user.id !== order.userId) throw ApiException.notFound('订单不存在');
    }
    if (order.status === 'PAYING' || order.status === 'INIT' || order.status === 'FAIL') {
      const allow = await this.redis.setNx(`pay-sync:${order.orderNo}`, '1', 3);
      if (allow) {
        try {
          await this.syncFromChannel(order.orderNo);
          order = await this.mustOrder(orderNo);
        } catch (e) {
          this.logger.warn(`poll sync ${orderNo} ${errorMessage(e)}`);
        }
      }
    }
    const user = await this.users.findOne({ where: { id: order.userId } });
    return { ...this.publicOrder(order), balanceCents: user?.balanceCents ?? 0 };
  }

  async close(orderNo: string, externalUserId?: string) {
    let order = await this.mustOrder(orderNo);
    if (externalUserId) {
      const user = await this.users.findOne({ where: { externalUserId } });
      if (!user || user.id !== order.userId) throw ApiException.notFound('订单不存在');
    }
    if (order.status === 'SUCCESS' || order.status === 'REFUNDED') throw ApiException.bad('已支付订单不能关闭');
    if (order.status === 'CLOSED') return this.publicOrder(order);
    if (order.status === 'PAYING' || order.status === 'INIT') {
      await this.syncFromChannel(order.orderNo).catch(() => undefined);
      order = await this.mustOrder(orderNo);
      if (order.status === 'SUCCESS' || order.status === 'REFUNDED') throw ApiException.bad('已支付订单不能关闭');
      if (order.status === 'CLOSED') return this.publicOrder(order);
    }
    await this.alipay.closeTrade(order.orderNo).catch(() => undefined);
    const res = await this.orders.update(
      { id: order.id, status: In(['INIT', 'PAYING', 'FAIL']) },
      { status: 'CLOSED' },
    );
    if (!res.affected) throw ApiException.bad('订单状态不允许关闭');
    return this.publicOrder(await this.mustOrder(orderNo));
  }

  async handleAlipayNotify(payload: AlipayNotifyPayload) {
    const ok = await this.alipay.verifyNotify(payload);
    if (!ok) throw ApiException.bad('支付宝通知验签失败');
    const orderNo = payload.out_trade_no;
    const tradeNo = payload.trade_no;
    const status = payload.trade_status;
    if (!orderNo || !tradeNo) throw ApiException.bad('通知缺少订单号');
    const cfgAppId = await this.alipay.getAppId();
    if (payload.app_id && payload.app_id !== cfgAppId) throw ApiException.bad('app_id 不匹配');
    if (status !== 'TRADE_SUCCESS' && status !== 'TRADE_FINISHED') {
      this.logger.log(`ignore notify ${orderNo} ${status}`);
      return;
    }
    const order = await this.mustOrder(orderNo);
    if (!amountMatches(order.amountCents, payload.total_amount)) throw ApiException.bad('通知金额与订单不一致');
    await this.completePaid(order, {
      channelTradeNo: tradeNo,
      buyerLogonId: payload.buyer_logon_id || '',
      notifyPayload: JSON.stringify(payload),
      receiptAmountCents: parseReceiptCents(payload.receipt_amount),
    });
  }

  async syncFromChannel(orderNo: string) {
    const order = await this.mustOrder(orderNo);
    if (order.status === 'SUCCESS' || order.status === 'REFUNDED') return this.publicOrder(order);
    let resp: Awaited<ReturnType<AlipayService['queryTrade']>>;
    try {
      resp = await this.alipay.queryTrade(order.orderNo);
    } catch (e) {
      if (isAlipayTradeMissing(e)) return this.publicOrder(order);
      throw e;
    }
    const st = resp.trade_status;
    if (st === 'TRADE_SUCCESS' || st === 'TRADE_FINISHED') {
      if (resp.total_amount && !amountMatches(order.amountCents, resp.total_amount)) {
        throw ApiException.bad('渠道金额与订单不一致');
      }
      await this.completePaid(order, {
        channelTradeNo: resp.trade_no || '',
        buyerLogonId: resp.buyer_logon_id || '',
        notifyPayload: JSON.stringify(resp),
        receiptAmountCents: parseReceiptCents(resp.receipt_amount),
      });
    } else if (st === 'TRADE_CLOSED') {
      await this.orders.update(
        { id: order.id, status: In(['INIT', 'PAYING']) },
        { status: 'CLOSED', channelResp: JSON.stringify(resp) },
      );
    }
    return this.publicOrder(await this.mustOrder(orderNo));
  }

  async completePaid(
    order: PayOrder,
    extra: { channelTradeNo: string; buyerLogonId: string; notifyPayload: string; receiptAmountCents?: number },
  ) {
    const result = await this.dataSource.transaction(async (tx) => {
      // 已关闭的订单也要能入账：本地关单后支付宝那边可能仍然付成功（关单请求失败、用户停在收银台），收到的钱不能丢
      const updated = await tx.update(
        PayOrder,
        { id: order.id, status: In(['INIT', 'PAYING', 'FAIL', 'CLOSED']) },
        {
          status: 'SUCCESS',
          paidAt: new Date(),
          channelTradeNo: extra.channelTradeNo,
          buyerLogonId: extra.buyerLogonId,
          notifyPayload: extra.notifyPayload,
          receiptAmountCents: extra.receiptAmountCents && Number.isFinite(extra.receiptAmountCents) ? extra.receiptAmountCents : order.receiptAmountCents,
        },
      );
      if (!updated.affected) return { duplicated: true as const, order };
      if (order.status === 'CLOSED') this.logger.warn(`订单 ${order.orderNo} 已关闭但支付宝显示已付款，已按成功入账`);
      const fresh = await tx.findOneByOrFail(PayOrder, { id: order.id });
      await this.wallet.creditRecharge(tx, fresh.userId, fresh.id, fresh.amountCents, `订单 ${fresh.orderNo}`, fresh.testPay);
      if (fresh.divisionMode === 'AUTO' && !fresh.testPay) {
        fresh.divisionState = 'WAIT';
        await tx.save(fresh);
      }
      return { duplicated: false as const, order: fresh };
    });
    if (!result.duplicated && result.order.divisionMode === 'AUTO' && !result.order.testPay) {
      void this.division.execForOrder(result.order.id).catch((e) => this.logger.warn(errorMessage(e)));
    }
    return result;
  }

  async page(q: PageQueryDto & { keyword?: string; status?: string }) {
    const p = paging(q);
    // 已关闭的多是用户点开充值又放弃的订单，对运营没有价值，后台一律不展示
    const qb = this.orders
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.user', 'u')
      .where('o.status <> :closed', { closed: 'CLOSED' })
      .orderBy('o.createdAt', 'DESC');
    if (q.status) qb.andWhere('o.status = :status', { status: q.status });
    if (q.keyword) {
      qb.andWhere('(o.orderNo ILIKE :k OR o.clientOrderNo ILIKE :k OR o.channelTradeNo ILIKE :k OR u.email ILIKE :k OR u.externalUserId ILIKE :k)', {
        k: `%${q.keyword}%`,
      });
    }
    const [items, total] = await qb.skip(p.skip).take(p.take).getManyAndCount();
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  /** 给 nimble 平台统计页用：只算真实充值（成功 / 已退款的非测试单），金额单位分 */
  async stats() {
    const [all, today, perDay, wallets] = await Promise.all([
      this.paidSummary(),
      this.paidSummary(shanghaiDayStart()),
      this.orders
        .createQueryBuilder('o')
        .select(`TO_CHAR(o.paidAt AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')`, 'day')
        .addSelect('COUNT(DISTINCT o.userId)', 'users')
        .addSelect('COALESCE(SUM(o.amountCents), 0)', 'cents')
        .where('o.status IN (:...st) AND o.testPay = false AND o.paidAt >= :since', {
          st: ['SUCCESS', 'REFUNDED'],
          since: shanghaiDayStart(1 - STATS_TREND_DAYS),
        })
        .groupBy('day')
        .getRawMany<{ day: string; users: string; cents: string }>(),
      this.users
        .createQueryBuilder('u')
        .select('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(u.balanceCents), 0)', 'balance')
        .where('u.externalUserId <> :test', { test: TEST_PAY_EXTERNAL_ID })
        .getRawOne<{ count: string; balance: string }>(),
    ]);
    const byDay = new Map(perDay.map((r) => [r.day, r]));
    return {
      walletCount: Number(wallets?.count || 0),
      balanceCents: Number(wallets?.balance || 0),
      rechargeUsers: Number(all?.users || 0),
      rechargeOrders: Number(all?.orders || 0),
      rechargeCents: Number(all?.cents || 0),
      refundedCents: Number(all?.refunded || 0),
      todayRechargeUsers: Number(today?.users || 0),
      todayRechargeOrders: Number(today?.orders || 0),
      todayRechargeCents: Number(today?.cents || 0),
      trend: Array.from({ length: STATS_TREND_DAYS }, (_, i) => {
        const date = shanghaiYmd(i + 1 - STATS_TREND_DAYS);
        const row = byDay.get(date);
        return { date, cents: Number(row?.cents || 0), users: Number(row?.users || 0) };
      }),
    };
  }

  private paidSummary(since?: Date) {
    const qb = this.orders
      .createQueryBuilder('o')
      .select('COUNT(*)', 'orders')
      .addSelect('COUNT(DISTINCT o.userId)', 'users')
      .addSelect('COALESCE(SUM(o.amountCents), 0)', 'cents')
      .addSelect('COALESCE(SUM(o.refundedCents), 0)', 'refunded')
      .where('o.status IN (:...st) AND o.testPay = false', { st: ['SUCCESS', 'REFUNDED'] });
    if (since) qb.andWhere('o.paidAt >= :since', { since });
    return qb.getRawOne<{ orders: string; users: string; cents: string; refunded: string }>();
  }

  /** 过期未付的订单关闭。FAIL 是下单就失败的订单，保持原状留给运营排查，不并入已关闭 */
  async expirePaying() {
    const list = await this.orders.find({
      where: { status: In(['PAYING', 'INIT']), expiredAt: LessThan(new Date()) },
      take: 50,
    });
    for (const o of list) {
      try {
        await this.syncFromChannel(o.orderNo);
        const fresh = await this.orders.findOne({ where: { id: o.id } });
        if (fresh && (fresh.status === 'PAYING' || fresh.status === 'INIT')) {
          await this.alipay.closeTrade(o.orderNo).catch(() => undefined);
          await this.orders.update({ id: o.id, status: In(['PAYING', 'INIT']) }, { status: 'CLOSED' });
        }
      } catch (e) {
        this.logger.warn(`expire ${o.orderNo} ${errorMessage(e)}`);
      }
    }
  }

  async queryPaying() {
    const list = await this.orders.find({
      where: { status: In(['PAYING', 'FAIL']), expiredAt: MoreThan(new Date()) },
      take: 30,
      order: { createdAt: 'ASC' },
    });
    for (const o of list) {
      try {
        await this.syncFromChannel(o.orderNo);
      } catch (e) {
        this.logger.warn(`query ${o.orderNo} ${errorMessage(e)}`);
      }
    }
  }

  async createTestPay(clientIp?: string) {
    const app = await this.apps.ensure();
    let user = await this.users.findOne({ where: { externalUserId: TEST_PAY_EXTERNAL_ID } });
    if (!user) {
      user = await this.users.save(
        this.users.create({
          externalUserId: TEST_PAY_EXTERNAL_ID,
          nickname: '支付宝付款测试',
          remark: '后台测试付款，不计入真实用户余额',
          status: 'ACTIVE',
        }),
      );
    }
    const expireMinutes = await this.expireMinutes();
    const orderNo = genNo(TEST_PAY_ORDER_PREFIX);
    const expiredAt = dayjs().add(expireMinutes, 'minute').toDate();
    const subject = '支付宝付款测试';
    const body = '后台配置页发起的电脑网站支付测试，金额 0.01 元，不入账';
    const formHtml = await this.alipay.pagePayForm({
      orderNo,
      amountCents: TEST_PAY_AMOUNT_CENTS,
      subject,
      body,
      expiredAt,
      royaltyFreeze: false,
      clientIp,
    });
    const order = await this.orders.save(
      this.orders.create({
        orderNo,
        clientOrderNo: genNo('TEST'),
        appId: app.appId,
        userId: user.id,
        amountCents: TEST_PAY_AMOUNT_CENTS,
        subject,
        body,
        status: 'PAYING',
        divisionMode: 'FORBID',
        expiredAt,
        payScene: PAY_SCENE_PAGE,
        productCode: ALIPAY_PRODUCT_PAGE,
        payToken: genPayToken(),
        channelResp: JSON.stringify({ productCode: ALIPAY_PRODUCT_PAGE, testPay: true }),
        clientIp: clientIp || '',
        testPay: true,
      }),
    );
    return { ...this.toPayResult(order), formHtml: renderAlipayJumpPage(formHtml) };
  }

  async cashierHtml(token: string): Promise<string> {
    if (!/^[a-f0-9]{32}$/.test(token)) {
      return renderPayPage({ kind: 'error', title: '支付链接无效', message: '请回到页面重新发起支付。' });
    }
    const order = await this.orders.findOne({ where: { payToken: token } });
    if (!order) return renderPayPage({ kind: 'error', title: '支付链接无效', message: '链接不存在或已失效。' });
    if (order.status === 'SUCCESS' || order.status === 'REFUNDED') {
      return renderPayPage({
        kind: 'success',
        title: '支付已完成',
        message: this.paidSuccessMessage(order),
        subject: order.subject,
        amountCents: order.amountCents,
        orderNo: order.orderNo,
      });
    }
    if (order.status === 'CLOSED' || order.status === 'FAIL' || order.expiredAt <= new Date()) {
      if (order.status !== 'CLOSED') {
        await this.syncFromChannel(order.orderNo).catch(() => undefined);
        const fresh = await this.mustOrder(order.orderNo);
        if (fresh.status === 'SUCCESS' || fresh.status === 'REFUNDED') {
          return renderPayPage({
            kind: 'success',
            title: '支付已完成',
            message: this.paidSuccessMessage(fresh),
            subject: fresh.subject,
            amountCents: fresh.amountCents,
            orderNo: fresh.orderNo,
          });
        }
      }
      return renderPayPage({
        kind: 'closed',
        title: '订单已关闭',
        message: order.testPay ? '测试订单已关闭。可回到系统配置页重新测试。' : '此订单已过期或关闭。请回到账号页重新充值。',
        subject: order.subject,
        amountCents: order.amountCents,
        orderNo: order.orderNo,
      });
    }
    try {
      const formHtml = await this.alipay.pagePayForm({
        orderNo: order.orderNo,
        amountCents: order.amountCents,
        subject: order.subject,
        body: order.body,
        expiredAt: order.expiredAt,
        royaltyFreeze: order.divisionMode !== 'FORBID',
        clientIp: order.clientIp,
      });
      return renderAlipayJumpPage(formHtml);
    } catch (e) {
      return renderPayPage({
        kind: 'error',
        title: '暂时无法跳转支付宝',
        message: errorMessage(e) || '请稍后重试。',
        subject: order.subject,
        amountCents: order.amountCents,
        orderNo: order.orderNo,
      });
    }
  }

  async returnHtml(query: Record<string, string>): Promise<string> {
    const orderNo = query.out_trade_no;
    if (!orderNo) {
      return renderPayPage({ kind: 'error', title: '未找到支付结果', message: '请返回账号页查看余额。' });
    }
    if (!(await this.alipay.verifyNotify(query))) {
      return renderPayPage({ kind: 'error', title: '支付结果无法确认', message: '回跳校验未通过。请以账号页余额为准。' });
    }
    let order = await this.orders.findOne({ where: { orderNo } });
    if (!order) return renderPayPage({ kind: 'error', title: '订单不存在', message: '请返回账号页查看。' });
    if (query.total_amount && !amountMatches(order.amountCents, query.total_amount)) {
      return renderPayPage({ kind: 'error', title: '支付结果无法确认', message: '金额不一致。请不要重复付款。', orderNo });
    }
    if (order.status === 'PAYING' || order.status === 'INIT') {
      await this.syncFromChannel(order.orderNo).catch((e) => this.logger.warn(`return sync ${orderNo} ${errorMessage(e)}`));
      order = await this.mustOrder(orderNo);
    }
    if (order.status === 'SUCCESS' || order.status === 'REFUNDED') {
      return renderPayPage({
        kind: 'success',
        title: '支付成功',
        message: this.paidSuccessMessage(order),
        subject: order.subject,
        amountCents: order.amountCents,
        orderNo: order.orderNo,
      });
    }
    if (order.status === 'CLOSED' || order.status === 'FAIL') {
      return renderPayPage({
        kind: 'closed',
        title: '未完成支付',
        message: '订单已关闭或失败。如已扣款，请稍后在账号页查看余额。',
        subject: order.subject,
        amountCents: order.amountCents,
        orderNo: order.orderNo,
      });
    }
    return renderPayPage({
      kind: 'pending',
      title: '正在确认支付结果',
      message: '支付宝处理中。请稍候，不要重复付款。',
      subject: order.subject,
      amountCents: order.amountCents,
      orderNo: order.orderNo,
      refreshSeconds: 2,
    });
  }

  private paidSuccessMessage(order: PayOrder) {
    return order.testPay ? '付款测试成功。可关闭此页，到后台「支付订单」核对。测试金额不会进入用户余额。' : '充值已到账。请返回账号页查看余额，可关闭此页面。';
  }

  private async mustOrder(orderNo: string) {
    const order = await this.orders.findOne({ where: { orderNo } });
    if (!order) throw ApiException.notFound('订单不存在');
    return order;
  }

  private publicOrder(order: PayOrder) {
    return {
      orderNo: order.orderNo,
      clientOrderNo: order.clientOrderNo,
      status: order.status,
      amountCents: order.amountCents,
      payScene: order.payScene,
      payUrl: order.payToken ? this.alipay.cashierUrl(order.payToken) : '',
      expiredAt: order.expiredAt,
      paidAt: order.paidAt,
      subject: order.subject,
      refundState: order.refundState,
      refundedCents: order.refundedCents,
      testPay: order.testPay,
    };
  }

  private toPayResult(order: PayOrder) {
    return {
      type: 'pay' as const,
      orderNo: order.orderNo,
      clientOrderNo: order.clientOrderNo,
      status: order.status,
      amountCents: order.amountCents,
      payUrl: order.payToken ? this.alipay.cashierUrl(order.payToken) : '',
      expiredAt: order.expiredAt,
      subject: order.subject,
    };
  }

  private async expireMinutes() {
    const s = await this.settings.findOne({ where: { key: 'order.expireMinutes' } });
    const n = Number(s?.value || ORDER_EXPIRE_MINUTES);
    if (!Number.isInteger(n) || n < 1 || n > 1440) return ORDER_EXPIRE_MINUTES;
    return n;
  }

  private async minRechargeCents() {
    const s = await this.settings.findOne({ where: { key: 'pay.minRechargeCents' } });
    const n = Number(s?.value || MIN_RECHARGE_CENTS);
    if (!Number.isInteger(n) || n < 1) return MIN_RECHARGE_CENTS;
    return n;
  }

  private async defaultDivisionMode(hasReceiver: boolean) {
    if (!hasReceiver) return 'FORBID';
    const s = await this.settings.findOne({ where: { key: 'division.defaultMode' } });
    const v = s?.value || 'AUTO';
    return v === 'MANUAL' || v === 'AUTO' ? v : 'FORBID';
  }
}

function parseReceiptCents(raw?: string) {
  if (!raw) return undefined;
  try {
    return yuanToCents(raw);
  } catch {
    return undefined;
  }
}
