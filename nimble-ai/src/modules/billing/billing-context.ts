import { AsyncLocalStorage } from 'async_hooks';

/**
 * 计费上下文：当前这条调用链是替哪个用户花钱。
 *
 * HTTP 请求由 BillingContextInterceptor 自动带上；队列任务在入队时用 billingJob() 把用户写进任务数据，
 * Worker 里再用 runWithBilling 还原。这样 Atlas 客户端和文本模型中间件不用把 userId 一层层传下去。
 */
const store = new AsyncLocalStorage<{ userId: string; waived?: boolean }>();

export function runWithBilling<T>(
  userId: number | string | undefined | null,
  fn: () => T,
  options?: { waived: boolean },
): T {
  return userId == null || userId === '' ? fn() : store.run({ userId: String(userId), waived: options?.waived }, fn);
}

export function currentBillingUser(): string | undefined {
  return store.getStore()?.userId;
}

export function isBillingWaived(userId?: number | string): boolean {
  const context = store.getStore();
  return !!context?.waived && (userId === undefined || context.userId === String(userId));
}

/** 入队时把计费用户写进任务数据，Worker 取出后用 runWithBilling 还原上下文 */
export interface BillingJobData {
  userId?: string;
}

export const billingJob = (): BillingJobData => ({ userId: currentBillingUser() });
