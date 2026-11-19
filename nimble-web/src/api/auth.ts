import { get, post, patch } from '@/utils/request'
import type { TokenResult, UserInfo } from '@/types'

export const getAuthProviders = () => get<{ wechat: boolean }>('/auth/providers')

export const login = (account: string, password: string) =>
  post<TokenResult>('/auth/login', { account, password })

export const getWechatConnect = () =>
  get<{ appId: string; redirectUri: string; state: string; url: string }>('/auth/wechat/connect')

export const loginByWechat = (code: string, state: string, ref?: string) =>
  post<TokenResult>('/auth/wechat/login', { code, state, ref })

export const logout = () => post('/auth/logout')

export const getUserInfo = () => get<{ user: UserInfo }>('/auth/me')

export const updateProfile = (nickname: string) => patch<{ user: UserInfo }>('/auth/profile', { nickname })

export const changeLoginName = (account: string) => patch<{ user: UserInfo }>('/auth/login-name', { account })

/** 改密码后换发令牌：其他设备被踢下线，当前设备用新令牌继续 */
export const changePassword = (newPassword: string, oldPassword?: string) =>
  patch<{ accessToken: string; refreshToken: string }>('/auth/password', { oldPassword, newPassword })

export const uploadAvatar = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return post<{ user: UserInfo }>('/auth/avatar', form)
}
