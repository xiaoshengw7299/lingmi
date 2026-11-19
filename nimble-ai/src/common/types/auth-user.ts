/** JWT 鉴权后注入 request.user / socket.data.user 的结构 */
export interface AuthUser {
  userId: number;
  loginName: string | null;
  nickname?: string | null;
  isAdmin: boolean;
}

/** 显示名：优先昵称，否则登录账号 */
export function displayName(user: Pick<AuthUser, 'loginName' | 'nickname'>): string {
  return user.nickname?.trim() || user.loginName || '用户';
}
