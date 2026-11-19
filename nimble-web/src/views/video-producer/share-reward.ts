import type { ShareRewardStatus } from '@/api/video'
import { SHARE_REWARD_BRIEF, SHARE_REWARD_RULE } from '../../content/share-reward'

export { SHARE_REWARD_BRIEF, SHARE_REWARD_RULE }

/** 工作台标题下的一行进度，说的是当前这一个作品 */
export function shareRewardLine(status: ShareRewardStatus | null): string {
  if (!status) return SHARE_REWARD_BRIEF
  const { qualifiedCopies, next } = status
  if (!next) return qualifiedCopies > 0 ? `这个作品的分享奖励已全部到账。他人已复制 ${qualifiedCopies} 次` : SHARE_REWARD_BRIEF
  if (qualifiedCopies >= next.copies) return `这个作品已达成 ${next.copies} 次复制，¥${next.rewardCents / 100} 奖励入账中`
  if (qualifiedCopies > 0) {
    return `这个作品已被他人复制 ${qualifiedCopies} 次，再 ${next.copies - qualifiedCopies} 次奖励 ¥${next.rewardCents / 100}`
  }
  return SHARE_REWARD_BRIEF
}
