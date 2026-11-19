import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { AlipaySdk, AlipayRequestError } from 'alipay-sdk';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Repository } from 'typeorm';
import { AlipayChannelError, ApiException, errorMessage, isAlipayTradeMissing } from '../../common/api-exception';
import { ALIPAY_PRODUCT_PAGE, API_PREFIX, PUBLIC_PAY_PREFIX } from '../../common/constants';
import { alipayAccountType, alipaySubject, centsToYuan } from '../../common/money';
import { SecretService } from '../../common/crypto/secret.service';
import { AlipayConfig } from '../../entities';

dayjs.extend(utc);
dayjs.extend(timezone);

export type AlipayNotifyPayload = Record<string, string>;

@Injectable()
export class AlipayService {
  private readonly logger = new Logger(AlipayService.name);
  private cached?: { sdk: AlipaySdk; appId: string; fingerprint: string };

  constructor(
    @InjectRepository(AlipayConfig) private readonly configs: Repository<AlipayConfig>,
    private readonly secrets: SecretService,
    private readonly config: ConfigService,
  ) {}

  invalidate() {
    this.cached = undefined;
  }

  publicBase(): string {
    return this.config.get<string>('PUBLIC_BASE_URL', 'http://127.0.0.1:8090').replace(/\/$/, '');
  }

  async notifyUrl(kind: 'pay' | 'refund' | 'transfer' = 'pay'): Promise<string> {
    const cfg = await this.configs.findOne({ where: { id: 'default' } });
    if (kind === 'pay' && cfg?.notifyUrlOverride) return cfg.notifyUrlOverride;
    return `${this.publicBase()}/${API_PREFIX}/${PUBLIC_PAY_PREFIX}/notify/alipay/${kind}`;
  }

  returnUrl(): string {
    return `${this.publicBase()}/${API_PREFIX}/${PUBLIC_PAY_PREFIX}/pay/return`;
  }

  cashierUrl(payToken: string): string {
    return `${this.publicBase()}/${API_PREFIX}/${PUBLIC_PAY_PREFIX}/pay/go/${payToken}`;
  }

  async getAppId(): Promise<string> {
    await this.getSdk();
    if (!this.cached?.appId) throw ApiException.bad('支付宝尚未配置');
    return this.cached.appId;
  }

  async verifyNotify(payload: AlipayNotifyPayload): Promise<boolean> {
    const sdk = await this.getSdk();
    try {
      return sdk.checkNotifySignV2(payload) || sdk.checkNotifySign(payload);
    } catch (e) {
      this.logger.warn(`notify sign failed: ${errorMessage(e)}`);
      return false;
    }
  }

  async pagePayForm(input: {
    orderNo: string;
    amountCents: number;
    subject: string;
    body?: string;
    expiredAt: Date;
    royaltyFreeze?: boolean;
    clientIp?: string;
  }): Promise<string> {
    const sdk = await this.getSdk();
    const bizContent: Record<string, unknown> = {
      out_trade_no: input.orderNo,
      total_amount: centsToYuan(input.amountCents),
      subject: alipaySubject(input.subject),
      body: alipaySubject(input.body || input.subject),
      product_code: ALIPAY_PRODUCT_PAGE,
      time_expire: formatAlipayTime(input.expiredAt),
      integration_type: 'PCWEB',
    };
    if (input.royaltyFreeze) bizContent.extend_params = { royalty_freeze: 'true' };
    if (input.clientIp) bizContent.business_params = JSON.stringify({ mc_create_trade_ip: input.clientIp });
    return sdk.pageExecute('alipay.trade.page.pay', 'POST', {
      notifyUrl: await this.notifyUrl('pay'),
      returnUrl: this.returnUrl(),
      bizContent,
    });
  }

  async assertAcceptingPayments() {
    const cfg = await this.configs.findOne({ where: { id: 'default' } });
    if (!cfg?.appId) throw ApiException.bad('请先填写并保存支付宝 APPID');
    if (!cfg.enabled) throw ApiException.bad('支付宝未启用，无法发起新的收款。请打开「启用」并保存');
  }

