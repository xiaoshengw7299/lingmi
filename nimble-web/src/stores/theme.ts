import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { storage } from '@/utils/storage'

export type ThemeMode = 'light' | 'dark'

/** 主题：浅色 / 暗黑，点击直接切换。第一次访问跟随系统偏好，之后以用户选择为准 */
export const useThemeStore = defineStore('theme', () => {
  const stored = storage.getTheme()
  const mode = ref<ThemeMode>(
    stored === 'dark' || stored === 'light' ? stored : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  )
  const isDark = computed(() => mode.value === 'dark')

  function apply() {
    document.documentElement.classList.toggle('dark', isDark.value)
  }

  function toggle() {
    mode.value = isDark.value ? 'light' : 'dark'
    storage.setTheme(mode.value)
    apply()
  }

  apply()

  return { mode, isDark, toggle }
})