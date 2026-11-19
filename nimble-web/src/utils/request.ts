import axios, { type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'
import { storage } from './storage'
import router from '@/router'

let isRefreshing = false
let requestQueue: Array<(token: string) => void> = []

const instance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 5 * 60 * 1000,
})

/** 游客本来就能调用的写接口 */
const GUEST_WRITE_PATHS = ['/auth/login', '/auth/wechat/login', '/publish-code/p/']

/** 游客发起了需要登录的操作：已经弹出登录提示，请求不会发出，调用方静默处理即可 */
export class LoginRequiredError extends Error {
  constructor() {
    super('请先登录')
    this.name = 'LoginRequiredError'
  }
}

/**
 * 创作页面对游客开放浏览，登录只在真正"动手"时才要求：
 * 游客发出的读请求照常放行（公开接口能返回数据，其余由服务端 401 静默处理），
 * 写请求（生成、上传、创建、删除……）在这里统一拦下并弹出登录提示，不用在每个按钮上单独判断。
 */
instance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = storage.getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
    return config
  }
  const isWrite = !['get', 'head', 'options'].includes((config.method ?? 'get').toLowerCase())
  if (isWrite && config.url !== '/publish-code/video' && !GUEST_WRITE_PATHS.some((path) => config.url?.startsWith(path))) {
    const { useAuthStore } = await import('@/stores/auth')
    useAuthStore().ensureLoggedIn()
    throw new LoginRequiredError()
  }
  return config
})

instance.interceptors.response.use(
  (response) => {
    const res = response.data
    // 统一约定：{ code, data, message }，2xx 视为成功
    if (typeof res?.code === 'number' && res.code >= 200 && res.code < 300) {
      return res.data
    }
    ElMessage.error(res?.message || '请求失败')
    return Promise.reject(new Error(res?.message || '请求失败'))
  },
  async (error) => {
    if (error instanceof LoginRequiredError) return Promise.reject(error)
    const originalRequest = error.config

    if (error.response?.status === 401 && !originalRequest._retry) {
      const refreshToken = storage.getRefreshToken()
      if (!refreshToken) {
        if (originalRequest.headers?.Authorization) clearSession()
        return Promise.reject(error)
      }

      if (isRefreshing) {
        return new Promise((resolve) => {
          requestQueue.push((token: string) => {
            originalRequest.headers.Authorization = `Bearer ${token}`
            resolve(instance(originalRequest))
          })
        })
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        const res = await axios.post(
          `${import.meta.env.VITE_API_BASE_URL || '/api'}/auth/refresh`,
          { refreshToken },
        )
        // refresh 接口同样是 { code, data, message }
        const { accessToken, refreshToken: newRefreshToken } = res.data.data
        // 同时更新 storage 和 Pinia store，保持状态一致
        const { useAuthStore } = await import('@/stores/auth')
        useAuthStore().setTokens(accessToken, newRefreshToken)
        requestQueue.forEach((cb) => cb(accessToken))
        requestQueue = []
        originalRequest.headers.Authorization = `Bearer ${accessToken}`
        return instance(originalRequest)
      } catch {
        clearSession()
        const current = router.currentRoute.value.fullPath
        if (router.currentRoute.value.name !== 'login') {
          router.push({ path: '/login', query: { redirect: current } })
        }
        return Promise.reject(error)
      } finally {
        isRefreshing = false
      }
    }

    const msg = error.response?.data?.message || error.message || '网络错误'
    if (error.response?.status === 402) {
      // 余额不足不是报错，是该引导用户去充值
      import('@/stores/wallet').then(({ useWalletStore }) => useWalletStore().openRecharge(msg))
    } else if (error.response?.status !== 401 && !error.response?.data?.data?.shortVideoQuote) {
      ElMessage.error(msg)
    }
    return Promise.reject(error)
  },
)

function clearSession() {
  storage.clear()
  import('@/stores/auth').then(({ useAuthStore }) => useAuthStore().clearAuth())
}

export const get = <T = any>(url: string, params?: object, config?: AxiosRequestConfig): Promise<T> =>
  instance.get(url, { ...config, params }) as unknown as Promise<T>

export const post = <T = any>(url: string, data?: object, config?: AxiosRequestConfig): Promise<T> =>
  instance.post(url, data, config) as unknown as Promise<T>

export const put = <T = any>(url: string, data?: object, config?: AxiosRequestConfig): Promise<T> =>
  instance.put(url, data, config) as unknown as Promise<T>

export const patch = <T = any>(url: string, data?: object, config?: AxiosRequestConfig): Promise<T> =>
  instance.patch(url, data, config) as unknown as Promise<T>

export const del = <T = any>(url: string, data?: object): Promise<T> =>
  instance.delete(url, { data }) as unknown as Promise<T>

export default instance
