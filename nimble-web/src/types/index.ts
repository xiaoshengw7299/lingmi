/** 统一 API 响应结构 */
export interface ApiResponse<T = any> {
  code: number
  message: string
  data: T
  timestamp?: string
}

export interface PageResult<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

export interface UserInfo {
  canChangeLoginName?: boolean
  id: number
  /** 系统分配的登录账号 */
  loginName?: string | null
  nickname?: string
  avatar?: string | null
  status: 0 | 1
  plan?: string
  isAdmin?: boolean
  isSuperAdmin?: boolean
  isDistributor?: boolean
  /** 微信登录的账号可能还没设置过密码，改密码时据此决定要不要填旧密码 */
  hasPassword?: boolean
  lastLoginAt?: string
  createdAt: string
}

export interface TokenResult {
  accessToken: string
  refreshToken: string
  user?: UserInfo
}

/** 价目表一行，单价单位是 元 / unit */
export interface PriceRow {
  id: string
  kind: 'video' | 'image' | 'audio' | 'llm' | 'vision' | 'tool'
  vendor: string
  name: string
  tier?: 'flagship' | 'value'
  unit: string
  scenario: string
  price: number | null
  officialPrice: number | null
  /** 仅文本模型：输出 token 单价 */
  outputPrice?: number | null
  outputOfficialPrice?: number | null
}

/** 分销商和管理员能看到的价目表行：多了上游成本价 */
export interface CostPriceRow extends PriceRow {
  costPrice: number | null
}

export interface AdminPriceRow extends CostPriceRow {
  markup: number
  markupOverride: number | null
  officialOverride: number | null
  pricingMode?: 'video' | 'markup'
  discount?: number | null
  /** 最近一次成功询价时间 */
  quotedAt?: string | null
  /** 最近一次询价失败的原因 */
  quoteError?: string | null
}

/** 一组账单的汇总，金额单位分。利润 = 用户实付 - 上游成本；佣金是每笔账单上固定下来的分销佣金之和 */
export interface BillTotals {
  calls: number
  chargeCents: number
  upstreamCents: number
  profitCents: number
  commissionCents: number
}

export interface ModelBill extends BillTotals {
  model: string
  modelName: string
  kind: 'image' | 'video' | 'audio' | 'llm' | 'tool'
  users: number
}

export interface WalletOverview {
  balanceCents: number
  minRechargeYuan: number
}

export interface RechargeOrder {
  orderNo: string
  payUrl: string
  status: string
  amountCents: number
}

export interface LedgerItem {
  id: string
  type: string
  /** 带正负号：加钱为正，花钱为负，单位分 */
  amountCents: number
  balanceAfter: number
  remark: string
  createdAt: string
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface ReferralOverview extends Paged<{
  name: string
  status: 'BOUND' | 'REWARDED'
  rewardCents: number
  createdAt: string
  rewardedAt: string | null
}> {
  code: string
  rule: { rewardCents: number; minRechargeCents: number; signupGiftCents: number }
  invitedCount: number
  rewardedCount: number
  totalRewardCents: number
}
