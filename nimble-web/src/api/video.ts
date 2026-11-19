import request, { get, post, patch, del } from '@/utils/request'

// ─── 业务类型（与 nimble-ai VideoProjectEntity / ShotEntity 对齐） ──────

export type MediaStatus = 'idle' | 'queued' | 'generating' | 'success' | 'failed'
export type ProjectStatus = 'draft' | 'composing' | 'done' | 'failed'
export type GenerationMode = 'continuous' | 'parallel'
export type QcResult = 'passed' | 'warning' | 'failed'
/** 素材类型：图片、文本可生成；视频与音频只能上传 */
export type AssetKind = 'image' | 'video' | 'audio' | 'text'

export interface VideoQcReport {
  result: QcResult
  summary?: string
  issues?: string[]
  durationSec?: number
  width?: number
  height?: number
}

// ─── 图片/视频模型 + LoRA（GET /video/models） ───────────────

export type MediaModelKind = 'image' | 'video'
/** Atlas 模型命名空间，由目录 id 首段派生，如 bytedance / kwaivgi / minimax */
export type MediaModelProvider = string

/** 挂载的 LoRA 选择：name 对应 MediaModelOption.loras[].name */
export interface LoraSelection {
  name: string
  weight: number
}

/** 模型下可挂载的 LoRA 选项（来自 atlas-models.json 的 loras 预设） */
export interface LoraOption {
  name: string
  description?: string
  defaultWeight: number
}

/** 图片/视频可选模型（配置见 nimble-ai/config/atlas-models.json） */
export interface MediaModelOption {
  id: string
  kind: MediaModelKind
  provider: MediaModelProvider
  model: string
  name: string
  description?: string
  supportsLora: boolean
  loras: LoraOption[]
  isDefault: boolean
  minDuration: number
  maxDuration: number
  /** 是否支持生成同步配音（视频模型） */
  supportsGenerateAudio?: boolean
  maxReferenceImages: number
  maxReferenceVideos: number
  /** 最多参考音频数量；0 表示该模型不支持参考音频 */
  maxReferenceAudios: number
  /** 图片+视频+音频混合输入的文件总数上限；为空表示不额外限制 */
  maxReferenceFiles?: number
  /** 同类参考视频或参考音频的合计时长上限（秒） */
  maxReferenceDurationSec?: number
  ratios: string[]
  defaultRatio: string
  /** 该模型支持的清晰度档位；空数组表示前端不展示、调用时走上游默认 */
  resolutions: string[]
  defaultResolution?: string
  outputFormats: string[]
  defaultOutputFormat?: string
  promptOptimizeModes: string[]
  defaultPromptOptimizeMode?: string
}

const RATIO_LABEL: Record<string, string> = {
  '16:9': '16:9 横屏',
  '9:16': '9:16 竖屏',
  '1:1': '1:1 方形',
  '4:3': '4:3',
  '3:4': '3:4',
  '3:2': '3:2',
  '2:3': '2:3',
  '4:5': '4:5',
  '5:4': '5:4',
  '21:9': '21:9 超宽',
  adaptive: '自适应',
}

const RESOLUTION_HINT: Record<string, string> = {
  '1K': '更快更省',
  '1k': '更快更省',
  '1.5K': '与 1K 同价，画质更好',
  '2K': '超清',
  '2k': '超清',
  '4K': '更高清，更慢更贵',
  '4k': '更高清，更慢更贵',
  '768P': '高清',
  '480p': '更省',
  '720p': '高清',
  '1080p': '更高清',
  low: '更快更省',
  medium: '均衡',
  high: '更清晰，更慢',
}

const RESOLUTION_LABEL: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
}

const OUTPUT_FORMAT_LABEL: Record<string, string> = {
  jpeg: 'JPEG',
  png: 'PNG',
}

const PROMPT_OPTIMIZE_LABEL: Record<string, string> = {
  standard: '标准',
  fast: '快速',
  default: '默认',
  high: '高质量',
  minimal: '最快',
}

export function mediaRatioLabel(ratio: string) {
  return RATIO_LABEL[ratio] ?? ratio
}

export function mediaResolutionLabel(value: string) {
  return RESOLUTION_LABEL[value] ?? value
}

export function mediaResolutionHint(value: string, isDefault = false) {
  const hint = RESOLUTION_HINT[value]
  if (isDefault) return hint ? `官方默认 · ${hint}` : '官方默认'
  return hint
}

export function mediaOutputFormatLabel(value: string) {
  return OUTPUT_FORMAT_LABEL[value] ?? value.toUpperCase()
}

