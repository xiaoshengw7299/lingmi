type TagType = 'success' | 'warning' | 'danger' | 'info' | 'primary'

/** 余额流水类型的展示文案和标签颜色，用户钱包页和管理员的用户详情共用 */
export const LEDGER_TYPES: Record<string, { label: string; tag: TagType }> = {
  RECHARGE: { label: '充值', tag: 'success' },
  CONSUME: { label: '消费', tag: 'info' },
  CONSUME_REFUND: { label: '失败退回', tag: 'primary' },
  REFERRAL_REWARD: { label: '邀请奖励', tag: 'warning' },
  SIGNUP_GIFT: { label: '新用户赠送', tag: 'warning' },
  SHARE_REWARD: { label: '分享奖励', tag: 'warning' },
  ADMIN_GRANT: { label: '平台加款', tag: 'success' },
  ADMIN_REVOKE: { label: '平台扣款', tag: 'danger' },
  REFUND_DEDUCT: { label: '退款扣除', tag: 'danger' },
  REFUND_RESTORE: { label: '退款回退', tag: 'primary' },
}
