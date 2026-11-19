import axios from 'axios'
import request, { del, get, post } from '@/utils/request'
import type { GenerationTask } from './generation'

export type InputKind = 'video' | 'audio' | 'image' | 'subtitle'
export type OutputKind = 'video' | 'image' | 'audio' | 'file'

export interface ToolInput {
  key: string
  label: string
  kinds: InputKind[]
  max?: number
  optional?: boolean
  hint?: string
  maxDurationSec?: number
  accept?: string
}

export interface ToolChoice {
  value: string | number
  label: string
}

export interface ToolOption {
  key: string
  label: string
  type: 'select' | 'switch' | 'number' | 'slider' | 'text' | 'textarea' | 'boxes' | 'mask' | 'tags' | 'pairs' | 'record'
  choices?: ToolChoice[]
  default?: unknown
  min?: number
  max?: number
  step?: number
  unit?: string
  maxLength?: number
  maxItems?: number
  placeholder?: string
  help?: string
  required?: boolean
  advanced?: boolean
  when?: Record<string, unknown[]>
  recordTool?: string
  presets?: string[]
}

export interface ToolMode {
  id: string
  label: string
  desc?: string
  sync: boolean
  inputs: ToolInput[]
  options: ToolOption[]
  /** 用户单价，元 / unit */
  price: { unit: string; basis: string; price: number }
}

export interface ShowcaseItem {
  kind: 'video' | 'image' | 'audio' | 'subtitles' | 'text'
  label: string
  url?: string
  text?: string
  /** 无声短动图，自动循环 */
  loop?: boolean
}

export interface Showcase {
  title: string
  desc?: string
  items: ShowcaseItem[]
}

export interface ToolDef {
  id: string
  group: 'video' | 'general'
  name: string
  icon: string
  summary: string
  intro: string
  highlights: string[]
  scenarios: Array<{ title: string; desc: string }>
  tips: string[]
  /** 官方效果示例，素材已转存到我们的对象存储 */
  showcase: Showcase[]
  modes: ToolMode[]
}

/** 已传到 MediaKit 的输入文件。previewUrl 是本地预览地址，不提交 */
export interface InputFile {
  fileId: string
  name: string
  kind: InputKind
  durationSec?: number
  width?: number
  height?: number
  previewUrl?: string
}

export interface ToolTask {
  id: string
  tool: string
  mode: string
  status: 'running' | 'succeeded' | 'failed'
  error: string | null
  chargeCents: number
  createdAt: string
  inputs: Array<{ name: string; kind: InputKind; durationSec?: number }>
  values: Record<string, unknown>
  outputs: Array<{ kind: OutputKind; label: string; url: string }>
  thumbUrl: string | null
  data: Record<string, any> | null
  /** 爆款复刻：用动作视频生成的视频 */
  generations?: GenerationTask[]
}

export interface RunToolParams {
  tool: string
  mode: string
  inputs: Record<string, InputFile[]>
  values: Record<string, unknown>
}

let catalog: Promise<ToolDef[]> | undefined

/** 工具目录基本不变，整个会话只取一次 */
export function getToolCatalog(): Promise<ToolDef[]> {
  catalog ??= get<ToolDef[]>('/media-tools/catalog').catch((error) => {
    catalog = undefined
    throw error
  })
  return catalog
}

const payload = (params: RunToolParams) => ({
  ...params,
  inputs: Object.fromEntries(Object.entries(params.inputs).map(([key, files]) => [key, files.map(({ previewUrl: _p, ...file }) => file)])),
})

export const quoteTool = (params: RunToolParams) => post<{ cents: number | null }>('/media-tools/quote', payload(params))

export const createToolTask = (params: RunToolParams) => post<ToolTask>('/media-tools/tasks', payload(params))

export const listToolTasks = (tool: string, page = 1, opts: { succeeded?: boolean; pageSize?: number } = {}) =>
  get<{ items: ToolTask[]; total: number }>('/media-tools/tasks', { tool, page, pageSize: opts.pageSize ?? 20, ...(opts.succeeded ? { succeeded: true } : {}) })

export const getToolTask = (id: string) => get<ToolTask>(`/media-tools/tasks/${id}`)

export const deleteToolTask = (id: string) => del(`/media-tools/tasks/${id}`)

export interface CloneGenerateParams {
  prompt: string
  modelId?: string
  ratio?: string
  resolution?: string
  durationSec?: number
  generateAudio?: boolean
  refImages?: string[]
}

export const cloneGenerate = (id: string, params: CloneGenerateParams) => post<GenerationTask>(`/media-tools/tasks/${id}/generate`, params)

export function uploadCloneRef(id: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return request.post(`/media-tools/tasks/${id}/refs`, form) as Promise<{ key: string; url: string }>
}

// ───────────────────────── 本地文件直传 ─────────────────────────

const SUBTITLE_EXT = /\.(srt|ass)$/i
const MEDIA_MIME: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
}

/** 手机文件选择器有时只返回扩展名，预览和上传使用同一个补全后的类型。 */
export function withMediaType(file: File) {
  if (file.type && file.type !== 'application/octet-stream') return file
  const ext = /\.([a-z0-9]{2,4})$/i.exec(file.name)?.[1]?.toLowerCase()
  const type = ext ? MEDIA_MIME[ext] : undefined
  return type ? new File([file], file.name, { type, lastModified: file.lastModified }) : file
}

export function kindOf(file: File): InputKind | null {
  if (SUBTITLE_EXT.test(file.name)) return 'subtitle'
  const major = file.type.split('/')[0]
  return major === 'video' || major === 'audio' || major === 'image' ? major : null
}

/** 浏览器直接 PUT 到 MediaKit，不经过我们的服务器；返回提交任务用的 mediakit:// 文件 ID */
export async function uploadToMediaKit(file: Blob, onProgress?: (percent: number) => void): Promise<string> {
  const { fileId, uploadUrl, headers } = await post<{ fileId: string; uploadUrl: string; headers: Record<string, string> }>('/media-tools/upload-url')
  const contentType = file.type || (file instanceof File && SUBTITLE_EXT.test(file.name) ? 'text/plain' : 'application/octet-stream')
  await axios.put(uploadUrl, file, {
    headers: { ...headers, 'Content-Type': contentType },
    onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
  })
  return fileId
}

/** 读出音视频时长、画面尺寸，用来算价和提前拦住超限文件。读不出来就留空，由服务端按实际用量结算 */
export function probeMedia(url: string, kind: InputKind): Promise<{ durationSec?: number; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve({}), 8000)
    const done = (meta: { durationSec?: number; width?: number; height?: number }) => {
      window.clearTimeout(timer)
      resolve(meta)
    }
    if (kind === 'image') {
      const img = new Image()
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => done({})
      img.src = url
      return
    }
    if (kind !== 'video' && kind !== 'audio') return done({})
    const el = document.createElement(kind)
    el.preload = 'metadata'
    el.onloadedmetadata = () =>
      done({
        durationSec: Number.isFinite(el.duration) ? Math.round(el.duration * 100) / 100 : undefined,
        ...(el instanceof HTMLVideoElement && el.videoWidth ? { width: el.videoWidth, height: el.videoHeight } : {}),
      })
    el.onerror = () => done({})
    el.src = url
  })
}

/** 秒 → 1:05 / 1:02:03 */
export function clock(seconds?: number): string {
  if (!seconds && seconds !== 0) return ''
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`
}
