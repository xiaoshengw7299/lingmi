import { get, post, del } from '@/utils/request'
import request from '@/utils/request'
import type { LoraSelection, MediaModelOption } from '@/api/video'
import { isAxiosError } from 'axios'

export type ShortVideoStatus = 'queued' | 'generating' | 'success' | 'failed'
export type ShortVideoPriceMode = 'promotion' | 'metered' | 'disabled'

export interface ShortVideoQuote {
  mode: ShortVideoPriceMode
  chargeCents: number | null
  minBalanceCents: number
  serverTime: string
  startsAt: string | null
  endsAt: string | null
}

interface ShortVideoPricedRequest {
  confirmedPricing?: ShortVideoPriceMode
}

export const getShortVideoPricing = () => get<ShortVideoQuote>('/short-video/pricing', undefined, { timeout: 5000 })

export function shortVideoPriceChange(error: unknown): ShortVideoQuote | undefined {
  if (!isAxiosError<{ data?: { shortVideoQuote?: ShortVideoQuote } }>(error)) return
  if (error.response?.status === 409) return error.response.data.data?.shortVideoQuote
}

export interface ShortVideoOption {
  value: string
  label: string
  hint?: string
}

export interface ShortVideoVoiceGroup {
  value: string
  label: string
  voices: ShortVideoOption[]
}

export interface ShortVideoOptions {
  aspects: ShortVideoOption[]
  voiceGroups: ShortVideoVoiceGroup[]
  voices: ShortVideoOption[]
  sources: ShortVideoOption[]
  stockSources?: ShortVideoOption[]
  stockProviders?: Array<{ value: string; label: string; hint?: string; configured?: boolean }>
  imageModels?: MediaModelOption[]
  bgmTypes: ShortVideoOption[]
  concatModes: ShortVideoOption[]
  fitModes: ShortVideoOption[]
  transitions: ShortVideoOption[]
  subtitlePositions: ShortVideoOption[]
  fonts: ShortVideoOption[]
  defaults: {
    aspect: string
    voiceName: string
    voiceGroup: string
    bgmType: string
    videoSource: string
    terms: string
    scriptPrompt: string
    paragraphNumber: number
    fitMode: string
    concatMode: string
    transitionMode: string
    clipDuration: number
    clipSpeed: number
    videoCount: number
    matchMaterials: boolean
    semanticMatch?: boolean
    stockDedupe?: boolean
    stockSources?: string[]
    imageModelId?: string
    imageLora?: LoraSelection | null
    noVoiceDurationSec: number
    voiceVolume: number
    voiceRate: number
    bgmVolume: number
    bgmFile: string
    subtitleEnabled: boolean
    subtitlePosition: string
    customPosition: number
    fontName: string
    fontSize: number
    textForeColor: string
    textBackgroundEnabled: boolean
    textBackgroundColor: string
    strokeColor: string
    strokeWidth: number
  }
  material: {
    maxVideoBytes: number
    maxImageBytes: number
    accept: string
  }
  bgm: {
    maxBytes: number
    accept: string
  }
}

export interface ShortVideoMaterial {
  file: string
  name: string
  size: number
}

export interface ShortVideoStockPick {
  id: string
  source: string
  url: string
  /** 本服务代拉后的预览地址，页面用这个才能稳定打开 */
  previewUrl?: string
  shareRef?: string
  poster?: string
  posterUrl?: string
  title?: string
  durationSec: number
  width: number
  height: number
  mediaType?: 'video' | 'image'
}

export interface ShortVideoTask {
  id: string
  subject: string
  script: string
  generatedScript?: string | null
  terms: string
  scriptPrompt: string
  paragraphNumber: number
  aspect: string
  voiceName: string
  voiceVolume: number
  voiceRate: number
  bgmType: string
  bgmVolume: number
  bgmFile: string
  videoSource: string
  stockSources?: string[]
  semanticMatch?: boolean
  stockDedupe?: boolean
  imageModelId?: string
  imageLora?: LoraSelection | null
  fitMode: string
  concatMode: string
  transitionMode: string
  clipDuration: number
  clipSpeed: number
  videoCount: number
  matchMaterials: boolean
  noVoiceDurationSec: number
  subtitleEnabled: boolean
  subtitlePosition: string
  customPosition: number
  fontName: string
  fontSize: number
  textForeColor: string
  textBackgroundEnabled: boolean
  textBackgroundColor: string
  strokeColor: string
  strokeWidth: number
  materials?: ShortVideoMaterial[] | null
  status: ShortVideoStatus
  progress: number
  stage: string
  videoUrl?: string | null
  videoUrls?: string[]
  error?: string | null
  billing?: { mode: ShortVideoPriceMode; chargeCents: number | null } | null
  createdAt: string
  updatedAt: string
}

