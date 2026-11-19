import { ElMessage } from 'element-plus'
import { createGeneration, pollGeneration, type GenerateParams, type GenerationTask } from '@/api/generation'
import { useAuthStore } from '@/stores/auth'
import { compileReferences, MENTION_FORBIDDEN, type RefKind } from '@/utils/references'
import { useCanvasStore } from './store'
import { NODE_META, type CanvasNode } from './types'

const DEFAULT_NODE_WIDTH = 280
/** "16:9" → 高宽比；解析失败返回 1 */
function ratioToAspect(ratio?: string): number {
  const [w, h] = (ratio ?? '').split(':').map(Number)
  return w > 0 && h > 0 ? h / w : 1
}

/** 节点外框占的空间：左右各 6px 边距，顶部标题栏 30px + 底部 6px。成品区尺寸 = 节点尺寸 - 外框 */
const CHROME_W = 12
const CHROME_H = 36

/** 按画面比例给节点算合适的高度，让成品刚好铺满成品区：不被裁切，也不留大片空白 */
export function heightForRatio(width: number, ratio?: string) {
  return Math.round(Math.min(560, Math.max(120, (width - CHROME_W) * ratioToAspect(ratio) + CHROME_H)))
}

const MEDIA_BASE_WIDTH = { image: 360, video: 400 } as const
const MIN_BODY_HEIGHT = 90
const MAX_BODY_HEIGHT = 480
const MEASURE_TIMEOUT_MS = 8000

/** 读取图片 / 视频的真实宽高；读不到（损坏、超时）返回 undefined */
function measureMedia(kind: 'image' | 'video', url: string): Promise<{ w: number; h: number } | undefined> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(undefined), MEASURE_TIMEOUT_MS)
    const done = (size?: { w: number; h: number }) => {
      window.clearTimeout(timer)
      resolve(size && size.w > 0 && size.h > 0 ? size : undefined)
    }
    if (kind === 'image') {
      const img = new Image()
      img.onload = () => done({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => done()
      img.src = url
    } else {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => done({ w: video.videoWidth, h: video.videoHeight })
      video.onerror = () => done()
      video.src = url
    }
  })
}

/**
 * 按成品的真实比例算节点尺寸：宽取默认宽度，过高或过矮时改按高度反推宽度，
 * 这样上传的图、视频在画布上既不会缩成一小块，也不会被裁切或留大片空白。音频 / 文本不处理。
 */
export async function mediaSizeFor(kind: string, url: string): Promise<{ w: number; h: number } | undefined> {
  if (kind !== 'image' && kind !== 'video') return undefined
  const dims = await measureMedia(kind, url)
  if (!dims) return undefined
  const aspect = dims.h / dims.w
  let bodyW = MEDIA_BASE_WIDTH[kind] - CHROME_W
  let bodyH = bodyW * aspect
  if (bodyH > MAX_BODY_HEIGHT || bodyH < MIN_BODY_HEIGHT) {
    bodyH = Math.min(MAX_BODY_HEIGHT, Math.max(MIN_BODY_HEIGHT, bodyH))
    bodyW = bodyH / aspect
  }
  return { w: Math.round(bodyW + CHROME_W), h: Math.round(bodyH + CHROME_H) }
}

/**
 * 给参考节点起"可 @ 的名字"：取节点标题，去掉不能进 @ 的字符；重名的统一加序号。
 * 提示词里写 @名字，生成时据此换成"参考图1 / 参考视频1…"，模型才知道说的是哪一张。
 */
export function referenceNames(refs: CanvasNode[]): Map<string, string> {
  const base = refs.map((r) => r.title.replace(MENTION_FORBIDDEN, '') || NODE_META[r.type].label)
  const seen = new Map<string, number>()
  return new Map(
    refs.map((r, i) => {
      const dup = base.filter((b) => b === base[i]).length > 1
      const n = (seen.get(base[i]) ?? 0) + 1
      seen.set(base[i], n)
      return [r.id, dup ? `${base[i]}${n}` : base[i]]
    }),
  )
}

/**
 * 画布节点生成：把"连进来的节点"整理成参考素材 → 走统一生成接口 → 把结果写回节点。
 * 连线即参考：图片/视频/音频节点作为参考素材，文本节点作为上下文拼进提示词。
 */
export function useNodeGeneration() {
  const store = useCanvasStore()
  const auth = useAuthStore()

  function buildParams(node: CanvasNode): GenerateParams {
    const refs = store.referencesOf(node.id)
    const names = referenceNames(refs)
    const compiled = compileReferences(
      node.prompt,
      refs.map((r) => ({ name: names.get(r.id)!, kind: r.type as RefKind, url: r.url, text: r.text })),
    )
    return {
      ...compiled,
      kind: node.type as GenerateParams['kind'],
      modelId: node.modelId,
      ratio: node.ratio,
      resolution: node.resolution,
      outputFormat: node.type === 'image' ? node.outputFormat : undefined,
      promptOptimizeMode: node.type === 'image' ? node.promptOptimizeMode : undefined,
      lora: node.type === 'image' || node.type === 'video' ? node.lora : undefined,
      durationSec: node.type === 'video' ? node.durationSec : undefined,
      generateAudio: node.type === 'video' ? node.generateAudio : undefined,
      voice: node.type === 'audio' ? node.voice : undefined,
    }
  }

  function applyResult(node: CanvasNode, task: GenerationTask) {
    if (node.type === 'text') {
      store.updateNode(node.id, { text: task.text ?? '', status: 'idle', taskId: undefined, error: undefined })
      return
    }
    const patch: Partial<CanvasNode> = { url: task.url ?? undefined, thumb: task.thumbUrl ?? undefined, status: 'idle', taskId: undefined, error: undefined }
    if (node.type !== 'audio') patch.h = heightForRatio(node.w || DEFAULT_NODE_WIDTH, node.ratio)
    store.updateNode(node.id, patch)
  }

  async function wait(node: CanvasNode, taskId: string) {
    try {
      const task = await pollGeneration(taskId)
      const latest = store.nodeMap.get(node.id) // 等待期间用户可能改过参数或删掉了节点
      if (latest) applyResult(latest, task)
    } catch (error) {
      store.updateNode(node.id, { status: 'failed', error: (error as Error).message, taskId: undefined }, false)
    }
  }

  async function generate(node: CanvasNode) {
    if (node.type === 'group' || !auth.ensureLoggedIn()) return
    const params = buildParams(node)
    if (!params.prompt) {
      ElMessage.warning('请先填写提示词')
      return
    }
    store.updateNode(node.id, { status: 'generating', error: undefined }, false)
    try {
      const created = await createGeneration(params)
      store.updateNode(node.id, { taskId: created.id }, false)
      await wait(node, created.id)
    } catch (error) {
      store.updateNode(node.id, { status: 'failed', error: (error as Error).message }, false)
    }
  }

  /** 页面刷新后，继续等待上次还在跑的任务 */
  function resumePending() {
    for (const node of store.nodes) {
      if (node.status === 'generating' && node.taskId) void wait(node, node.taskId)
      else if (node.status === 'generating') store.updateNode(node.id, { status: 'idle' }, false)
    }
  }

  return { generate, resumePending }
}