  async queryTrade(orderNo: string, tradeNo?: string, extra?: { settleInfo?: boolean }) {
    const body: Record<string, unknown> = {};
    if (tradeNo) body.trade_no = tradeNo;
    else body.out_trade_no = orderNo;
    if (extra?.settleInfo) body.query_options = ['trade_settle_info'];
    return this.curl<{
      trade_status?: string;
      trade_no?: string;
      out_trade_no?: string;
      total_amount?: string;
      receipt_amount?: string;
      buyer_logon_id?: string;
      app_id?: string;
      send_pay_date?: string;
      trade_settle_info?: {
        trade_settle_detail_list?: { trans_in?: string; amount?: string; operation_type?: string }[];
      };
    }>('POST', '/v3/alipay/trade/query', body);
  }

  async closeTrade(orderNo: string) {
    return this.curl('POST', '/v3/alipay/trade/close', { out_trade_no: orderNo });
  }

  async refund(input: {
    orderNo: string;
    refundNo: string;
    amountCents: number;
    reason: string;
    tradeNo?: string;
    royalty?: { account: string; amountCents: number }[];
  }) {
    const body: Record<string, unknown> = {
      out_trade_no: input.orderNo,
      out_request_no: input.refundNo,
      refund_amount: centsToYuan(input.amountCents),
      refund_reason: input.reason || '余额充值退款',
      notify_url: await this.notifyUrl('refund'),
    };
    if (input.tradeNo) body.trade_no = input.tradeNo;
    if (input.royalty?.length) {
      body.refund_royalty_parameters = input.royalty
        .filter((x) => x.amountCents > 0)
        .map((x) => ({
          royalty_type: 'transfer',
          trans_out: x.account,
          trans_out_type: alipayAccountType(x.account),
          amount: centsToYuan(x.amountCents),
        }));
    }
    return this.curl<{ fund_change?: string; trade_no?: string; out_trade_no?: string; refund_fee?: string }>(
      'POST',
      '/v3/alipay/trade/refund',
      body,
    );
  }

  async queryRefund(orderNo: string, refundNo: string) {
    return this.curl<{ refund_status?: string; trade_no?: string; refund_amount?: string }>(
      'POST',
      '/v3/alipay/trade/fastpay/refund/query',
      { out_trade_no: orderNo, out_request_no: refundNo },
    );
  }

  async transfer(input: {
    transferNo: string;
    amountCents: number;
    accountNo: string;
    accountName: string;
    identityType: string;
    orderTitle: string;
    remark: string;
  }) {
    const identityType =
      input.identityType === 'ALIPAY_USER_ID' || /^2088\d{12}$/.test(input.accountNo)
        ? 'ALIPAY_USER_ID'
        : 'ALIPAY_LOGON_ID';
    return this.curl<{
      out_biz_no?: string;
      order_id?: string;
      status?: string;
      pay_date?: string;
      trans_amount?: string;
    }>('POST', '/v3/alipay/fund/trans/uni/transfer', {
      out_biz_no: input.transferNo,
      trans_amount: centsToYuan(input.amountCents),
      product_code: 'TRANS_ACCOUNT_NO_PWD',
      biz_scene: 'DIRECT_TRANSFER',
      order_title: input.orderTitle || '余额转账',
      remark: input.remark || input.orderTitle || '余额转账',
      notify_url: await this.notifyUrl('transfer'),
      payee_info: {
        identity: input.accountNo,
        identity_type: identityType,
        name: input.accountName || undefined,
      },
    });
  }

  async queryTransfer(transferNo: string, orderId?: string) {
    const body: Record<string, unknown> = {
      product_code: 'TRANS_ACCOUNT_NO_PWD',
      biz_scene: 'DIRECT_TRANSFER',
    };
    if (orderId) body.order_id = orderId;
    else body.out_biz_no = transferNo;
    return this.curl<{
      status?: string;
      order_id?: string;
      fail_reason?: string;
      error_code?: string;
      trans_amount?: string;
      pay_date?: string;
      out_biz_no?: string;
    }>('POST', '/v3/alipay/fund/trans/common/query', body);
  }

  async bindReceivers(outRequestNo: string, list: { account: string; name: string }[]) {
    return this.curl('POST', '/v3/alipay/trade/royalty/relation/bind', {
      out_request_no: outRequestNo,
      receiver_list: list.map((x) => ({
        type: alipayAccountType(x.account),
        account: x.account,
        name: x.name,
        memo: 'nimblePay分账接收方',
      })),
    });
  }

  async unbindReceivers(outRequestNo: string, list: { account: string; name: string }[]) {
    return this.curl('POST', '/v3/alipay/trade/royalty/relation/unbind', {
      out_request_no: outRequestNo,
      receiver_list: list.map((x) => ({
        type: alipayAccountType(x.account),
        account: x.account,
        name: x.name,
      })),
    });
  }