export function mediaPromptOptimizeLabel(value: string) {
  return PROMPT_OPTIMIZE_LABEL[value] ?? value
}

export function cssAspectRatio(ratio?: string | null) {
  if (!ratio || ratio === 'adaptive') return '9 / 16'
  const [w, h] = ratio.split(':')
  if (!w || !h) return '9 / 16'
  return `${w} / ${h}`
}

export function resolveMediaModel(models: MediaModelOption[], modelId?: string | null) {
  return (modelId && models.find((item) => item.id === modelId)) || models.find((model) => model.isDefault) || models[0]
}

export function mediaDurationRange(models: MediaModelOption[], modelId?: string | null) {
  const model = resolveMediaModel(models, modelId)
  return { min: model?.minDuration ?? 4, max: model?.maxDuration ?? 15 }
}

export function clampMediaDuration(value: number, models: MediaModelOption[], modelId?: string | null) {
  const { min, max } = mediaDurationRange(models, modelId)
  return Math.min(max, Math.max(min, Math.round(value || min)))
}

export function mediaRatioOptions(models: MediaModelOption[], modelId?: string | null) {
  const model = resolveMediaModel(models, modelId)
  return model?.ratios?.length ? model.ratios : ['9:16']
}

export function clampMediaRatio(value: string | null | undefined, models: MediaModelOption[], modelId?: string | null) {
  const model = resolveMediaModel(models, modelId)
  const ratios = mediaRatioOptions(models, modelId)
  const fallback = model?.defaultRatio && ratios.includes(model.defaultRatio) ? model.defaultRatio : (ratios.includes('9:16') ? '9:16' : ratios[0])
  return value && ratios.includes(value) ? value : fallback
}

export function mediaResolutionOptions(models: MediaModelOption[], modelId?: string | null) {
  return resolveMediaModel(models, modelId)?.resolutions ?? []
}

export function clampMediaResolution(value: string | null | undefined, models: MediaModelOption[], modelId?: string | null) {
  const model = resolveMediaModel(models, modelId)
  const options = mediaResolutionOptions(models, modelId)
  if (!options.length) return undefined
  const fallback = model?.defaultResolution && options.includes(model.defaultResolution) ? model.defaultResolution : options[0]
  return value && options.includes(value) ? value : fallback
}

export function mediaOutputFormatOptions(models: MediaModelOption[], modelId?: string | null) {
  return resolveMediaModel(models, modelId)?.outputFormats ?? []
}

export function clampMediaOutputFormat(value: string | null | undefined, models: MediaModelOption[], modelId?: string | null) {
  const model = resolveMediaModel(models, modelId)
  const options = mediaOutputFormatOptions(models, modelId)
  if (!options.length) return undefined
  const fallback = model?.defaultOutputFormat && options.includes(model.defaultOutputFormat) ? model.defaultOutputFormat : options[0]
  return value && options.includes(value) ? value : fallback
}

export function mediaPromptOptimizeOptions(models: MediaModelOption[], modelId?: string | null) {
  return resolveMediaModel(models, modelId)?.promptOptimizeModes ?? []
}

export function clampMediaPromptOptimize(value: string | null | undefined, models: MediaModelOption[], modelId?: string | null) {
  const model = resolveMediaModel(models, modelId)
  const options = mediaPromptOptimizeOptions(models, modelId)
  if (!options.length) return undefined
  const fallback = model?.defaultPromptOptimizeMode && options.includes(model.defaultPromptOptimizeMode)
    ? model.defaultPromptOptimizeMode
    : options[0]
  return value && options.includes(value) ? value : fallback
}

export interface MediaModelsResponse {
  image: MediaModelOption[]
  video: MediaModelOption[]
}

export interface VideoTake {
  id: string
  version: number
  status: MediaStatus
  videoUrl?: string | null
  error?: string | null
  promptSnapshot: string
  effectivePrompt?: string | null
  generationMode: GenerationMode
  durationSec: number
  ratio?: string | null
  resolution?: string | null
  /** 生成该版本实际使用的模型 id 快照 */
  modelId?: string | null
  lora?: LoraSelection | null
  referenceImages: string[]
  referenceVideos: string[]
  referenceAudios: string[]
  qcReport?: VideoQcReport | null
  /** 该版本生成进度（0–1）；仅 Provider 真正上报时才有值 */
  progress?: number | null
  createdAt: string
}

