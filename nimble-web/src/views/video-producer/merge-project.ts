import type { MediaAsset, Shot, VideoProject, VideoTake } from '@/api/video'

const STATUS_RANK: Record<string, number> = {
  idle: 0,
  queued: 1,
  generating: 2,
  composing: 2,
  success: 3,
  done: 3,
  failed: 3,
}

function rank(status?: string | null) {
  return STATUS_RANK[status ?? ''] ?? 0
}

function isBusyStatus(status?: string | null) {
  return status === 'queued' || status === 'generating' || status === 'composing'
}

function isTerminalStatus(status?: string | null) {
  return status === 'success' || status === 'failed' || status === 'done'
}

function isPublicMediaUrl(value?: string | null): value is string {
  return !!value && /^(https?:)?\/\//i.test(value)
}

/** 服务端若误回对象键，不要盖掉本地已经能播的公网地址 */
function preferMediaUrl(local?: string | null, server?: string | null): string | null {
  if (isPublicMediaUrl(server)) return server
  if (isPublicMediaUrl(local)) return local
  return server ?? local ?? null
}

function pickProgress(local?: number | null, server?: number | null) {
  const left = typeof local === 'number' ? local : -1
  const right = typeof server === 'number' ? server : -1
  const next = Math.max(left, right)
  return next < 0 ? (server ?? local ?? null) : next
}

/** 同一轮任务状态只前进；换了一轮（重新生成）则以服务端为准 */
function takeServerStatus(local?: string | null, server?: string | null, newJob = false) {
  if (newJob) return true
  // 进行中 → 成功/失败必须立刻采用服务端，避免画面停在「生成中」
  if (isBusyStatus(local) && isTerminalStatus(server)) return true
  return rank(server) >= rank(local)
}

function mergeAsset(local: MediaAsset | undefined, server: MediaAsset, dirty: boolean): MediaAsset {
  if (!local) return server
  const localEpoch = local.epoch ?? 0
  const serverEpoch = server.epoch ?? 0
  // 迟到的旧快照（更小的 epoch）不能把已经更近的任务盖回去
  if (serverEpoch < localEpoch) {
    const merged: MediaAsset = {
      ...server,
      status: local.status,
      url: local.url ?? server.url,
      error: local.error,
      epoch: local.epoch,
    }
    return applyAssetDirty(merged, local, dirty)
  }
  const newJob = serverEpoch > localEpoch
  const takeServer = takeServerStatus(local.status, server.status, newJob)
  const merged: MediaAsset = takeServer
    ? { ...server, url: preferMediaUrl(local.url, server.url) ?? undefined }
    : {
        ...server,
        status: local.status,
        url: preferMediaUrl(local.url, server.url) ?? undefined,
        error: local.error,
        epoch: local.epoch ?? server.epoch,
      }
  // 改模型不会开新任务：服务端若误把 url 置空，保留本地已生成结果
  if (!newJob && local.url && !merged.url) {
    merged.url = local.url
    if (merged.status === 'idle' && (local.status === 'success' || local.status === 'failed')) {
      merged.status = local.status
      merged.error = local.error
    }
  }
  return applyAssetDirty(merged, local, dirty)
}

function applyAssetDirty(merged: MediaAsset, local: MediaAsset, dirty: boolean): MediaAsset {
  if (!dirty) return merged
  merged.name = local.name
  merged.prompt = local.prompt
  merged.text = local.text
  merged.modelId = local.modelId
  merged.lora = local.lora
  merged.ratio = local.ratio
  merged.resolution = local.resolution
  merged.outputFormat = local.outputFormat
  merged.promptOptimizeMode = local.promptOptimizeMode
  return merged
}

function mergeTake(local: VideoTake | undefined, server: VideoTake): VideoTake {
  if (!local) return server
  const takeServer = takeServerStatus(local.status, server.status)
  if (takeServer) {
    return {
      ...server,
      videoUrl: preferMediaUrl(local.videoUrl, server.videoUrl) ?? null,
      progress: server.status === 'generating'
        ? pickProgress(local.progress, server.progress)
        : server.progress ?? null,
    }
  }
  return {
    ...server,
    status: local.status,
        videoUrl: preferMediaUrl(local.videoUrl, server.videoUrl) ?? null,
    error: local.error,
    progress: local.status === 'generating'
      ? pickProgress(local.progress, server.progress)
      : local.progress ?? null,
  }
}

function mergeTakes(local: VideoTake[] | undefined, server: VideoTake[] | undefined): VideoTake[] {
  const remote = server ?? []
  if (!local?.length) return remote
  const merged = remote.map((row) => mergeTake(local.find((item) => item.id === row.id), row))
  // 服务端已删除的排队/生成中 take（用户中断）不要从本地拼回去
  return merged.concat(
    local.filter((item) =>
      !remote.some((row) => row.id === item.id)
      && item.status !== 'queued'
      && item.status !== 'generating',
    ),
  )
}

