import { get, patch, post } from '@/utils/request'
import type { UsageRange } from '@/api/admin'
import type { BillTotals, CostPriceRow, ModelBill, PageResult } from '@/types'

export interface DistributorOverview {
  /** 专属链接码：链接是 /login?ref=<code>，所有通过它（以及下线再邀请）来的用户都归这个分销商 */
  code: string
  /** 当前比例，只对之后产生的账单生效，已产生的佣金不变 */
  commissionPercent: number
  /** 只有一级的响应里有。为真才能指定下级；没有这个字段就不要出现入口 */
  canAppoint?: boolean
  team: { total: number; direct: number; today: number }
  usage: BillTotals & { range: UsageRange }
  models: ModelBill[]
}

export interface DistributorMember extends BillTotals {
  id: number
  loginName: string | null
  nickname: string | null
  /** true 是分销商直接邀请的，false 是下线再邀请来的 */
  direct: boolean
  /** 归在下级名下时是对方的名字；直属为 null */
  ownerName: string | null
  /** 可以指定为分销商 */
  appointable: boolean
  /** 已经是分销商，或曾经是但已停用 */
  badge: '分销商' | '已停用' | null
  createdAt: string
  lastLoginAt: string | null
}

export interface SubDistributor extends BillTotals {
  id: number
  loginName: string | null
  nickname: string | null
  isDistributor: boolean
  commissionPercent: number
  createdAt: string
  members: number
  /** 从我的比例里留下的佣金 */
  myCommissionCents: number
}

export const getDistributorOverview = (range: UsageRange) => get<DistributorOverview>('/distributor/overview', { range })

export const getDistributorMembers = (page: number, pageSize: number) =>
  get<PageResult<DistributorMember>>('/distributor/users', { page, pageSize })

export const getDistributorPricing = () => get<{ currency: 'CNY'; rows: CostPriceRow[] }>('/distributor/pricing')

export const getSubDistributors = () => get<SubDistributor[]>('/distributor/subordinates')

export const appointSubDistributor = (userId: number, commissionPercent: number) =>
  post('/distributor/subordinates', { userId, commissionPercent })

export const updateSubDistributor = (id: number, body: { isDistributor?: boolean; commissionPercent?: number }) =>
  patch(`/distributor/subordinates/${id}`, body)
