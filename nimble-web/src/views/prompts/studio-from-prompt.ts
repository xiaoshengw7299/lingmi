import { addAsset, addShot, createBlankProject, importAsset, type VideoProject } from '@/api/video'
import type { PromptItem } from '@/api/prompt'
import { MENTION_FORBIDDEN } from '@/utils/references'

type PromptUse = Pick<PromptItem, 'title' | 'content' | 'type' | 'modelId' | 'params' | 'references'>

const DEFAULT_SHOT_SECONDS = 5

/**
 * 在通用创作里使用提示词：新建工作台，参考素材引入素材库，
 * 图片提示词变成「新建图片素材」、视频提示词变成「新建分镜」，提示词里的 @名称 指向这些素材。
 */
export async function createStudioFromPrompt(data: PromptUse, sessionId: string): Promise<VideoProject> {
  let project = await createBlankProject({ sessionId, title: data.title.slice(0, 60) })
  let content = data.content

  for (const ref of data.references) {
    const before = project.assets
    try {
      project = await importAsset(project.id, { url: ref.url, name: ref.name })
    } catch {
      continue // 个别素材格式或时长不符不拖累其余，原因已由请求拦截器提示
    }
    const created = project.assets.find((a) => !before.some((b) => b.id === a.id))
    // 素材库会给重名素材改名，提示词里的 @ 要跟着指向实际名称
    if (created && created.name !== ref.name) content = content.split(`@${ref.name}`).join(`@${created.name}`)
  }

  const name = data.title.replace(MENTION_FORBIDDEN, '').slice(0, 20) || (data.type === 'video' ? '分镜' : '图片')
  const { ratio, resolution, durationSec } = data.params ?? {}
  if (data.type === 'video') {
    project = await addShot(project.id, {
      name,
      videoPrompt: content,
      durationSec: durationSec ?? DEFAULT_SHOT_SECONDS,
      ratio,
      resolution,
      modelId: data.modelId ?? undefined,
    })
  } else {
    project = await addAsset(project.id, { name, prompt: content, modelId: data.modelId ?? undefined, ratio, resolution })
  }
  return project
}
