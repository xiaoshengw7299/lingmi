import { ref } from 'vue'
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { applyHead } from '@/seo/head'
import { storage } from '@/utils/storage'
import { useAuthStore } from '@/stores/auth'
import { GENERAL_TOOL_MENU, VIDEO_TOOL_MENU } from '@/views/tools/menu'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    /** Element Plus 图标名，侧栏用 */
    icon?: string
    /** 侧栏分组标题 */
    group?: string
    hideNav?: boolean
    requiresAuth?: boolean
    requiresAdmin?: boolean
    requiresDistributor?: boolean
    guestOnly?: boolean
  }
}

/** 视频工具 / 通用工具：每个工具一个子菜单，共用同一个工作台页面 */
function toolRoutes(path: string, title: string, icon: string, menu: Array<{ id: string; title: string }>): RouteRecordRaw {
  return {
    path,
    name: path,
    redirect: `/${path}/${menu[0].id}`,
    meta: { title, icon, group: '工具' },
    children: menu.map((item) => ({
      path: item.id,
      name: `${path}-${item.id}`,
      component: () => import('@/views/tools/index.vue'),
      props: { toolId: item.id },
      meta: { title: item.title },
    })),
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/auth/index.vue'),
    meta: { guestOnly: true, title: '登录' },
  },
  {
    path: '/login/wechat',
    name: 'login-wechat',
    component: () => import('@/views/auth/wechat-callback.vue'),
  },
  {
    path: '/s/:code',
    name: 'publish-landing',
    component: () => import('@/views/publish/index.vue'),
    meta: { title: '扫码发布', hideNav: true },
  },
  {
    path: '/',
    name: 'layout',
    component: () => import('@/layout/index.vue'),
    children: [
      {
        path: '',
        name: 'home',
        component: () => import('@/views/home/index.vue'),
        meta: { title: '首页', icon: 'HomeFilled' },
      },
      {
        // 一个「视频制作」菜单，页面内用标签切换「通用创作 / 无限画布」：两边是互相独立的页面，
        // 各有各的会话 / 画布列表和数据；子路由不带 title，所以侧栏不会生成子菜单
        path: 'video-producer',
        name: 'video-producer',
        component: () => import('@/views/video-producer/layout.vue'),
        redirect: '/video-producer/studio',
        meta: { title: '视频制作', icon: 'VideoCamera', group: '创作' },
        children: [
          { path: 'studio', name: 'video-studio', component: () => import('@/views/video-producer/index.vue') },
          { path: 'canvas', name: 'video-canvas', component: () => import('@/views/canvas/index.vue') },
        ],
      },
      {
        path: 'short-video',
        name: 'short-video',
        component: () => import('@/views/short-video/index.vue'),
        meta: { title: '一键成片', icon: 'Film', group: '创作' },
      },
      {
        path: 'viral-clone',
        name: 'viral-clone',
        component: () => import('@/views/tools/index.vue'),
        props: { toolId: 'viral-clone' },
        meta: { title: '爆款复刻', icon: 'MagicStick', group: '创作' },
      },
      { path: 'video-tools/viral-clone', redirect: '/viral-clone' },
      toolRoutes('video-tools', '视频工具', 'VideoPlay', VIDEO_TOOL_MENU),
      toolRoutes('general-tools', '通用工具', 'Tools', GENERAL_TOOL_MENU),
      {
        path: 'pricing',
        name: 'pricing',
        component: () => import('@/views/pricing/index.vue'),
        meta: { title: '模型价格', icon: 'PriceTag', group: '资源' },
      },
      {
        path: 'prompts',
        name: 'prompts',
        component: () => import('@/views/prompts/index.vue'),
        meta: { title: '提示词库', icon: 'MagicStick', group: '资源' },
      },
      {
        path: 'forum',
        name: 'forum',
        component: () => import('@/views/forum/index.vue'),
        meta: { title: '论坛&反馈', icon: 'ChatDotRound', group: '资源' },
      },
      {
        path: 'guide',
        name: 'guide',
        component: () => import('@/views/guide/index.vue'),
        meta: { title: '产品介绍', icon: 'Reading', group: '资源' },
      },
      {
        path: 'assets',
        name: 'assets',
        component: () => import('@/views/assets/index.vue'),
        meta: { title: '我的资产', icon: 'FolderOpened', group: '资源', requiresAuth: true },
      },
      {
        path: 'terms',
        name: 'terms',
        component: () => import('@/views/legal/index.vue'),
        meta: { title: '用户协议', hideNav: true },
      },
      {
        path: 'privacy',
        name: 'privacy',
        component: () => import('@/views/legal/index.vue'),
        meta: { title: '隐私政策', hideNav: true },
      },
      {
        path: 'user',
        name: 'user',
        component: () => import('@/views/user/index.vue'),
        redirect: '/user/profile',
        meta: { title: '用户中心', hideNav: true, requiresAuth: true },
        children: [
          { path: 'profile', name: 'user-profile', component: () => import('@/views/user/profile.vue') },
          { path: 'wallet', name: 'user-wallet', component: () => import('@/views/user/wallet.vue') },
          { path: 'referral', name: 'user-referral', component: () => import('@/views/user/referral.vue') },
          { path: 'security', name: 'user-security', component: () => import('@/views/user/security.vue') },
        ],
      },
      {
        path: 'distributor',
        name: 'distributor',
        component: () => import('@/views/distributor/index.vue'),
        meta: { title: '分销后台', requiresDistributor: true, hideNav: true },
      },
      {
        path: 'admin/stats',
        name: 'admin-stats',
        component: () => import('@/views/admin/stats.vue'),
        meta: { title: '运营统计', requiresAdmin: true, hideNav: true },
      },
      {
        path: 'admin/users',
        name: 'admin-users',
        component: () => import('@/views/admin/users.vue'),
        meta: { title: '用户管理', requiresAdmin: true, hideNav: true },
      },
      {
        path: 'admin/pricing',
        name: 'admin-pricing',
        component: () => import('@/views/admin/pricing.vue'),
        meta: { title: '模型定价', requiresAdmin: true, hideNav: true },
      },
      {
        path: 'admin/bills',
        name: 'admin-bills',
        component: () => import('@/views/admin/bills.vue'),
        meta: { title: '消费账单', requiresAdmin: true, hideNav: true },
      },
      {
        path: 'admin/distributors',
        name: 'admin-distributors',
        component: () => import('@/views/admin/distributors.vue'),
        meta: { title: '分销商', requiresAdmin: true, hideNav: true },
      },
      {
        path: 'admin/config',
        name: 'admin-config',
        component: () => import('@/views/admin/config.vue'),
        meta: { title: '系统配置', requiresAdmin: true, hideNav: true },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFound.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

let userInfoFetched = false

/** 路由切换进行中（含懒加载页面代码的时间）：布局据此显示顶部进度条，点击后立刻有反馈 */
export const navigating = ref(false)
router.onError(() => (navigating.value = false))

/** 预取页面代码：悬停菜单时取目标页，空闲时取所有主菜单页，真正点击时代码已经在本地 */
const prefetched = new Set<unknown>()
function prefetchLoader(loader: unknown) {
  if (typeof loader !== 'function' || prefetched.has(loader)) return
  prefetched.add(loader)
  ;(loader as () => Promise<unknown>)().catch(() => prefetched.delete(loader))
}

export function prefetchRoute(path: string) {
  router.resolve(path).matched.forEach((r) => prefetchLoader(r.components?.default))
}

export function prefetchMainRoutes() {
  // 菜单项及其全部子路由（子路由没有 title，如视频制作里的两个标签页）都预取
  const walk = (list: RouteRecordRaw[], inMenu: boolean) =>
    list.forEach((r) => {
      const shown = inMenu || (!!r.meta?.title && !r.meta.hideNav)
      if (shown) prefetchLoader(r.component)
      if (r.children) walk(r.children, shown)
    })
  walk(routes, false)
}

router.beforeEach(async (to) => {
  // 邀请链接 ?ref=xxx：记下第一个邀请人，第一次微信登录时带给后端
  if (typeof to.query.ref === 'string' && to.query.ref) storage.setRefOnce(to.query.ref.slice(0, 16))

  navigating.value = true
  const token = storage.getToken()
  const authStore = useAuthStore()
  if (token && !userInfoFetched) {
    userInfoFetched = true
    const loading = authStore.fetchUserInfo().catch(() => {})
    // 只有需要管理员 / 分销商身份的页面才必须等用户信息；其余页面不被这次请求拖住
    if (to.matched.some((r) => r.meta.requiresAdmin || r.meta.requiresDistributor)) await loading
  }

  if (to.meta.guestOnly && token) return { path: '/' }

  const needsAuth = to.matched.some((r) => r.meta.requiresAuth || r.meta.requiresAdmin || r.meta.requiresDistributor)
  if (needsAuth && !token) return { path: '/login', query: { redirect: to.fullPath } }
  if (to.matched.some((r) => r.meta.requiresAdmin) && !authStore.isAdmin) return { path: '/' }
  if (to.matched.some((r) => r.meta.requiresDistributor) && !authStore.isDistributor) return { path: '/' }
  return true
})

router.afterEach((to) => {
  navigating.value = false
  const routeTitle = [...to.matched].reverse().find((r) => r.meta.title)?.meta.title
  applyHead(to.name === 'not-found' ? '/404' : to.path, typeof routeTitle === 'string' ? routeTitle : undefined)
})

export function resetUserInfoCache() {
  userInfoFetched = false
}

export default router
