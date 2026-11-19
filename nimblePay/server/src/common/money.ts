import { ApiException } from './api-exception';

/** 支付宝电脑网站支付单笔上限 1 亿元 = 10_000_000_000 分 */
export const MAX_CENTS = 10_000_000_000;
/** 1% = 100 基点；10.1% = 1010 基点；100% = 10000 基点 */
export const MAX_BPS = 10000;

const TWO_DECIMALS = /^-?(0|[1-9]\d*)(\.\d{1,2})?$/;

/**
 * 元 → 分。只允许最多两位小数：10.1 可以，10.111 拒绝（不会四舍五入）。
 * 数字走“是否就是两位小数”判定，避免 0.29*100 浮点误差，也避免 10.111 被悄悄 round。
 */
export function yuanToCents(yuan: string | number, allowNegative = false): number {
  if (typeof yuan === 'number') {
    if (!Number.isFinite(yuan)) throw ApiException.bad('金额不合法');
    if (yuan < 0 && !allowNegative) throw ApiException.bad('金额不能为负');
    const scaled = yuan * 100;
    const rounded = Math.round(scaled);
    if (Math.abs(scaled - rounded) > 1e-6) {
      throw ApiException.bad('金额最多两位小数，例如 10.1；不支持 10.111');
    }
    return assertCents(rounded, allowNegative ? -MAX_CENTS : 0);
  }
  const s = String(yuan).replace(/,/g, '').replace(/元/g, '').trim();
  if (!s) throw ApiException.bad('金额不能为空');
  if (!TWO_DECIMALS.test(s)) {
    throw ApiException.bad('金额最多两位小数，例如 10.1；不支持 10.111');
  }
  const neg = s.startsWith('-');
  if (neg && !allowNegative) throw ApiException.bad('金额不能为负');
  const unsigned = neg ? s.slice(1) : s;
  const [i, f = ''] = unsigned.split('.');
  const cents = Number(i) * 100 + Number((f + '00').slice(0, 2));
  return assertCents(neg ? -cents : cents, allowNegative ? -MAX_CENTS : 0);
}

/** 分 → 元字符串，始终两位小数，供支付宝 API 使用 */
export function centsToYuan(cents: number): string {
  assertCents(cents, -MAX_CENTS);
  const sign = cents < 0 ? '-' : '';
  const n = Math.abs(cents);
  return `${sign}${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`;
}

export function amountMatches(cents: number, yuan: string | undefined | null): boolean {
  if (yuan === undefined || yuan === null || yuan === '') return false;
  try {
    return yuanToCents(yuan, true) === cents;
  } catch {
    return false;
  }
}

/** 账单解析：空为 0；非法金额（含三位小数）抛错，由对账标记为解析失败而不是 round */
export function parseYuanToCents(raw: string | number | undefined | null): number {
  if (raw === undefined || raw === null || raw === '') return 0;
  return yuanToCents(raw, true);
}

export function assertCents(n: number, min = 0, max = MAX_CENTS) {
  if (!Number.isInteger(n)) throw ApiException.bad('金额须为整数分');
  if (n < min || n > max) throw ApiException.bad(`金额超出范围（${(min / 100).toFixed(2)}～${(max / 100).toFixed(2)} 元）`);
  return n;
}

/** 1 基点 = 0.01%。10.1% = 1010；10.11% = 1011；不支持 10.111% */
export function assertBps(n: number) {
  if (!Number.isInteger(n) || n < 1 || n > MAX_BPS) {
    throw ApiException.bad('分账比例须为 1～10000 基点（精确到 0.01%，例如 10.1% = 1010，不支持 10.111%）');
  }
  return n;
}

export function assertAlipayIdentity(type: string, account: string) {
  const a = account.trim();
  if (!a) throw ApiException.bad('收款账号不能为空');
  if (type === 'ALIPAY_USER_ID') {
    if (!/^2088\d{12}$/.test(a)) {
      throw ApiException.bad('支付宝 userId 须为 2088 开头的 16 位数字');
    }
    return a;
  }
  const phone = /^1\d{10}$/.test(a);
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a);
  if (!phone && !email) {
    throw ApiException.bad('支付宝登录号须为 11 位手机号或邮箱');
  }
  return a;
}

export function alipayAccountType(account: string): 'userId' | 'loginName' {
  return /^2088\d{12}$/.test(account.trim()) ? 'userId' : 'loginName';
}

export function alipayIdentityType(account: string): 'ALIPAY_USER_ID' | 'ALIPAY_LOGON_ID' {
  return alipayAccountType(account) === 'userId' ? 'ALIPAY_USER_ID' : 'ALIPAY_LOGON_ID';
}

/** 电脑网站支付 subject 不能含 / = & */
export function alipaySubject(raw: string) {
  const s = String(raw || '')
    .replace(/[/=&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 256);
  return s || '余额充值';
}
