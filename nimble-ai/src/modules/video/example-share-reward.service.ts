import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PayClientService } from '../pay/pay-client.service';
import { ExampleShareReward } from './entities/example-share-reward.entity';

/** 单个作品的有效复制次数跨过这些档位时各发一次，金额是追加而不是累计应得 */
const TIERS = [
  { copies: 15, cents: 1500 },
  { copies: 30, cents: 5000 },
  { copies: 100, cents: 20000 },
] as const;

/**
 * 视频示例的分享奖励。每个作品单独计次、单独发奖，同一作者的多个作品互不影响。
 * 支付用「作品 + 档位」做业务号，失败下次再试也不会重复发。
 */
@Injectable()
export class ExampleShareRewardService {
  private readonly logger = new Logger(ExampleShareRewardService.name);

  constructor(
    @InjectRepository(ExampleShareReward) private readonly rewards: Repository<ExampleShareReward>,
    private readonly pay: PayClientService,
  ) {}

  /** 这个作品一次算数的复制。调用方已经排除了作者本人 */
  async onQualifiedCopy(exampleId: string, authorId: string) {
    const userId = Number(authorId);
    if (!exampleId || !Number.isInteger(userId) || userId <= 0) return;
    const copies = await this.bump(exampleId, userId);
    await this.settle(exampleId, userId, copies);
  }

  /** 工作台展示这个作品的进度。有未入账的档位时顺手再试一次 */
  async status(exampleId: string) {
    const row = await this.rewards.findOne({ where: { exampleId } });
    const copies = row?.qualifiedCopies ?? 0;
    const rewarded = row?.rewardedCopies ?? 0;
    const pending = !!row && TIERS.some((tier) => copies >= tier.copies && rewarded < tier.copies);
    if (!pending) return this.present(copies, rewarded);
    await this.settle(exampleId, row.userId, copies);
    const fresh = await this.rewards.findOne({ where: { exampleId } });
    return this.present(fresh?.qualifiedCopies ?? copies, fresh?.rewardedCopies ?? rewarded);
  }

  private present(qualifiedCopies: number, rewardedCopies: number) {
    const tiers = TIERS.map((tier) => ({
      copies: tier.copies,
      rewardCents: tier.cents,
      paid: rewardedCopies >= tier.copies,
    }));
    const next = tiers.find((tier) => !tier.paid) ?? null;
    const earnedCents = tiers.reduce((sum, tier) => sum + (tier.paid ? tier.rewardCents : 0), 0);
    return {
      qualifiedCopies,
      earnedCents,
      tiers,
      next: next ? { copies: next.copies, rewardCents: next.rewardCents } : null,
    };
  }

  private async bump(exampleId: string, userId: number): Promise<number> {
    const rows = await this.rewards.query(
      `INSERT INTO "video_example_reward" ("example_id", "user_id", "qualified_copies", "rewarded_copies")
       VALUES ($1, $2, 1, 0)
       ON CONFLICT ("example_id")
       DO UPDATE SET "qualified_copies" = "video_example_reward"."qualified_copies" + 1,
                     "user_id" = EXCLUDED."user_id"
       RETURNING "qualified_copies"`,
      [exampleId, userId],
    );
    return Number(rows?.[0]?.qualified_copies ?? 0);
  }

  /** 按档位顺序入账。支付失败就停在这一档，次数已经记下，下次再发 */
  private async settle(exampleId: string, userId: number, copies: number) {
    if (!this.pay.enabled() || copies < TIERS[0].copies) return;
    const row = await this.rewards.findOne({ where: { exampleId } });
    let granted = row?.rewardedCopies ?? 0;
    for (const tier of TIERS) {
      if (copies < tier.copies || granted >= tier.copies) continue;
      try {
        await this.pay.grant({
          externalUserId: String(userId),
          amountCents: tier.cents,
          bizNo: `share:${exampleId}:${tier.copies}`,
          remark: `作品被他人复制满 ${tier.copies} 次奖励`,
        });
      } catch (error) {
        this.logger.warn(`分享奖励入账失败 example=${exampleId} tier=${tier.copies}：${error instanceof Error ? error.message : error}`);
        return;
      }
      await this.rewards
        .createQueryBuilder()
        .update(ExampleShareReward)
        .set({ rewardedCopies: tier.copies })
        .where('example_id = :exampleId AND rewarded_copies < :copies', { exampleId, copies: tier.copies })
        .execute();
      granted = tier.copies;
    }
  }
}
