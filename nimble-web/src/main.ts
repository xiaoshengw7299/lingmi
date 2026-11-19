import { createApp } from 'vue'
import { createPinia } from 'pinia'
// 组件由 unplugin-vue-components 按需引入（不再 app.use 全量注册，入口包小一半以上）；
// 样式仍整体引入，保证 ElMessage / ElMessageBox 这类在脚本里显式 import 的 API 也有样式
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import router, { prefetchMainRoutes } from './router'
import { useThemeStore } from '@/stores/theme'
import '@/styles/variables.css'
import '@/styles/global.css'
import '@/styles/media-workspace.css'

const app = createApp(App)

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(createPinia())
useThemeStore() // 尽早创建，保证登录页等不经过布局的页面也套用主题
app.use(router)
app.mount('#app')

// 首屏就绪后，趁浏览器空闲把主菜单各页面的代码取回来：之后点菜单不再等待下载
router.isReady().then(() => {
  const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500))
  idle(prefetchMainRoutes)
})
