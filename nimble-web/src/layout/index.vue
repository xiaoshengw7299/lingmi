<template>
  <div class="shell" :class="{ 'is-collapsed': collapsed, 'is-mobile-open': mobileOpen }">
    <div v-if="navigating" class="nav-progress" />
    <div class="scrim" @click="mobileOpen = false" />

    <aside class="sidebar">
      <router-link to="/" class="brand" @click="mobileOpen = false">
        <BrandLogo :size="34" :text="!collapsed" />
      </router-link>

      <nav class="nav">
        <template v-for="group in groups" :key="group.label">
          <p v-if="!collapsed" class="nav-label">{{ group.label }}</p>
          <span v-else class="nav-sep" />

          <template v-for="item in group.items" :key="item.path">
            <!-- 收起时没有位置展开子菜单，悬停图标弹出全部二级菜单 -->
            <el-dropdown
              v-if="collapsed && item.children.length"
              trigger="hover"
              placement="right-start"
              @command="(path: string) => router.push(path)"
            >
              <button type="button" class="nav-item" :class="{ 'is-active': isActive(item) }" :aria-label="item.title">
                <el-icon :size="18"><component :is="item.icon" /></el-icon>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    v-for="child in item.children"
                    :key="child.path"
                    :command="child.path"
                    :class="{ 'nav-popper-active': route.path === child.path }"
                  >
                    {{ child.title }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-tooltip v-else :content="item.title" placement="right" :disabled="!collapsed">
              <router-link
                v-if="!item.children.length"
                :to="item.path"
                class="nav-item"
                :class="{ 'is-active': isActive(item) }"
                @pointerenter="prefetchRoute(item.path)"
                @click="mobileOpen = false"
              >
                <el-icon :size="18"><component :is="item.icon" /></el-icon>
                <span class="nav-text">{{ item.title }}</span>
              </router-link>
              <button
                v-else
                type="button"
                class="nav-item"
                :class="{ 'is-active': isActive(item) }"
                @click="toggleGroup(item)"
              >
                <el-icon :size="18"><component :is="item.icon" /></el-icon>
                <span class="nav-text">{{ item.title }}</span>
                <el-icon class="chevron" :class="{ 'is-open': expanded.has(item.path) }"><ArrowDown /></el-icon>
              </button>
            </el-tooltip>

            <div v-if="item.children.length && expanded.has(item.path) && !collapsed" class="nav-sub">
              <router-link
                v-for="child in item.children"
                :key="child.path"
                :to="child.path"
                class="nav-sub-item"
                :class="{ 'is-active': route.path === child.path }"
                @pointerenter="prefetchRoute(child.path)"
                @click="mobileOpen = false"
              >
                {{ child.title }}
              </router-link>
            </div>
          </template>
        </template>
      </nav>

      <p v-if="!collapsed" class="sidebar-foot">{{ APP_CONFIG.slogan }}</p>
    </aside>

    <div class="main">
      <header class="topbar">
        <button type="button" class="icon-btn" :aria-label="collapsed ? '展开导航' : '收起导航'" @click="toggleSidebar">
          <el-icon :size="18"><component :is="collapsed ? 'Expand' : 'Fold'" /></el-icon>
        </button>
        <p class="page-name">{{ pageName }}</p>

        <div class="topbar-right">
          <button type="button" class="icon-btn theme-btn" :aria-label="theme.isDark ? '切换到浅色' : '切换到暗黑'" :title="theme.isDark ? '切换到浅色' : '切换到暗黑'" @click="theme.toggle">
            <el-icon :size="18"><component :is="theme.isDark ? Sunny : Moon" /></el-icon>
          </button>
          <template v-if="!authStore.isLoggedIn">
            <el-button type="primary" round @click="goAuth">登录</el-button>
          </template>
          <template v-else>
            <button type="button" class="balance" title="点击充值" :aria-label="`余额 ¥ ${yuan(wallet.balanceCents)}，点击充值`" @click="wallet.openRecharge()">
              <el-icon><Wallet /></el-icon>
              <span class="lm-money">¥ {{ yuan(wallet.balanceCents) }}</span>
              <span class="plus">充值</span>
            </button>
            <el-dropdown trigger="click" placement="bottom-end" popper-class="avatar-menu" @command="onCommand">
              <button type="button" class="user" aria-label="账户菜单">
                <UserAvatar :size="32" />
                <span class="user-name">{{ authStore.displayName }}</span>
                <el-icon><ArrowDown /></el-icon>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="/user/profile" :icon="User" :aria-current="route.path.startsWith('/user/') ? 'page' : undefined">用户中心</el-dropdown-item>
                  <el-dropdown-item v-if="authStore.isDistributor" divided command="/distributor" :icon="Share" :aria-current="route.path === '/distributor' ? 'page' : undefined">分销后台</el-dropdown-item>
                  <template v-if="authStore.isAdmin">
                    <el-dropdown-item
                      v-for="(item, index) in adminMenu"
                      :key="item.path"
                      :divided="index === 0"
                      :command="item.path"
                      :icon="item.icon"
                      :aria-current="route.path === item.path ? 'page' : undefined"
                    >{{ item.label }}</el-dropdown-item>
                  </template>
                  <el-dropdown-item divided command="logout" :icon="SwitchButton" class="avatar-logout">退出登录</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </div>
      </header>

      <main class="content">
        <router-view v-slot="{ Component }">
          <transition name="page">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>

    <RechargeDialog />
    <LoginPrompt />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { ArrowDown, Moon, PriceTag, Setting, Share, Sunny, SwitchButton, Tickets, TrendCharts, User, UserFilled, Wallet } from '@element-plus/icons-vue'
import BrandLogo from '@/components/BrandLogo.vue'
import LoginPrompt from '@/components/LoginPrompt.vue'
import RechargeDialog from '@/components/RechargeDialog.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { APP_CONFIG } from '@/config'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import { useThemeStore } from '@/stores/theme'
import { navigating, prefetchRoute } from '@/router'
import { storage } from '@/utils/storage'
import { yuan } from '@/utils/format'

interface NavItem {
  path: string
  title: string
  icon: string
  group: string
  children: Array<{ path: string; title: string }>
}

/** 余额自动刷新间隔：生成任务在后台扣费，用户停留在页面时也要看到变化 */
const BALANCE_REFRESH_MS = 60_000

const adminMenu = [
  { path: '/admin/stats', label: '运营统计', icon: TrendCharts },
  { path: '/admin/bills', label: '消费账单', icon: Tickets },
  { path: '/admin/pricing', label: '模型定价', icon: PriceTag },
  { path: '/admin/users', label: '用户管理', icon: UserFilled },
  { path: '/admin/distributors', label: '分销商', icon: Share },
  { path: '/admin/config', label: '系统配置', icon: Setting },
]

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const wallet = useWalletStore()
const theme = useThemeStore()

const collapsed = ref(storage.isSidebarCollapsed())
const mobileOpen = ref(false)
const expanded = reactive(new Set<string>())

// ── 导航：直接从路由 meta 派生，加页面只需要改路由 ──────────────────
const items = computed<NavItem[]>(() => {
  const root = router.getRoutes().find((r) => r.name === 'layout')
  return (root?.children ?? [])
    .filter((r) => r.meta?.title && !r.meta?.hideNav)
    .map((r) => {
      const base = r.path ? `/${r.path}` : '/'
      return {
        path: base,
        title: String(r.meta?.title),
        icon: String(r.meta?.icon ?? 'Menu'),
        group: String(r.meta?.group ?? ''),
        children: (r.children ?? [])
          .filter((c) => c.meta?.title && c.path)
          .map((c) => ({ path: `${base}/${c.path}`, title: String(c.meta!.title) })),
      }
    })
})
const groups = computed(() => {
  const map = new Map<string, NavItem[]>()
  for (const item of items.value) map.set(item.group, [...(map.get(item.group) ?? []), item])
  return [...map.entries()].map(([label, list]) => ({ label, items: list }))
})

function isActive(item: NavItem) {
  return item.path === '/' ? route.path === '/' : route.path === item.path || route.path.startsWith(`${item.path}/`)
}

function toggleGroup(item: NavItem) {
  if (expanded.has(item.path)) expanded.delete(item.path)
  else expanded.add(item.path)
}

// 进入某个带子菜单的页面时自动展开它
watch(
  () => route.path,
  () => items.value.filter((i) => i.children.length && isActive(i)).forEach((i) => expanded.add(i.path)),
  { immediate: true },
)

const pageName = computed(() => {
  const trail = route.matched.filter((r) => r.meta?.title).map((r) => String(r.meta.title))
  return route.path === '/' ? `${APP_CONFIG.brandCn} · ${APP_CONFIG.brand}` : [...new Set(trail)].join(' / ')
})

function toggleSidebar() {
  if (window.matchMedia('(max-width: 860px)').matches) {
    // 窄屏的侧栏是抽屉，不存在"收起"，避免沿用桌面端的收起状态导致子菜单出不来
    collapsed.value = false
    mobileOpen.value = !mobileOpen.value
    return
  }
  collapsed.value = !collapsed.value
  storage.setSidebarCollapsed(collapsed.value)
}

// ── 登录态 / 余额 ────────────────────────────────────────────────────
function goAuth() {
  router.push({ path: '/login', query: { redirect: route.fullPath } })
}

async function onCommand(command: string) {
  if (command !== 'logout') {
    router.push(command)
    return
  }
  const confirmed = await ElMessageBox.confirm('确定要退出登录吗？', '提示', { type: 'warning', confirmButtonText: '退出', cancelButtonText: '取消' }).catch(() => undefined)
  if (!confirmed) return
  await authStore.logout()
  wallet.balanceCents = null
  router.push('/')
}

let refreshTimer: number | undefined
const refreshWhenVisible = () => document.visibilityState === 'visible' && wallet.refresh()

watch(() => authStore.isLoggedIn, (loggedIn) => loggedIn && wallet.refresh(), { immediate: true })
onMounted(() => {
  refreshTimer = window.setInterval(refreshWhenVisible, BALANCE_REFRESH_MS)
  document.addEventListener('visibilitychange', refreshWhenVisible)
})
onBeforeUnmount(() => {
  window.clearInterval(refreshTimer)
  document.removeEventListener('visibilitychange', refreshWhenVisible)
})
</script>

<style scoped>
.shell { display: flex; height: 100vh; }

/* ===== 侧栏 ===== */
.sidebar {
  width: var(--sidebar-width); flex-shrink: 0; display: flex; flex-direction: column; padding: 18px 14px 14px;
  background: var(--color-card); border-right: 1px solid var(--color-border); transition: width 0.2s ease; z-index: 30;
}
.is-collapsed .sidebar { width: var(--sidebar-collapsed-width); padding-inline: 12px; }
.brand { display: flex; align-items: center; height: 44px; padding-left: 6px; margin-bottom: 14px; }
.is-collapsed .brand { justify-content: center; padding-left: 0; }

.nav { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.nav-label { margin: 14px 10px 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-text-tertiary); }
.nav-sep { height: 1px; margin: 10px 8px; background: var(--color-divider); }
.nav-item {
  display: flex; align-items: center; gap: 12px; width: 100%; height: 42px; padding: 0 12px; border: 0; border-radius: var(--radius-md);
  background: transparent; color: var(--color-text-secondary); font-size: 14px; font-weight: 600; cursor: pointer; transition: var(--transition);
}
.nav-item:hover { background: var(--color-bg-secondary); color: var(--color-text-primary); }
.nav-item.is-active { background: var(--color-primary-soft); color: var(--color-primary-dark); }
.is-collapsed .nav-item { justify-content: center; padding: 0; }
.is-collapsed .nav-text, .is-collapsed .chevron { display: none; }
.nav-text { flex: 1; text-align: left; white-space: nowrap; }
.chevron { font-size: 12px; transition: transform 0.2s ease; }
.chevron.is-open { transform: rotate(180deg); }

.nav-sub { display: flex; flex-direction: column; gap: 2px; margin: 2px 0 6px 28px; padding-left: 12px; border-left: 1.5px solid var(--color-divider); }
.nav-sub-item { height: 36px; display: flex; align-items: center; padding: 0 12px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; color: var(--color-text-secondary); }
.nav-sub-item:hover { color: var(--color-text-primary); background: var(--color-bg-secondary); }
.nav-sub-item.is-active { color: var(--color-primary-dark); background: var(--color-primary-soft); }

.sidebar-foot { margin: 10px 8px 0; padding-top: 12px; border-top: 1px solid var(--color-divider); font-size: 12px; line-height: 1.7; color: var(--color-text-tertiary); }

/* ===== 主区 ===== */
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.topbar {
  height: var(--header-height); flex-shrink: 0; display: flex; align-items: center; gap: 12px; padding: 0 20px;
  background: color-mix(in srgb, var(--color-background) 92%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--color-divider);
}
.icon-btn { width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--color-text-secondary); cursor: pointer; }
.icon-btn:hover { background: var(--color-bg-secondary); }
.page-name { font-size: 16px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.topbar-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }

