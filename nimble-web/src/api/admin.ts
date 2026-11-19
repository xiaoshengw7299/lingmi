import { get, patch, put } from '@/utils/request'
import type { BillTotals, LedgerItem, ModelBill, PageResult, Paged } from '@/types'

/** 支付服务里的钱包概况，单位分。支付服务不可用时整个对象为 null */
export interface WalletSummary {
  balanceCents: number
  rechargeCents: number
  /** 净消费，已扣除失败退回 */
  consumeCents: number
}

export interface AdminUser {
  id: number
  loginName: string | null
  nickname: string
  isAdmin: boolean
  isSuperAdmin: boolean
  isDistributor: boolean
  /** 0 普通用户，1 一级分销，2 二级分销。取消后仍保留 */
  distributorLevel: 0 | 1 | 2
  /** 佣金比例（%），仅分销商有意义 */
  commissionPercent: number
  /** 所属分销商账号 ID，注册时确定 */
  distributorId: number | null
  status: 0 | 1
  lastLoginAt: string | null
  createdAt: string
  wallet: WalletSummary | null
}

export interface AccountOverview {
  user: Omit<AdminUser, 'wallet'>
  wallet: WalletSummary | null
  counts: {
    videos: number
    shortVideos: number
  }
}

export const getAccounts = (params: { page?: number; pageSize?: number; keyword?: string }) =>
  get<PageResult<AdminUser>>('/admin/users', params)

export const getAccountOverview = (id: number) => get<AccountOverview>(`/admin/users/${id}`)

export const getAccountLedgers = (id: number, page: number, pageSize: number) =>
  get<Paged<LedgerItem>>(`/admin/users/${id}/ledgers`, { page, pageSize })

export const setAccountStatus = (id: number, status: 0 | 1) => patch(`/admin/users/${id}/status`, { status })

/** 指定 / 取消管理员，只有默认管理员能调；对方会被下线，重新登录后生效 */
export const setAccountAdmin = (id: number, isAdmin: boolean) => patch(`/admin/users/${id}/admin`, { isAdmin })

/** 任命 / 取消分销商或调整佣金比例，只有默认管理员能调；对方不用重新登录，立即生效 */
export const setAccountDistributor = (id: number, isDistributor: boolean, commissionPercent?: number) =>
  patch(`/admin/users/${id}/distributor`, { isDistributor, commissionPercent })

export type UsageRange = '7d' | '30d' | 'all'

export interface PlatformStats {
  users: {
    total: number
    today: number
    online: number
    onlineWindowMinutes: number
    activeToday: number
    trend: Array<{ date: string; count: number }>
  }
  works: { videos: number; shortVideos: number }
  /** 支付服务不可用时为 null */
  recharge: {
    walletCount: number
    balanceCents: number
    rechargeUsers: number
    rechargeOrders: number
    rechargeCents: number
    refundedCents: number
    todayRechargeUsers: number
    todayRechargeOrders: number
    todayRechargeCents: number
    trend: Array<{ date: string; cents: number; users: number }>
  } | null
  usage: {
    range: UsageRange
    kinds: Array<BillTotals & { kind: ModelBill['kind'] }>
    models: ModelBill[]
  }
}

export const getPlatformStats = (range: UsageRange) => get<PlatformStats>('/admin/stats', { range })

export interface BillRow {
  id: number
  createdAt: string
  userId: number
  loginName: string | null
  nickname: string | null
  kind: ModelBill['kind']
  modelName: string
  chargeCents: number
  upstreamCents: number
  profitCents: number
  /** 当前筛选下应付的分销佣金。全平台是一级、二级加总；按分销商筛选时只算这个人应得的 */
  commissionCents: number
  /** 任务失败已退款，不计入汇总 */
  refunded: boolean
}

export interface BillQuery {
  page?: number
  pageSize?: number
  userId?: number
  distributorId?: number
  kind?: ModelBill['kind']
  /** YYYY-MM-DD，含当天 */
  from?: string
  to?: string
}

/** 全平台消费账单，summary 只算有效调用 */
export const getBills = (params: BillQuery) => get<PageResult<BillRow> & { summary: BillTotals }>('/admin/bills', params)

export interface DistributorRow extends BillTotals {
  id: number
  loginName: string | null
  nickname: string
  /** false 表示已取消，但名下用户还在 */
  isDistributor: boolean
  /** 1 一级，2 二级 */
  level: 1 | 2
  /** 二级的上级昵称 */
  parentName: string | null
  /** 调整比例时的上限。二级不能超过上级当前比例 */
  rateCap: number
  /** 当前比例，只对之后产生的账单生效 */
  commissionPercent: number
  createdAt: string
  members: number
}

export const getDistributors = () => get<DistributorRow[]>('/admin/distributors')

export interface ShortVideoPromotion {
  enabled: boolean
  startsAt: string | null
  endsAt: string | null
}

const shortVideoPromotionPath = '/admin/config/short-video-promotion'
export const getShortVideoPromotion = () => get<ShortVideoPromotion>(shortVideoPromotionPath)
export const saveShortVideoPromotion = (data: ShortVideoPromotion) => put<ShortVideoPromotion>(shortVideoPromotionPath, data)