/** 素材库条目：图片/视频/音频共用结构，分镜提示词统一用 @名称 引用 */
export interface MediaAsset {
  id: string
  name: string
  kind: AssetKind
  source: 'generated' | 'uploaded'
  /** 图片素材的生成提示词；文本素材是让 AI 写正文的要求；视频/音频仅作备注 */
  prompt: string
  /** 文本素材正文 */
  text?: string
  url?: string
  status: MediaStatus
  error?: string
  /** 每次重新生成 +1，用来区分「同一轮任务」和「重新排队」 */
  epoch?: number
  /** 视频/音频素材时长（秒），上传时由后端探测 */
  durationSec?: number
  /** 图片生成模型 id；为空时使用当前默认图片模型 */
  modelId?: string
  lora?: LoraSelection | null
  ratio?: string
  resolution?: string
  outputFormat?: string
  promptOptimizeMode?: string
}

/** 素材类型的展示文案与上传限制，与后端 ASSET_UPLOAD_LIMITS 对齐 */
export const ASSET_KIND_META: Record<AssetKind, { label: string; accept: string; maxMB: number }> = {
  image: { label: '图片', accept: 'image/png,image/jpeg,image/webp,image/heic,image/heif', maxMB: 30 },
  video: { label: '视频', accept: 'video/mp4', maxMB: 50 },
  audio: { label: '音频', accept: 'audio/wav,audio/mpeg,audio/mp3', maxMB: 15 },
  text: { label: '文本', accept: '', maxMB: 0 },
}

/** 上传素材可接受的全部格式。文本没有文件，不放进文件选择框 */
export const ASSET_UPLOAD_ACCEPT = (['image', 'video', 'audio'] as const)
  .map((kind) => ASSET_KIND_META[kind].accept)
  .join(',')

/** 参考视频/音频的单段时长范围（秒），与后端校验一致（Seedance 2.5 官方 [2,30]s） */
export const REFERENCE_CLIP_MIN_SEC = 2
export const REFERENCE_CLIP_MAX_SEC = 30
/** 未声明模型上限时的同类参考素材总时长兜底（秒） */
export const REFERENCE_TOTAL_SEC = 15

export interface Shot {
  id: string
  projectId: string
  index: number
  name: string
  videoPrompt: string
  durationSec: number
  /** 画面比例，如 16:9；为空时使用所选模型默认比例 */
  ratio?: string | null
  /** 清晰度档位，如 2K；为空时使用所选模型官方默认 */
  resolution?: string | null
  activeTakeId?: string | null
  takes: VideoTake[]
  videoUrl: string | null
  videoStatus: MediaStatus
  videoTaskId?: string | null
  videoError: string | null
  /** 上游返回的生成进度（0–1）；仅 Provider 真正上报时才有值 */
  videoProgress?: number | null
  /** 视频生成模型 id；为空时使用当前默认视频模型 */
  modelId?: string | null
  lora?: LoraSelection | null
}

/** 一次成片合成的历史记录（保留全部历史，"生成结果"页按时间倒序展示） */
export interface VideoComposeHistoryItem {
  id: string
  videoUrl: string | null
  coverUrl: string | null
  status: MediaStatus
  durationSec: number | null
  shotCount: number
  createdAt: string
}

export interface VideoProject {
  id: string
  sessionId: string
  userId: string
  title: string
  requirement: string
  status: ProjectStatus
  generationMode: GenerationMode
  assets: MediaAsset[]
  finalVideoUrl: string | null
  finalVideoCoverUrl: string | null
  finalVideoStatus: MediaStatus
  finalVideoError: string | null
  composeToken?: string | null
  shots: Shot[]
  composeHistory: VideoComposeHistoryItem[]
  /** 该项目已生成的示例 id（存在则"生成示例"按钮切换为"重新生成示例"） */
  exampleId?: string | null
  createdAt: string
  updatedAt: string
}

/** 案例库条目 */
export interface VideoExampleAsset {
  name: string
  kind: AssetKind
  prompt: string
  source: 'generated' | 'uploaded'
}

export interface VideoExampleShot {
  name: string
  videoPrompt: string
  durationSec: number
  ratio?: string
  index: number
}

/** 案例保存的当前工作台内容（不含合成历史和分镜旧版本） */
export interface VideoExampleSnapshot {
  generationMode: GenerationMode
  status: ProjectStatus
  assets: MediaAsset[]
  shots: Shot[]
  finalVideoUrl: string | null
  finalVideoCoverUrl: string | null
  finalVideoStatus: MediaStatus
}

export interface VideoExample {
  id: string
  title: string
  coverUrl: string | null
  requirement: string
  assets: VideoExampleAsset[]
  shots: VideoExampleShot[]
  snapshot?: VideoExampleSnapshot | null
  sourceProjectId: string | null
  createdBy: string
  createdByName: string | null
  /** 被复制成自己工作台的次数 */
  copyCount: number
  viewCount: number
  /** 综合热度（仅列表接口返回），与画布作品混排用 */
  hot?: number
  createdAt: string
  updatedAt: string
}

