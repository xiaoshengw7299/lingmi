import request, { del, get, post } from '@/utils/request'

export type UserAssetKind = 'image' | 'video' | 'audio' | 'prompt'
export type MediaKind = Exclude<UserAssetKind, 'prompt'>

export interface UserAsset {
  id: string
  kind: UserAssetKind
  name: string
  /** 媒体资产的公网地址；提示词为 null */
  url: string | null
  /** 提示词正文 */
  content: string | null
  meta: { prompt?: string; modelName?: string; from?: string } | null
  createdAt: string
}

export const ASSET_KIND_LABEL: Record<UserAssetKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  prompt: '提示词',
}

export const listAssets = (params?: { kind?: UserAssetKind; keyword?: string; page?: number; pageSize?: number }) =>
  get<{ items: UserAsset[]; total: number; page: number; pageSize: number }>('/assets', params)

/** 加入我的资产：媒体会在服务端复制成独立副本，源项目删除后依然可用 */
export const addAsset = (data: {
  kind: UserAssetKind
  name: string
  url?: string
  content?: string
  meta?: UserAsset['meta']
}) => post<UserAsset>('/assets', data)

export const uploadAsset = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return request.post('/assets/upload', form) as Promise<UserAsset>
}

export const deleteAsset = (id: string) => del<void>(`/assets/${id}`)
