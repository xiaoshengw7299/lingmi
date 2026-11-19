import { get, post, put } from '@/utils/request'
import type { AdminPriceRow, PriceRow } from '@/types'

/** 公开价目表，不需要登录 */
export const getPriceBoard = () => get<{ currency: 'CNY'; rows: PriceRow[] }>('/pricing/models')

export interface PricingSettings {
  usdCny: number
  fxUpdatedAt: string
  markup: number
}

export const getAdminPricing = () => get<{ settings: PricingSettings; rows: AdminPriceRow[] }>('/admin/pricing')

export const savePricingSettings = (data: { markup?: number | null }) => put<PricingSettings>('/admin/pricing/settings', data)

export const saveModelPricing = (
  id: string,
  data: { markup?: number | null; officialUnitCny?: number | null; discount?: number | null },
) =>
  put<AdminPriceRow>(`/admin/pricing/models/${encodeURIComponent(id)}`, data)

export interface QuoteFailure {
  id: string
  message: string
}

/** 重新取汇率，并向 Atlas 逐个询价后写入数据库 */
export const refreshPricing = () =>
  post<{ settings: PricingSettings; rows: AdminPriceRow[]; failed: QuoteFailure[] }>('/admin/pricing/refresh')
