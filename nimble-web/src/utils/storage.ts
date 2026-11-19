const TOKEN_KEY = 'core_token'
const REFRESH_TOKEN_KEY = 'core_refresh_token'
const USER_KEY = 'core_user'
/** 邀请人的推广码。首次通过邀请链接进来时记下，第一次微信登录时带上；退出登录不清 */
const REF_KEY = 'lingmi_ref'
const SIDEBAR_KEY = 'lingmi_sidebar_collapsed'
/** 主题模式：light / dark / auto。index.html 的防闪烁脚本也读这个 key，改名要两处一起改 */
const THEME_KEY = 'lingmi_theme'

function getJson<T>(key: string): T | null {
  try {
    const item = localStorage.getItem(key)
    return item ? JSON.parse(item) : null
  } catch {
    return null
  }
}

function setJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

function remove(key: string) {
  localStorage.removeItem(key)
}

export const storage = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (token: string) => localStorage.setItem(TOKEN_KEY, token),

  getRefreshToken: () => localStorage.getItem(REFRESH_TOKEN_KEY),
  setRefreshToken: (token: string) => localStorage.setItem(REFRESH_TOKEN_KEY, token),

  getUser: <T>() => getJson<T>(USER_KEY),
  setUser: (user: unknown) => setJson(USER_KEY, user),

  getRef: () => localStorage.getItem(REF_KEY) || undefined,
  /** 已经记过就不覆盖：以第一个带来用户的邀请人为准 */
  setRefOnce: (code: string) => {
    if (!localStorage.getItem(REF_KEY)) localStorage.setItem(REF_KEY, code)
  },
  clearRef: () => remove(REF_KEY),

  isSidebarCollapsed: () => localStorage.getItem(SIDEBAR_KEY) === '1',
  setSidebarCollapsed: (collapsed: boolean) => localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'),

  getTheme: () => localStorage.getItem(THEME_KEY),
  setTheme: (mode: string) => localStorage.setItem(THEME_KEY, mode),

  clear: () => {
    remove(TOKEN_KEY)
    remove(REFRESH_TOKEN_KEY)
    remove(USER_KEY)
  },
}