.balance {
  display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 6px 0 14px; border: 1px solid var(--color-primary-line);
  border-radius: 999px; background: var(--color-primary-soft); color: var(--color-primary-dark); font-weight: 700; cursor: pointer; transition: var(--transition);
}
.balance:hover { border-color: var(--color-primary); }
.balance .plus { padding: 4px 12px; border-radius: 999px; background: var(--color-primary); color: #fff; font-size: 12px; }
.user { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 8px; border: 0; border-radius: 999px; background: transparent; cursor: pointer; color: var(--color-text-primary); }
.user:hover { background: var(--color-bg-secondary); }
.user-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; }

.content { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
/* 新旧页面同时过渡（不再 out-in 先等旧页面淡出）：点击后新页面立刻开始出现 */
.content { position: relative; }
.page-enter-active { transition: opacity 0.15s ease; }
.page-leave-active { position: absolute; inset: 0; transition: opacity 0.1s ease; pointer-events: none; }
.page-enter-from, .page-leave-to { opacity: 0; }

/* 顶部进度条：路由切换（含懒加载页面代码）期间显示，点击后立刻有反馈，不再是"卡住" */
.nav-progress { position: fixed; left: 0; top: 0; height: 2px; width: 100%; z-index: 3000; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-light)); transform-origin: left; animation: nav-progress 8s cubic-bezier(0.1, 0.6, 0.2, 1) forwards; }
@keyframes nav-progress { from { transform: scaleX(0.02); } to { transform: scaleX(0.92); } }

