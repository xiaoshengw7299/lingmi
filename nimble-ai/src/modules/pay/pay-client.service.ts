import { createHmac, createHash, randomBytes } from 'crypto';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PayPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PayLedgerItem {
  id: string;
  type: string;
  /** 带正负号：加钱为正，花钱为负 */
  amountCents: number;
  balanceAfter: number;
  remark: string;
  createdAt: string;
}

export interface PayRewardRule {
  rewardCents: number;
  minRechargeCents: number;
  signupGiftCents: number;
}

export interface PayReferralOverview extends PayPage<{
  inviteeExternalUserId: string;
  status: 'BOUND' | 'REWARDED';
  rewardCents: number;
  createdAt: string;
  rewardedAt: string | null;
}> {
  rule: PayRewardRule;
  invitedCount: number;
  rewardedCount: number;
  totalRewardCents: number;
}

/** 管理后台看用户用：余额、累计充值、累计消费（净额，已扣除失败退回），单位分 */
export interface PayWalletSummary {
  externalUserId: string;
  balanceCents: number;
  rechargeCents: number;
  consumeCents: number;
}

/** 真实充值汇总（不含支付宝测试单），单位分 */
export interface PayStats {
  walletCount: number;
  balanceCents: number;
  rechargeUsers: number;
  rechargeOrders: number;
  rechargeCents: number;
  refundedCents: number;
  todayRechargeUsers: number;
  todayRechargeOrders: number;
  todayRechargeCents: number;
  trend: Array<{ date: string; cents: number; users: number }>;
}

interface WalletIdentity {
  externalUserId: string;
  email?: string | null;
  nickname?: string | null;
}

/** nimblePay 开放接口的签名客户端。所有金额单位都是分 */
@Injectable()
export class PayClientService {
  private readonly logger = new Logger(PayClientService.name);

  constructor(private readonly config: ConfigService) {}

  enabled() {
    return Boolean(this.baseUrl() && this.appId() && this.secret());
  }

  ensureWallet(input: WalletIdentity & { inviterExternalUserId?: string }) {
    return this.call<{ balanceCents: number; externalUserId: string }>('POST', '/api/open/v1/wallet/ensure', {
      externalUserId: input.externalUserId,
      email: input.email || '',
      nickname: input.nickname || '',
      inviterExternalUserId: input.inviterExternalUserId || undefined,
    });
  }

  wallet(externalUserId: string) {
    return this.call<{ balanceCents: number; status: string }>(
      'GET',
      `/api/open/v1/wallet/${encodeURIComponent(externalUserId)}`,
    );
  }

  /** 扣款。bizNo 幂等；partial=true 时余额不足扣到 0 不报错；余额不足会抛 402 */
  consume(input: { externalUserId: string; amountCents: number; bizNo: string; remark?: string; partial?: boolean }) {
    return this.call<{ chargedCents: number; balanceCents: number; duplicated: boolean }>(
      'POST',
      '/api/open/v1/wallet/consume',
      input,
    );
  }

  /** 业务奖励入账。同一 bizNo 只入一次，重复调用返回 duplicated */
  grant(input: { externalUserId: string; amountCents: number; bizNo: string; remark?: string }) {
    return this.call<{ amountCents: number; balanceCents: number; duplicated: boolean }>(
      'POST',
      '/api/open/v1/wallet/grant',
      input,
    );
  }

  refundConsume(externalUserId: string, bizNo: string) {
    return this.call<{ refundedCents: number; balanceCents: number }>(
      'POST',
      '/api/open/v1/wallet/consume/refund',
      { externalUserId, bizNo },
    );
  }

  ledgers(externalUserId: string, page: number, pageSize: number) {
    return this.call<PayPage<PayLedgerItem>>(
      'GET',
      `/api/open/v1/wallet/${encodeURIComponent(externalUserId)}/ledgers?page=${page}&pageSize=${pageSize}`,
    );
  }

  rewardRule() {
    return this.call<PayRewardRule>('GET', '/api/open/v1/reward-rule');
  }

  /** 批量钱包概况。没开过户的用户不在结果里 */
  summaries(externalUserIds: string[]) {
    return this.call<PayWalletSummary[]>('POST', '/api/open/v1/wallet/summaries', { externalUserIds });
  }

  stats() {
    return this.call<PayStats>('GET', '/api/open/v1/stats');
  }

  referral(externalUserId: string, page: number, pageSize: number) {
    return this.call<PayReferralOverview>(
      'GET',
      `/api/open/v1/referral/${encodeURIComponent(externalUserId)}?page=${page}&pageSize=${pageSize}`,
    );
  }

  recharge(input: WalletIdentity & { amountCents: number; clientOrderNo: string }) {
    return this.call<{ orderNo: string; payUrl: string; status: string; amountCents: number }>(
      'POST',
      '/api/open/v1/pay/recharge',
      input,
    );
  }

  order(orderNo: string, externalUserId: string) {
    const q = `externalUserId=${encodeURIComponent(externalUserId)}`;
    return this.call<{ orderNo: string; status: string; amountCents: number; balanceCents: number; payUrl: string }>(
      'GET',
      `/api/open/v1/pay/orders/${encodeURIComponent(orderNo)}?${q}`,
    );
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.enabled()) throw new HttpException('支付服务未配置', HttpStatus.SERVICE_UNAVAILABLE);
    const raw = body ? JSON.stringify(body) : '';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(12).toString('hex');
    const canonical = `${timestamp}\n${nonce}\n${method}\n${path.split('?')[0]}\n${createHash('sha256').update(raw).digest('hex')}`;
    const sign = createHmac('sha256', this.secret()).update(canonical).digest('hex');
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl()}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-App-Id': this.appId(),
          'X-Timestamp': timestamp,
          'X-Nonce': nonce,
          'X-Sign': sign,
        },
        body: method === 'GET' ? undefined : raw,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      this.logger.warn(`nimblePay ${method} ${path} 不可达: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('支付服务暂不可用', HttpStatus.BAD_GATEWAY);
    }
    const json = (await res.json().catch(() => null)) as { code?: number; message?: string; msg?: string; data?: T } | null;
    const ok = !!json && typeof json.code === 'number' && json.code >= 200 && json.code < 300;
    if (!res.ok || !ok) {
      const message = json?.message || json?.msg || '支付服务暂不可用';
      this.logger.warn(`nimblePay ${method} ${path} ${res.status} ${message}`);
      throw new HttpException(message, res.status || HttpStatus.BAD_GATEWAY);
    }
    return json.data as T;
  }

  private baseUrl() {
    return (this.config.get<string>('NIMBLEPAY_BASE_URL') || '').replace(/\/$/, '');
  }

  private appId() {
    return this.config.get<string>('NIMBLEPAY_APP_ID')?.trim() || '';
  }

  private secret() {
    return this.config.get<string>('NIMBLEPAY_APP_SECRET')?.trim() || '';
  }
}