function takeVersion(shot: Shot, takeId?: string | null) {
  if (!takeId) return 0
  return shot.takes?.find((item) => item.id === takeId)?.version ?? 0
}

function mergeShot(local: Shot | undefined, server: Shot, dirty: boolean): Shot {
  if (!local) return server
  const localVersion = takeVersion(local, local.activeTakeId)
  const serverVersion = takeVersion(server, server.activeTakeId)
  // 迟到的旧 take 进行中状态，不能覆盖本地已完成的更新版本
  if (
    serverVersion < localVersion
    && isBusyStatus(server.videoStatus)
    && isTerminalStatus(local.videoStatus)
  ) {
    const merged: Shot = {
      ...server,
      videoStatus: local.videoStatus,
      videoUrl: preferMediaUrl(local.videoUrl, server.videoUrl) ?? null,
      videoError: local.videoError,
      videoProgress: local.videoProgress ?? null,
      videoTaskId: local.videoTaskId ?? server.videoTaskId,
      activeTakeId: local.activeTakeId ?? server.activeTakeId,
      takes: mergeTakes(local.takes, server.takes),
    }
    return applyShotDirty(merged, local, dirty)
  }
  // 只有服务端 take 版本更新才算新任务；同 take 的 queued → success 走状态前进
  const newJob = serverVersion > localVersion
  const takeServer = takeServerStatus(local.videoStatus, server.videoStatus, newJob)
  const generating = (takeServer ? server.videoStatus : local.videoStatus) === 'generating'
  const merged: Shot = takeServer
    ? {
        ...server,
        videoUrl: preferMediaUrl(local.videoUrl, server.videoUrl) ?? null,
        takes: mergeTakes(local.takes, server.takes),
        videoProgress: generating
          ? (newJob ? server.videoProgress ?? null : pickProgress(local.videoProgress, server.videoProgress))
          : server.videoProgress ?? null,
      }
    : {
        ...server,
        videoStatus: local.videoStatus,
        videoUrl: preferMediaUrl(local.videoUrl, server.videoUrl) ?? null,
        videoError: local.videoError,
        videoProgress: generating
          ? pickProgress(local.videoProgress, server.videoProgress)
          : local.videoProgress ?? null,
        videoTaskId: local.videoTaskId ?? server.videoTaskId,
        activeTakeId: local.activeTakeId ?? server.activeTakeId,
        takes: mergeTakes(local.takes, server.takes),
      }
  return applyShotDirty(merged, local, dirty)
}

function applyShotDirty(merged: Shot, local: Shot, dirty: boolean): Shot {
  if (!dirty) return merged
  merged.name = local.name
  merged.videoPrompt = local.videoPrompt
  merged.durationSec = local.durationSec
  merged.ratio = local.ratio
  merged.resolution = local.resolution
  merged.modelId = local.modelId
  merged.lora = local.lora
  return merged
}

/** 合并服务端快照：同一轮任务不回退；重新生成（新 take / 新素材 epoch / 新 composeToken）以服务端为准 */
export function mergeServerProject(
  local: VideoProject | undefined,
  server: VideoProject,
  dirty: { shotIds: Set<string>; assetIds: Set<string> },
): VideoProject {
  if (!local || local.id !== server.id) return server
  const newCompose = (server.composeToken ?? '') !== (local.composeToken ?? '')
  const takeFinal = takeServerStatus(local.finalVideoStatus, server.finalVideoStatus, newCompose)
  return {
    ...server,
    assets: server.assets.map((asset) =>
      mergeAsset(local.assets.find((item) => item.id === asset.id), asset, dirty.assetIds.has(asset.id)),
    ),
    shots: server.shots.map((shot) =>
      mergeShot(local.shots.find((item) => item.id === shot.id), shot, dirty.shotIds.has(shot.id)),
    ),
    status: takeServerStatus(local.status, server.status, newCompose) ? server.status : local.status,
    finalVideoStatus: takeFinal ? server.finalVideoStatus : local.finalVideoStatus,
    finalVideoUrl: (takeFinal
      ? preferMediaUrl(local.finalVideoUrl, server.finalVideoUrl)
      : preferMediaUrl(server.finalVideoUrl, local.finalVideoUrl)) ?? null,
    finalVideoError: takeFinal ? server.finalVideoError : local.finalVideoError,
    composeToken: takeFinal ? server.composeToken : local.composeToken,
  }
}

export function mergeServerShot(local: Shot | undefined, server: Shot, dirty: boolean): Shot {
  return mergeShot(local, server, dirty)
}
