import { onUnmounted, ref, shallowRef } from 'vue'
import type { VideoSharePlatform, XhsSharePayload } from '@/api/publish-code'

let xhsLoader: Promise<void> | undefined

export function loadXhsSdk() {
  if (window.xhs?.share) return Promise.resolve()
  if (!xhsLoader) {
    xhsLoader = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://fe-static.xhscdn.com/biz-static/goten/xhs-1.0.1.js'
      script.async = true
      script.onload = () => {
        if (window.xhs?.share) resolve()
        else {
          script.remove()
          reject(new Error('小红书组件没有加载成功'))
        }
      }
      script.onerror = () => {
        script.remove()
        reject(new Error('小红书组件加载失败，请检查网络'))
      }
      document.head.appendChild(script)
    }).catch((error) => {
      xhsLoader = undefined
      throw error
    })
  }
  return xhsLoader
}

export function shareError(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message
  if (typeof message === 'string' && message) return message
  if (error instanceof Error && error.message && !error.message.startsWith('Request failed')) return error.message
  return fallback
}

export function useVideoShare() {
  const inWechat = /MicroMessenger/i.test(navigator.userAgent)
  const sharing = ref<VideoSharePlatform>()
  const failHint = ref('')
  const retry = shallowRef<() => void>()
  let jumpTimer: number | undefined
  let request = 0

  function stopWatching() {
    window.clearTimeout(jumpTimer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      stopWatching()
      failHint.value = ''
      retry.value = undefined
    }
  }

  function resetShare() {
    ++request
    stopWatching()
    sharing.value = undefined
    failHint.value = ''
    retry.value = undefined
  }

  function launch(app: string, action: () => void) {
    const open = () => {
      stopWatching()
      failHint.value = ''
      document.addEventListener('visibilitychange', onVisibilityChange)
      jumpTimer = window.setTimeout(() => {
        stopWatching()
        if (!failHint.value) failHint.value = `没有打开${app}。请点「继续打开」，或检查手机是否已安装该 App。`
      }, 2300)
      try {
        action()
      } catch (error) {
        failHint.value = shareError(error, `没有打开${app}`)
      }
    }
    retry.value = open
    open()
  }

  async function shareDouyin(prepare: () => Promise<{ schema: string }>) {
    if (sharing.value) return
    resetShare()
    const current = request
    sharing.value = 'douyin'
    try {
      const { schema } = await prepare()
      if (request !== current) return
      if (!schema.startsWith('snssdk1128://openplatform/share?')) throw new Error('抖音发布链接无效，请稍后再试')
      launch('抖音', () => { window.location.href = schema })
    } catch (error) {
      if (request === current) failHint.value = shareError(error, '没有打开抖音')
    } finally {
      if (request === current) sharing.value = undefined
    }
  }

  async function shareXhs(prepare: () => Promise<XhsSharePayload>, copy?: string) {
    if (sharing.value) return
    resetShare()
    const current = request
    sharing.value = 'xhs'
    if (copy && navigator.clipboard?.writeText) void navigator.clipboard.writeText(copy).catch(() => undefined)
    try {
      const [{ video, title, content, appKey, nonce, timestamp, signature }] = await Promise.all([prepare(), loadXhsSdk()])
      if (request !== current) return
      launch('小红书', () => {
        if (!window.xhs?.share) throw new Error('小红书组件没有加载成功')
        window.xhs.share({
          shareInfo: { type: 'video', video, title, content },
          verifyConfig: { appKey, nonce, timestamp, signature },
          fail: (error) => {
            if (request === current) failHint.value = error?.message || error?.errMsg || '没有打开小红书'
          },
        })
      })
    } catch (error) {
      if (request === current) failHint.value = shareError(error, '没有打开小红书')
    } finally {
      if (request === current) sharing.value = undefined
    }
  }

  onUnmounted(resetShare)
  return { inWechat, sharing, failHint, retry, resetShare, shareDouyin, shareXhs }
}