/** 把案例详情转成工作台可渲染的项目，供预览弹框只读展示 */
export function exampleToPreviewProject(example: VideoExample): VideoProject {
  const snapshot = example.snapshot
  return {
    id: example.id,
    sessionId: '',
    userId: example.createdBy,
    title: example.title,
    requirement: example.requirement,
    status: snapshot?.status ?? 'done',
    generationMode: snapshot?.generationMode ?? 'continuous',
    assets: snapshot?.assets ?? [],
    finalVideoUrl: snapshot?.finalVideoUrl ?? null,
    finalVideoCoverUrl: snapshot?.finalVideoCoverUrl ?? example.coverUrl,
    finalVideoStatus: snapshot?.finalVideoStatus ?? 'success',
    finalVideoError: null,
    shots: (snapshot?.shots ?? []).map((shot) => ({
      ...shot,
      projectId: example.id,
      takes: [],
      videoError: shot.videoError ?? null,
    })),
    composeHistory: [],
    exampleId: example.id,
    createdAt: example.createdAt,
    updatedAt: example.updatedAt,
  }
}

export interface UpdateShotPayload {
  name?: string
  videoPrompt?: string
  durationSec?: number
  ratio?: string
  resolution?: string
  modelId?: string
  lora?: LoraSelection | null
}

export interface AddShotPayload {
  name?: string
  videoPrompt: string
  durationSec: number
  ratio?: string
  resolution?: string
  index?: number
  modelId?: string
  lora?: LoraSelection | null
}

// ─── API 调用 ─────────────────────────────────────────────────

/** 图片/视频当前各自可选的模型列表（含默认模型标记、LoRA 能力），工作台加载项目时一次性拉取 */
export const getMediaModels = () => get<MediaModelsResponse>('/video/models')

export const getVideoProjects = (params?: { sessionId?: string }) =>
  get<VideoProject[]>('/video/projects', params)

export const getVideoProject = (id: string) =>
  get<VideoProject>(`/video/projects/${id}`)

/** 创建空白项目：跳过对话生成分镜的过程，直接进入工作台从零创作 */
export const createBlankProject = (payload: { sessionId: string; title?: string }) =>
  post<VideoProject>('/video/projects', payload)

export const updateShot = (projectId: string, shotId: string, payload: UpdateShotPayload) =>
  patch<Shot>(`/video/projects/${projectId}/shots/${shotId}`, payload)

export const addShot = (projectId: string, payload: AddShotPayload) =>
  post<VideoProject>(`/video/projects/${projectId}/shots`, payload)

export const deleteShot = (projectId: string, shotId: string) =>
  del<VideoProject>(`/video/projects/${projectId}/shots/${shotId}`)

export const reorderShots = (projectId: string, shotIds: string[]) =>
  patch<VideoProject>(`/video/projects/${projectId}/shots/reorder`, { shotIds })

export const reorderAssets = (projectId: string, assetIds: string[]) =>
  patch<VideoProject>(`/video/projects/${projectId}/assets/reorder`, { assetIds })

export const selectShotTake = (projectId: string, shotId: string, takeId: string) =>
  post<Shot>(`/video/projects/${projectId}/shots/${shotId}/takes/${takeId}/select`)

export const updateVideoProjectSettings = (projectId: string, generationMode: GenerationMode) =>
  patch<VideoProject>(`/video/projects/${projectId}/settings`, { generationMode })

export const updateVideoProjectTitle = (projectId: string, title: string) =>
  patch<VideoProject>(`/video/projects/${projectId}/title`, { title })

/** 项目级素材上传（图片/视频/音频）：供分镜提示词统一通过 @名称 引用 */
export const uploadLocalRef = (projectId: string, file: File) => {
  const formData = new FormData()
  formData.append('file', file)
  return request.post(`/video/projects/${projectId}/local-uploads`, formData) as Promise<VideoProject>
}

/** 从「我的资产」引用媒体到素材库，后端复用本地上传的格式/时长校验 */
export const importAsset = (projectId: string, payload: { url: string; name?: string }) =>
  post<VideoProject>(`/video/projects/${projectId}/asset-imports`, payload)

// ─── 素材库 ──────────────────────────────────────────────────

export interface AssetPayload {
  kind?: 'image' | 'text'
  name?: string
  prompt?: string
  text?: string
  modelId?: string
  lora?: LoraSelection | null
  ratio?: string
  resolution?: string
  outputFormat?: string
  promptOptimizeMode?: string
}

