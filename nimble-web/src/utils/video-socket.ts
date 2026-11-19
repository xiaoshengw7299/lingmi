import { io, type Socket } from 'socket.io-client'
import { getVideoProject, type VideoProject } from '@/api/video'
import { storage } from '@/utils/storage'

let socket: Socket | null = null

/** 单例连接：AI 视频制作命名空间，同源通过 /socket.io 与后端通信；握手携带 JWT */
function getSocket(): Socket {
  if (!socket) {
    socket = io('/video', {
      path: '/socket.io',
      // 先走轮询。网关没放行 WebSocket 升级时，握手会 400，实时推送不能只靠这一条。
      transports: ['polling', 'websocket'],
      reconnection: true,
      auth: (cb) => {
        const token = storage.getToken()
        cb(token ? { token } : {})
      },
    })
  }
  return socket
}

export function isVideoSocketConnected() {
  return !!socket?.connected
}

/**
 * 订阅某个视频项目的实时状态推送。
 * 入房成功后再拉一次全量，避免 join 完成前错过的推送；断线重连同样补拉一次。
 * 在线期间只吃 project:updated。断线时通知调用方，由它决定要不要补拉。
 */
export function subscribeVideoProject(
  projectId: string,
  onUpdate: (project: VideoProject) => void,
  onDisconnect?: () => void,
): () => void {
  const s = getSocket()
  let active = true

  const resync = async () => {
    try {
      const project = await getVideoProject(projectId)
      if (active) onUpdate(project)
    } catch {
      // 拉取失败不影响订阅，后续推送事件仍可恢复状态
    }
  }
  const join = () => {
    s.emit('join', projectId, () => {
      void resync()
    })
  }
  const handler = (payload: VideoProject) => {
    if (payload?.id === projectId) onUpdate(payload)
  }
  const disconnect = () => {
    if (active) onDisconnect?.()
  }

  if (s.connected) join()
  s.on('connect', join)
  s.on('disconnect', disconnect)
  s.on('project:updated', handler)

  return () => {
    active = false
    s.off('connect', join)
    s.off('disconnect', disconnect)
    s.off('project:updated', handler)
    s.emit('leave', projectId)
  }
}