  async settle(input: {
    batchNo: string;
    tradeNo: string;
    items: { account: string; name: string; amountCents: number; desc: string }[];
    finish?: boolean;
  }) {
    return this.curl('POST', '/v3/alipay/trade/order/settle', {
      out_request_no: input.batchNo,
      trade_no: input.tradeNo,
      royalty_mode: 'sync',
      extend_params: { royalty_finish: input.finish === false ? 'false' : 'true' },
      royalty_parameters: input.items.map((x) => ({
        royalty_type: 'transfer',
        trans_in_type: alipayAccountType(x.account),
        trans_in: x.account,
        trans_in_name: x.name,
        amount: centsToYuan(x.amountCents),
        desc: x.desc,
      })),
    });
  }

  async querySettle(batchNo: string, tradeNo: string) {
    return this.curl<{
      royalty_detail_list?: {
        trans_in?: string;
        amount?: string;
        state?: string;
        error_code?: string;
        error_desc?: string;
        operation_type?: string;
      }[];
    }>('POST', '/v3/alipay/trade/order/settle/query', {
      out_request_no: batchNo,
      trade_no: tradeNo,
    });
  }

  async queryRoyaltyDetails(batchNo: string, tradeNo: string, preferSettleInfo: boolean) {
    if (preferSettleInfo) {
      try {
        const trade = await this.queryTrade('', tradeNo, { settleInfo: true });
        const list = trade.trade_settle_info?.trade_settle_detail_list || [];
        if (list.length) {
          return {
            royalty_detail_list: list.map((d) => ({
              trans_in: d.trans_in,
              amount: d.amount,
              state: 'SUCCESS' as const,
              operation_type: d.operation_type,
            })),
          };
        }
      } catch (e) {
        this.logger.warn(`settle info ${tradeNo} ${errorMessage(e)}`);
      }
    }
    return this.querySettle(batchNo, tradeNo);
  }

  async queryBillDownloadUrl(billType: 'trade' | 'signcustomer', billDate: string) {
    return this.curl<{ bill_download_url?: string }>('GET', '/v3/alipay/data/dataservice/bill/downloadurl/query', {
      bill_type: billType,
      bill_date: billDate,
    });
  }

