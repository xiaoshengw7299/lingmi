import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * 单个视频示例被他人复制的次数，以及这个作品已经发到哪一档。
 * 每个作品单独计算，不和同一作者的其他作品加在一起。
 * 删掉示例不会把已发的奖励追回；作者自己复制不加这里。
 */
@Entity('video_example_reward', { comment: '单个视频示例的分享复制奖励' })
export class ExampleShareReward {
  @PrimaryColumn({ name: 'example_id', type: 'uuid', comment: '视频示例 ID' })
  exampleId: string;

  /** 当前作者。再次分享同一作品时更新，已发过的档位不重复发 */
  @Column({ name: 'user_id', type: 'int', comment: '作者账号 ID' })
  userId: number;

  @Column({ name: 'qualified_copies', type: 'int', default: 0, comment: '他人有效复制次数，只增不减' })
  qualifiedCopies: number;

  /** 已入账的最高档：0 / 15 / 30 / 100 */
  @Column({ name: 'rewarded_copies', type: 'int', default: 0, comment: '已发放奖励的档位（复制次数）' })
  rewardedCopies: number;
}
