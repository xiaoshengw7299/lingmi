import { getGenerationModels, type GenerationModels } from '@/api/generation'
import type { MediaModelOption } from '@/api/video'

export interface ModelParams {
  ratio?: string
  resolution?: string
  durationSec?: number
}

let modelsPromise: Promise<GenerationModels> | undefined

/** 模型列表整个会话只取一次（配置变更需要刷新页面，可接受） */
export function loadGenerationModels(): Promise<GenerationModels> {
  modelsPromise ??= getGenerationModels().catch((error) => {
    modelsPromise = undefined
    throw error
  })
  return modelsPromise
}

export const defaultModel = (models: MediaModelOption[]) => models.find((m) => m.isDefault) ?? models[0]

/** 把比例 / 清晰度 / 时长收敛到所选模型支持的取值，切换模型后不会留下无效参数 */
export function fitToModel(model: MediaModelOption | undefined, params: ModelParams): ModelParams {
  if (!model) return params
  const ratio = params.ratio && model.ratios.includes(params.ratio) ? params.ratio : model.defaultRatio
  const resolution =
    params.resolution && model.resolutions.includes(params.resolution)
      ? params.resolution
      : (model.defaultResolution ?? model.resolutions[0])
  const durationSec = Math.min(model.maxDuration, Math.max(model.minDuration, params.durationSec ?? model.minDuration))
  return { ratio, resolution, durationSec }
}
