import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { storage } from '@/utils/storage'
import { login as loginApi, loginByWechat as wechatApi, logout as logoutApi, getUserInfo } from '@/api/auth'
import { resetUserInfoCache } from '@/router'
import type { TokenResult, UserInfo } from '@/types'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(storage.getToken())
  const refreshTokenVal = ref<string | null>(storage.getRefreshToken())
  const user = ref<UserInfo | null>(storage.getUser<UserInfo>())

  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => !!user.value?.isAdmin)
  /** 默认管理员：能指定其他管理员 */
  const isSuperAdmin = computed(() => !!user.value?.isSuperAdmin)
  const isDistributor = computed(() => !!user.value?.isDistributor)
  /** 游客点了生成之类的操作时弹出登录提示 */
  const loginPromptOpen = ref(false)
  const displayName = computed(() => user.value?.nickname?.trim() || user.value?.loginName || '')

  async function login(account: string, password: string) {
    return applySession(await loginApi(account, password))
  }

  async function loginWithWechat(code: string, state: string) {
    const session = applySession(await wechatApi(code, state, storage.getRef()))
    storage.clearRef()
    return session
  }

  function applySession(data: TokenResult) {
    storage.setToken(data.accessToken)
    storage.setRefreshToken(data.refreshToken)
    if (data.user) storage.setUser(data.user)
    token.value = data.accessToken
    refreshTokenVal.value = data.refreshToken
    user.value = data.user ?? null
    return data
  }

  /** 已登录返回 true；游客弹出登录提示并返回 false。需要登录才能做的操作先调它 */
  function ensureLoggedIn(): boolean {
    if (isLoggedIn.value) return true
    loginPromptOpen.value = true
    return false
  }

  function setUser(next: UserInfo) {
    user.value = next
    storage.setUser(next)
  }

  async function fetchUserInfo() {
    setUser((await getUserInfo()).user)
  }

  async function logout() {
    try {
      await logoutApi()
    } catch {
      // ignore
    }
    clearAuth()
    resetUserInfoCache()
  }

  function setTokens(accessToken: string, newRefreshToken: string) {
    token.value = accessToken
    refreshTokenVal.value = newRefreshToken
    storage.setToken(accessToken)
    storage.setRefreshToken(newRefreshToken)
  }

  function clearAuth() {
    token.value = null
    refreshTokenVal.value = null
    user.value = null
    storage.clear()
  }

  return {
    token,
    refreshToken: refreshTokenVal,
    user,
    isLoggedIn,
    isAdmin,
    isSuperAdmin,
    isDistributor,
    loginPromptOpen,
    displayName,
    login,
    loginWithWechat,
    ensureLoggedIn,
    setUser,
    fetchUserInfo,
    logout,
    setTokens,
    clearAuth,
  }
})