export interface ShortVideoTaskPage {
  list: ShortVideoTask[]
  total: number
  page: number
  pageSize: number
  active: ShortVideoTask | null
}

export interface CreateShortVideoPayload extends ShortVideoPricedRequest {
  requestId?: string
  subject: string
  script?: string
  terms?: string
  scriptPrompt?: string
  paragraphNumber?: number
  aspect?: string
  voiceName?: string
  voiceVolume?: number
  voiceRate?: number
  bgmType?: string
  bgmVolume?: number
  bgmFile?: string
  videoSource?: string
  stockSources?: string[]
  semanticMatch?: boolean
  stockDedupe?: boolean
  imageModelId?: string
  imageLora?: LoraSelection | null
  fitMode?: string
  concatMode?: string
  transitionMode?: string
  clipDuration?: number
  clipSpeed?: number
  videoCount?: number
  matchMaterials?: boolean
  noVoiceDurationSec?: number
  subtitleEnabled?: boolean
  subtitlePosition?: string
  customPosition?: number
  fontName?: string
  fontSize?: number
  textForeColor?: string
  textBackgroundEnabled?: boolean
  textBackgroundColor?: string
  strokeColor?: string
  strokeWidth?: number
  materials?: ShortVideoMaterial[]
  /** 一次排队生成的条数，默认 1。大于 1 时服务端做完一条再开下一条 */
  count?: number
  stockPicks?: ShortVideoStockPick[]
}

export const getShortVideoOptions = () => get<ShortVideoOptions>('/short-video/options')

export const listShortVideoTasks = (page = 1, pageSize = 12) =>
  get<ShortVideoTaskPage>('/short-video/tasks', { page, pageSize })

export const getShortVideoTask = (id: string) => get<ShortVideoTask>(`/short-video/tasks/${id}`)

export const createShortVideoTask = (data: CreateShortVideoPayload) =>
  post<ShortVideoTask>('/short-video/tasks', data)

export const deleteShortVideoTask = (id: string) => del<null>(`/short-video/tasks/${id}`)

export const cancelShortVideoTask = (id: string) => post<ShortVideoTask>(`/short-video/tasks/${id}/cancel`, {})

export const getShortVideoDownloadUrl = (id: string, index = 0) =>
  get<{ url: string; fileName: string }>(`/short-video/tasks/${id}/download-url`, { index })

export const uploadShortVideoMaterial = (file: File) => {
  const formData = new FormData()
  formData.append('file', file)
  return request.post('/short-video/materials', formData) as Promise<ShortVideoMaterial>
}

export const uploadShortVideoBgm = (file: File) => {
  const formData = new FormData()
  formData.append('file', file)
  return request.post('/short-video/bgm', formData) as Promise<ShortVideoMaterial>
}

export interface VoicePreviewPayload extends ShortVideoPricedRequest {
  voiceName: string
  voiceRate?: number
  voiceVolume?: number
  text?: string
}

export interface VoicePreviewResult {
  mimeType: string
  audio: string
  text: string
}

export const previewShortVideoVoice = (data: VoicePreviewPayload) =>
  request.post('/short-video/voice-preview', data) as Promise<VoicePreviewResult>

export interface GenerateScriptPayload extends ShortVideoPricedRequest {
  subject: string
  voiceName?: string
  paragraphNumber?: number
  scriptPrompt?: string
}

export const generateShortVideoScript = (data: GenerateScriptPayload) =>
  post<{ script: string }>('/short-video/script', data)

export interface PreviewStockPayload extends ShortVideoPricedRequest {
  subject: string
  script?: string
  terms?: string
  scriptPrompt?: string
  paragraphNumber?: number
  voiceName?: string
  aspect?: string
  stockSources?: string[]
  semanticMatch?: boolean
  stockDedupe?: boolean
  excludeIds?: string[]
}

export const previewShortVideoStock = (data: PreviewStockPayload) =>
  post<{ script: string; items: ShortVideoStockPick[] }>('/short-video/stock-preview', data)

export const SHORT_VIDEO_STATUS_LABEL: Record<ShortVideoStatus, string> = {
  queued: '排队中',
  generating: '生成中',
  success: '已完成',
  failed: '失败',
}

export function isShortVideoBusy(status?: ShortVideoStatus) {
  return status === 'queued' || status === 'generating'
}
