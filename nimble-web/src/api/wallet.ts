import { get, post } from '@/utils/request'
import type { LedgerItem, Paged, RechargeOrder, ReferralOverview, WalletOverview } from '@/types'

export const getWallet = () => get<WalletOverview>('/wallet')

export const rechargeWallet = (amountYuan: number) => post<RechargeOrder>('/wallet/recharge', { amountYuan })

export const getRechargeOrder = (orderNo: string) =>
  get<RechargeOrder & { balanceCents: number }>(`/wallet/orders/${encodeURIComponent(orderNo)}`)

export const getLedgers = (page: number, pageSize = 20) => get<Paged<LedgerItem>>('/wallet/ledgers', { page, pageSize })

export const getReferral = (page: number, pageSize = 10) => get<ReferralOverview>('/wallet/referral', { page, pageSize })

/** 公开的活动规则；支付服务不可用时为 null */
export const getPromo = () => get<ReferralOverview['rule'] | null>('/wallet/promo')
