import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('@/views/LoginView.vue') },
    {
      path: '/',
      component: () => import('@/layouts/AdminLayout.vue'),
      children: [
        { path: '', redirect: '/dashboard' },
        { path: 'dashboard', meta: { perm: 'dashboard:view', title: '工作台' }, component: () => import('@/views/DashboardView.vue') },
        { path: 'wallets', meta: { perm: 'wallet:view', title: '用户余额' }, component: () => import('@/views/WalletsView.vue') },
        { path: 'orders', meta: { perm: 'order:view', title: '充值订单' }, component: () => import('@/views/OrdersView.vue') },
        { path: 'refunds', meta: { perm: 'refund:view', title: '退款' }, component: () => import('@/views/RefundsView.vue') },
        { path: 'transfers', meta: { perm: 'transfer:view', title: '转账' }, component: () => import('@/views/TransfersView.vue') },
        { path: 'division', meta: { perm: 'division:view', title: '分账' }, component: () => import('@/views/DivisionView.vue') },
        { path: 'recon', meta: { perm: 'recon:view', title: '对账' }, component: () => import('@/views/ReconView.vue') },
        { path: 'alipay', meta: { perm: 'alipay:view', title: '支付宝' }, component: () => import('@/views/AlipayView.vue') },
        { path: 'iam', meta: { perm: 'iam:view', title: '管理员' }, component: () => import('@/views/IamView.vue') },
        { path: 'audit', meta: { perm: 'audit:view', title: '审计' }, component: () => import('@/views/AuditView.vue') },
      ],
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (to.path === '/login') return true;
  if (!localStorage.getItem('np_access')) return '/login';
  if (!auth.user) {
    try {
      await auth.loadProfile();
    } catch {
      auth.logout();
      return '/login';
    }
  }
  const perm = to.meta.perm as string | undefined;
  if (perm && !auth.can(perm)) return '/dashboard';
  return true;
});

export default router;
