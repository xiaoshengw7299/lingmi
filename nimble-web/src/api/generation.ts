import request, { get, post } from '@/utils/request'
import type { LoraSelection, MediaModelOption } from './video'

export type GenerationKind = 'image' | 'video' | 'audio' | 'text'

export interface GenerateParams {
  kind: GenerationKind
  prompt: string
  modelId?: string
  ratio?: string
  resolution?: string
  outputFormat?: string
  promptOptimizeMode?: string
  lora?: LoraSelection | null
  durationSec?: number
  generateAudio?: boolean
  refImages?: string[]
  refVideos?: string[]
  refAudios?: string[]
  voice?: string
}

export interface GenerationTask {
  id: string
  kind: GenerationKind
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  url: string | null
  /** 图片 / 视频首帧缩略图 */
  thumbUrl: string | null
  text: string | null
  modelName: string | null
  error: string | null
}

export interface GenerationModels {
  image: MediaModelOption[]
  video: MediaModelOption[]
  audio: MediaModelOption[]
  text: Array<{ id: string; name: string }>
}

const POLL_INTERVAL_MS = 3000

/** 等待下一轮。页面从后台切回来时立刻继续，避免定时器被浏览器降频后要等很久才看到完成 */
function waitForPoll(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const timer = window.setTimeout(finish, POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') finish()
    }
    function finish() {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      if (signal?.aborted) reject(new DOMException('已取消', 'AbortError'))
      else resolve()
    }
    document.addEventListener('visibilitychange', onVisible)
    signal?.addEventListener('abort', finish, { once: true })
  })
}

export const getGenerationModels = () => get<GenerationModels>('/generate/models')

export const createGeneration = (params: GenerateParams) => post<GenerationTask>('/generate', params)

export const getGeneration = (id: string) => get<GenerationTask>(`/generate/${id}`)

/** 轮询任务直到结束；失败抛错，signal 中止后抛 AbortError，调用方据此清理状态。
 * 「生成超时」先再观察一段时间：Atlas 经常在本地放弃之后才成功，观察期内写回成功就直接用。
 */
const TIMEOUT_WATCH_MS = 10 * 60 * 1000

export async function pollGeneration(taskId: string, signal?: AbortSignal): Promise<GenerationTask> {
  let task = await getGeneration(taskId)
  let timeoutSeenAt = 0
  while (task.status === 'queued' || task.status === 'running' || isSoftTimeout(task)) {
    if (isSoftTimeout(task)) {
      if (!timeoutSeenAt) timeoutSeenAt = Date.now()
      if (Date.now() - timeoutSeenAt >= TIMEOUT_WATCH_MS) break
    } else {
      timeoutSeenAt = 0
    }
    await waitForPoll(signal)
    task = await getGeneration(taskId)
  }
  if (task.status === 'failed') throw new Error(task.error || '生成失败')
  return task
}

function isSoftTimeout(task: GenerationTask): boolean {
  return task.status === 'failed' && (task.error ?? '').includes('生成超时')
}

/** 创建任务并等待结果；onCreated 在任务入队后立即回调，便于调用方记下 taskId（刷新后可继续轮询） */
export async function runGeneration(
  params: GenerateParams,
  opts: { signal?: AbortSignal; onCreated?: (task: GenerationTask) => void } = {},
): Promise<GenerationTask> {
  const created = await createGeneration(params)
  opts.onCreated?.(created)
  return pollGeneration(created.id, opts.signal)
}

/** 画布本地上传：返回可用于参考生成的公网地址 */
export const uploadMedia = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return request.post('/generate/upload', form) as Promise<{ kind: 'image' | 'video' | 'audio'; url: string; key: string; thumbUrl: string | null }>
}

/** 图片小工具（服务端 FFmpeg 处理，不扣费）：裁剪 / 拆分 / 放大 / 叠加局部重绘标注 */
export interface ProcessedImage {
  url: string
  key: string
  thumbUrl: string | null
}

export type ImageToolParams =
  | { op: 'crop'; url: string; rect: { x: number; y: number; w: number; h: number } }
  | { op: 'split'; url: string; rows: number; cols: number }
  | { op: 'upscale'; url: string; factor: 2 | 4 }
  | { op: 'mark'; url: string; mask: string }

export const runImageTool = (params: ImageToolParams) => post<ProcessedImage[]>('/generate/image-tools', params)
