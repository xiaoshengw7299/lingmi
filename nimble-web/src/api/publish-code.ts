import { get, post, put } from '@/utils/request'

export interface PublishCodeSettings {
  code: string
  enabled: boolean
  displayName: string
  caption: string
  hashtags: string[]
  poiId: string
  poiName: string
  xhsTitle: string
  qrCaption: string
  viewCount: number
  douyinCount: number
  xhsCount: number
  workCount: number
  platforms: { douyin: boolean; xhs: boolean }
  videoReachable: boolean
}

export interface PublishWork {
  taskId: string
  index: number
  subject: string
  aspect: string
  videoUrl: string
  createdAt: string
}

export interface PublishLanding {
  displayName: string
  avatar: string | null
  caption: string
  hashtags: string[]
  poiName: string
  poiReady: boolean
  xhsTitle: string
  platforms: { douyin: boolean; xhs: boolean }
  videoReachable: boolean
  truncated: boolean
  works: PublishWork[]
}

export interface PublishShareBody {
  taskId: string
  index: number
  caption: string
}

export type VideoSharePlatform = 'douyin' | 'xhs'
export type VideoShareSource = 'short-video' | 'tool' | 'generation' | 'asset' | 'project' | 'video-example'
  | 'canvas' | 'canvas-example' | 'prompt' | 'forum' | 'tool-example' | 'stock'

export interface VideoShareTarget {
  source: VideoShareSource
  id: string
  video?: string
  caption?: string
}

export interface XhsSharePayload {
  appKey: string
  nonce: string
  timestamp: string
  signature: string
  video: string
  title: string
  content: string
}

export const getPublishCode = () => get<PublishCodeSettings>('/publish-code')

export const savePublishCode = (data: Pick<PublishCodeSettings, 'enabled' | 'displayName' | 'caption' | 'hashtags' | 'poiId' | 'poiName' | 'xhsTitle' | 'qrCaption'>) =>
  put<PublishCodeSettings>('/publish-code', data)

export const getPublishLanding = (code: string) => get<PublishLanding>(`/publish-code/p/${code}`)

export const createDouyinShare = (code: string, data: PublishShareBody) =>
  post<{ schema: string; poiAttached: boolean }>(`/publish-code/p/${code}/douyin`, data)

export const createXhsShare = (code: string, data: PublishShareBody) =>
  post<XhsSharePayload & { poiName: string }>(`/publish-code/p/${code}/xhs`, data)

let platformsRequest: Promise<Record<VideoSharePlatform, boolean>> | undefined
export const getVideoSharePlatforms = () =>
  (platformsRequest ??= get<Record<VideoSharePlatform, boolean>>('/publish-code/platforms').catch((error) => {
    platformsRequest = undefined
    throw error
  }))

export const prepareDouyinVideo = (data: VideoShareTarget) =>
  post<{ schema: string }>('/publish-code/video', { ...data, platform: 'douyin' })

export const prepareXhsVideo = (data: VideoShareTarget) =>
  post<XhsSharePayload>('/publish-code/video', { ...data, platform: 'xhs' })