  async downloadBillFile(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw ApiException.bad(`下载支付宝账单失败 HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const head = buf.subarray(0, 32).toString('utf8');
    if (/<!DOCTYPE|<html/i.test(head)) throw ApiException.bad('账单下载地址返回了网页而非文件');
    return buf;
  }

  async ping(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.queryTrade('NP_CONFIG_PING');
      return { ok: true, message: await this.pingOkMessage('配置可用（查询接口已通）') };
    } catch (e) {
      const msg = errorMessage(e);
      if (isAlipayTradeMissing(e) || /不存在|TRADE_NOT_EXIST/i.test(msg)) {
        return { ok: true, message: await this.pingOkMessage('签名与网关正常') };
      }
      this.logger.warn(`ping failed: ${msg}`);
      return { ok: false, message: hintPing(msg) };
    }
  }

  private async pingOkMessage(base: string) {
    const cfg = await this.configs.findOne({ where: { id: 'default' } });
    return cfg?.enabled ? base : `${base}。当前未启用，不会接受新的收款。`;
  }

  private async curl<T = Record<string, unknown>>(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const sdk = await this.getSdk();
    try {
      const result =
        method === 'GET'
          ? await sdk.curl<T>(method, path, { query: toQuery(params) })
          : await sdk.curl<T>(method, path, { body: params });
      return (result.data ?? result) as T;
    } catch (e: unknown) {
      if (e instanceof AlipayRequestError) {
        this.logChannelError(path, e.code || '', e.message);
        throw new AlipayChannelError(e.code || '', e.message);
      }
      const err = e as {
        message?: string;
        code?: string;
        data?: { message?: string; code?: string; sub_msg?: string; sub_code?: string };
      };
      const msg = err.data?.sub_msg || err.data?.message || err.message || '支付宝接口调用失败';
      const code = err.data?.sub_code || err.data?.code || err.code || '';
      this.logChannelError(path, code, msg);
      throw new AlipayChannelError(code, msg);
    }
  }

  private logChannelError(path: string, code: string, msg: string) {
    const text = `${code} ${msg}`.trim();
    if (/TRADE_NOT_EXIST|ORDER_NOT_EXIST|REFUND_NOT_EXIST/i.test(text)) {
      this.logger.debug(`alipay ${path} ${text}`);
      return;
    }
    this.logger.warn(`alipay ${path} failed ${text}`);
  }

  private async getSdk(): Promise<AlipaySdk> {
    const cfg = await this.configs.findOne({ where: { id: 'default' } });
    if (!cfg?.appId) throw ApiException.bad('请先填写并保存支付宝 APPID');
    if (!cfg.privateKeyEnc) throw ApiException.bad('支付宝应用私钥未配置');
    if (cfg.useCert) {
      if (!cfg.appCertEnc || !cfg.alipayPublicCertEnc || !cfg.alipayRootCertEnc) {
        throw ApiException.bad('证书模式需要同时配置应用公钥证书、支付宝公钥证书和支付宝根证书');
      }
    } else if (!cfg.alipayPublicKeyEnc) {
      throw ApiException.bad('支付宝公钥未配置');
    }
    const fingerprint = [
      cfg.appId,
      cfg.sandbox,
      cfg.useCert,
      cfg.signType,
      cfg.keyType,
      cfg.privateKeyEnc,
      cfg.alipayPublicKeyEnc,
      cfg.appCertEnc,
      cfg.alipayPublicCertEnc,
      cfg.alipayRootCertEnc,
    ].join('|');
    if (this.cached && this.cached.fingerprint === fingerprint) return this.cached.sdk;
    const privateKey = this.secrets.decrypt(cfg.privateKeyEnc);
    if (!privateKey) throw ApiException.bad('支付宝应用私钥未配置');
    const endpoint = cfg.sandbox ? 'https://openapi-sandbox.dl.alipaydev.com' : 'https://openapi.alipay.com';
    const sdkCfg: ConstructorParameters<typeof AlipaySdk>[0] = {
      appId: cfg.appId,
      privateKey,
      signType: (cfg.signType as 'RSA2') || 'RSA2',
      keyType: (cfg.keyType as 'PKCS1' | 'PKCS8') || 'PKCS1',
      endpoint,
      gateway: `${endpoint}/gateway.do`,
    };
    if (cfg.useCert) {
      sdkCfg.appCertContent = this.secrets.decrypt(cfg.appCertEnc);
      sdkCfg.alipayPublicCertContent = this.secrets.decrypt(cfg.alipayPublicCertEnc);
      sdkCfg.alipayRootCertContent = this.secrets.decrypt(cfg.alipayRootCertEnc);
      if (!sdkCfg.appCertContent || !sdkCfg.alipayPublicCertContent || !sdkCfg.alipayRootCertContent) {
        throw ApiException.bad('证书内容为空，请重新上传应用公钥证书、支付宝公钥证书和支付宝根证书');
      }
    } else {
      sdkCfg.alipayPublicKey = this.secrets.decrypt(cfg.alipayPublicKeyEnc);
      if (!sdkCfg.alipayPublicKey) throw ApiException.bad('支付宝公钥未配置');
    }
    try {
      const sdk = new AlipaySdk(sdkCfg);
      this.cached = { sdk, appId: cfg.appId, fingerprint };
      return sdk;
    } catch (e) {
      throw ApiException.bad(`支付宝 SDK 初始化失败：${errorMessage(e)}`);
    }
  }
}

function toQuery(params: Record<string, unknown>): Record<string, string> {
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    q[k] = String(v);
  }
  return q;
}

function hintPing(msg: string) {
  if (/尚未配置|未启用|私钥未配置|公钥未配置|证书/.test(msg)) return msg;
  if (/invalid-signature|INVALID_SIGNATURE|验签|签名/.test(msg)) {
    return `${msg}。请核对应用私钥、支付宝公钥、PKCS1/PKCS8，以及沙箱开关是否与开放平台一致。`;
  }
  if (/invalid-app-id|INVALID_APP_ID|appid|APPID/i.test(msg)) {
    return `${msg}。请核对 APPID，沙箱应用不要配正式网关。`;
  }
  if (/DECODER|unsupported|PKCS|private key|PEM/i.test(msg)) {
    return `${msg}。私钥格式可能不对，尝试切换 PKCS1 / PKCS8，并保留 PEM 头尾。`;
  }
  return msg;
}

function formatAlipayTime(d: Date) {
  try {
    return dayjs(d).tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss');
  } catch {
    return dayjs(d).format('YYYY-MM-DD HH:mm:ss');
  }
}
