export const API_PREFIX = 'api';

/**
 * 浏览器和支付宝要访问的公网入口，统一挂在 /api/npay/ 下。
 * 主站只代理这一段；/api/open、/api/admin 仍只在本机调用。
 */
export const PUBLIC_PAY_PREFIX = 'npay';

export function isApiRoute(url: unknown, segment: string): boolean {
  const path = String(url || '').split('?')[0];
  const base = `/${API_PREFIX}/${segment}`;
  return path === base || path.startsWith(`${base}/`);
}

export const ORDER_EXPIRE_MINUTES = 15;
export const PAY_SCENE_PAGE = 'PAGE';
export const ALIPAY_PRODUCT_PAGE = 'FAST_INSTANT_TRADE_PAY';
export const TEST_PAY_ORDER_PREFIX = 'NPT';
export const TEST_PAY_AMOUNT_CENTS = 1;
export const TEST_PAY_EXTERNAL_ID = '__alipay_test__';
/** 开放接口每分钟总限额。扣费和退回是高频调用，默认放宽；可用环境变量 OPEN_RATE_LIMIT_PER_MIN 覆盖 */
export const OPEN_RATE_LIMIT_PER_MIN = 3000;
export const OPEN_PAY_RATE_LIMIT_PER_MIN = 20;
export const NONCE_TTL_SEC = 600;
export const RECON_MAX_DAYS = 31;
export const NIMBLE_APP_ID = 'nimble-web';
export const DEFAULT_APP_SECRET = 'nimblepay-local-hmac-secret-v1';
export const MIN_RECHARGE_CENTS = 100;

/** 奖励规则，运营在后台「业务参数」里改。后台界面一律按元填写，库里存分，读写时换算 */
export const REWARD_SETTINGS = {
  signupGiftCents: { key: 'reward.signupGiftCents', name: '新用户赠送', fallback: 0 },
  referralCents: { key: 'reward.referralCents', name: '邀请奖励（邀请人获得）', fallback: 1400 },
  referralMinRechargeCents: {
    key: 'reward.referralMinRechargeCents',
    name: '邀请奖励：被邀请人首充最低金额',
    fallback: 100,
  },
} as const;
export const REWARD_SETTING_PREFIX = 'reward.';

export const PERMS = {
  DASHBOARD_VIEW: 'dashboard:view',
  WALLET_VIEW: 'wallet:view',
  
  WALLET_EDIT: 'wallet:edit',
  ORDER_VIEW: 'order:view',
  ORDER_OPERATE: 'order:operate',
  REFUND_VIEW: 'refund:view',
  REFUND_CREATE: 'refund:create',
  TRANSFER_VIEW: 'transfer:view',
  TRANSFER_CREATE: 'transfer:create',
  DIVISION_VIEW: 'division:view',
  DIVISION_EDIT: 'division:edit',
  DIVISION_EXEC: 'division:exec',
  RECON_VIEW: 'recon:view',
  RECON_EXEC: 'recon:exec',
  ALIPAY_VIEW: 'alipay:view',
  ALIPAY_EDIT: 'alipay:edit',
  IAM_VIEW: 'iam:view',
  IAM_EDIT: 'iam:edit',
  AUDIT_VIEW: 'audit:view',
} as const;

export const ALL_PERMS: { code: string; name: string; group: string }[] = [
  { code: PERMS.DASHBOARD_VIEW, name: '工作台', group: '工作台' },
  { code: PERMS.WALLET_VIEW, name: '查看用户余额', group: '钱包' },
  { code: PERMS.WALLET_EDIT, name: '调整余额', group: '钱包' },
  { code: PERMS.ORDER_VIEW, name: '查看订单', group: '支付' },
  { code: PERMS.ORDER_OPERATE, name: '操作订单', group: '支付' },
  { code: PERMS.REFUND_VIEW, name: '查看退款', group: '退款' },
  { code: PERMS.REFUND_CREATE, name: '发起退款', group: '退款' },
  { code: PERMS.TRANSFER_VIEW, name: '查看转账', group: '转账' },
  { code: PERMS.TRANSFER_CREATE, name: '发起转账', group: '转账' },
  { code: PERMS.DIVISION_VIEW, name: '查看分账', group: '分账' },
  { code: PERMS.DIVISION_EDIT, name: '编辑分账接收方', group: '分账' },
  { code: PERMS.DIVISION_EXEC, name: '执行分账', group: '分账' },
  { code: PERMS.RECON_VIEW, name: '查看对账', group: '对账' },
  { code: PERMS.RECON_EXEC, name: '执行对账', group: '对账' },
  { code: PERMS.ALIPAY_VIEW, name: '查看系统配置', group: '配置' },
  { code: PERMS.ALIPAY_EDIT, name: '编辑系统配置', group: '配置' },
  { code: PERMS.IAM_VIEW, name: '查看权限', group: '系统' },
  { code: PERMS.IAM_EDIT, name: '编辑权限', group: '系统' },
  { code: PERMS.AUDIT_VIEW, name: '查看审计日志', group: '系统' },
];