export const addAsset = (projectId: string, payload: AssetPayload) =>
  post<VideoProject>(`/video/projects/${projectId}/assets`, payload)

export const updateAsset = (projectId: string, refId: string, payload: Partial<AssetPayload>) =>
  patch<VideoProject>(`/video/projects/${projectId}/assets/${refId}`, payload)

export const deleteAsset = (projectId: string, refId: string) =>
  del<VideoProject>(`/video/projects/${projectId}/assets/${refId}`)

export const generateAssetImage = (projectId: string, refId: string) =>
  post<VideoProject>(`/video/projects/${projectId}/assets/${refId}/image`)

export const generateAssetText = (projectId: string, refId: string) =>
  post<VideoProject>(`/video/projects/${projectId}/assets/${refId}/text`)

export const generateAllAssetImages = (projectId: string, assetIds: string[]) =>
  post<VideoProject>(`/video/projects/${projectId}/assets/images/batch`, { assetIds })

export const cancelQueuedAssetImages = (projectId: string) =>
  post<VideoProject>(`/video/projects/${projectId}/assets/images/cancel`)

/** 替换"本地上传"素材的文件（须与原素材同类型，保持名称/提示词/@ 引用不变；AI 生成素材请用"重新生成"） */
export const replaceAssetFile = (projectId: string, refId: string, file: File) => {
  const formData = new FormData()
  formData.append('file', file)
  return request.post(`/video/projects/${projectId}/assets/${refId}/replace-file`, formData) as Promise<VideoProject>
}

// ─── 分镜视频生成 + 合成（立即返回 generating，最终结果通过 Socket.IO 推送） ──

export const generateShotVideo = (projectId: string, shotId: string) =>
  post<Shot>(`/video/projects/${projectId}/shots/${shotId}/video`)

export const generateAllShotVideos = (projectId: string, shotIds: string[], mode?: GenerationMode) =>
  post<Shot[]>(`/video/projects/${projectId}/videos/batch`, { shotIds, mode })

export const cancelQueuedShotVideos = (projectId: string) =>
  post<VideoProject>(`/video/projects/${projectId}/videos/cancel`)

export const composeProject = (projectId: string) =>
  post<VideoProject>(`/video/projects/${projectId}/compose`)

// ─── 生成经验 / 生成示例（案例库） ─────────────────────────────

/** 汇总项目全流程生成一份 Markdown 制作经验，不落库，前端直接触发下载 */
export const generateExperience = (projectId: string) =>
  request.post(`/video/projects/${projectId}/experience`) as Promise<{ markdown: string }>

/** 基于当前已合成项目沉淀为示例（复制完整工作台，含媒体文件），耗时随成片体积变长 */
export const createExample = (projectId: string, payload?: { title?: string }) =>
  request.post(`/video/projects/${projectId}/examples`, payload ?? {}) as Promise<VideoExample>

export interface ShareRewardTier {
  copies: number
  rewardCents: number
  paid: boolean
}

/** 单个作品被他人复制的进度。作者自己复制不计 */
export interface ShareRewardStatus {
  qualifiedCopies: number
  earnedCents: number
  tiers: ShareRewardTier[]
  /** 下一档；全部领完是 null */
  next: { copies: number; rewardCents: number } | null
}

export const getShareReward = (exampleId: string) => get<ShareRewardStatus>(`/video/examples/${exampleId}/share-reward`)

export const listExamples = (params?: { page?: number; pageSize?: number; sort?: 'hot' | 'new' }) =>
  get<{ items: VideoExample[]; total: number; page: number; pageSize: number }>('/video/examples', params)

export const getExample = (id: string) => get<VideoExample>(`/video/examples/${id}`)

/** 打开案例预览时调用，后端按"访客 + 天"去重；返回本次是否真的计数了 */
export const viewExample = (id: string) => post<boolean>(`/video/examples/${id}/view`).catch(() => false)

/** 复制案例为一条全新工作台（有完整快照则连成片/素材一起拷） */
export const useExample = (exampleId: string, payload: { sessionId: string }) =>
  request.post(`/video/examples/${exampleId}/use`, payload) as Promise<VideoProject>

export const deleteExample = (id: string) =>
  request.delete(`/video/examples/${id}`) as Promise<void>

/** 项目中是否还有正在生成的参考图/视频/合成任务 */
export function isProjectBusy(project: VideoProject): boolean {
  const isPending = (status: MediaStatus) => status === 'queued' || status === 'generating'
  if (isPending(project.finalVideoStatus)) return true
  if (project.assets.some((asset) => isPending(asset.status))) return true
  return project.shots.some((s) => isPending(s.videoStatus))
}