/* ===== 窄屏：侧栏变抽屉 ===== */
.scrim { display: none; }
@media (max-width: 860px) {
  .shell { height: 100dvh; }
  .sidebar { position: fixed; inset: 0 auto 0 0; transform: translateX(-100%); transition: transform 0.2s ease; box-shadow: var(--shadow-lg); width: var(--sidebar-width) !important; padding-inline: 14px !important; }
  .is-mobile-open .sidebar { transform: none; }
  .is-mobile-open .scrim { display: block; position: fixed; inset: 0; background: var(--color-overlay); z-index: 20; }
  .is-collapsed .nav-text { display: block; }
  .user-name, .balance .plus { display: none; }
  .topbar { gap: 6px; padding: 0 8px; }
  .icon-btn { flex-shrink: 0; }
  .topbar-right { flex-shrink: 0; gap: 4px; }
  .user { min-width: 44px; height: 44px; gap: 3px; padding-inline: 5px; }
  .balance { max-width: min(40vw, 180px); gap: 4px; padding-inline: 8px; white-space: nowrap; }
  .balance .el-icon { flex-shrink: 0; }
  .balance .lm-money { overflow: hidden; text-overflow: ellipsis; }
}
</style>

<style>
/* 收起侧栏时弹出的二级菜单挂在 body 上，scoped 样式够不到 */
.nav-popper-active { color: var(--color-primary-dark); font-weight: 700; }
@media (max-width: 860px) {
  .avatar-menu.el-popper { border-radius: var(--radius-md); }
  .avatar-menu .el-dropdown-menu {
    width: max-content; max-width: calc(100vw - 24px); max-height: min(65dvh, 460px);
    padding: 5px; overflow-y: auto; overscroll-behavior: contain;
  }
  .avatar-menu .el-dropdown-menu__item {
    min-height: 44px; gap: 10px; padding: 6px 10px; border-radius: var(--radius-sm);
  }
  .avatar-menu .el-dropdown-menu__item > .el-icon { margin: 0; }
  .avatar-menu .el-dropdown-menu__item[aria-current="page"] {
    background: var(--color-primary-soft); color: var(--color-primary-dark); font-weight: 700;
  }
  .avatar-menu .el-dropdown-menu__item--divided { margin: 4px; border-color: var(--color-divider); }
  .avatar-menu .avatar-logout { color: var(--color-error); }
}
</style>
