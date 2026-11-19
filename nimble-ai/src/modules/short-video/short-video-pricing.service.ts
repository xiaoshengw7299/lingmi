import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { runWithBilling } from '../billing/billing-context';
import { BillingService } from '../billing/billing.service';
import { PIPELINE_MIN_BALANCE_CENTS } from '../billing/require-balance';
import { SystemConfigService } from '../system-config/system-config.service';

export const SHORT_VIDEO_PRICE_MODES = ['promotion', 'metered', 'disabled'] as const;
export type ShortVideoPriceMode = (typeof SHORT_VIDEO_PRICE_MODES)[number];

export interface ShortVideoBilling {
  mode: ShortVideoPriceMode;
  acceptedAt: string;
  chargeCents: number | null;
}

export interface ShortVideoPromotion {
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

const PROMOTION_KEY = 'short_video_promotion';

@Injectable()
export class ShortVideoPricingService {
  constructor(
    private readonly config: SystemConfigService,
    private readonly billing: BillingService,
  ) {}

  async getPromotion(): Promise<ShortVideoPromotion> {
    return (await this.config.get<ShortVideoPromotion>(PROMOTION_KEY)) ?? {
      enabled: false,
      startsAt: null,
      endsAt: null,
    };
  }

  async savePromotion(input: ShortVideoPromotion): Promise<ShortVideoPromotion> {
    const start = input.startsAt === null ? null : Date.parse(input.startsAt);
    const end = input.endsAt === null ? null : Date.parse(input.endsAt);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      throw new BadRequestException('活动时间格式无效');
    }
    if (input.enabled && (start === null || end === null)) {
      throw new BadRequestException('启用活动须填写开始时间和结束时间');
    }
    if (start !== null && end !== null && end <= start) {
      throw new BadRequestException('结束时间须晚于开始时间');
    }
    const promotion = {
      enabled: input.enabled,
      startsAt: start === null ? null : new Date(start).toISOString(),
      endsAt: end === null ? null : new Date(end).toISOString(),
    };
    await this.config.set(PROMOTION_KEY, promotion);
    return promotion;
  }

  async quote(now?: number) {
    const promotion = await this.getPromotion();
    const at = now ?? Date.now();
    const start = Date.parse(promotion.startsAt ?? '');
    const end = Date.parse(promotion.endsAt ?? '');
    const enabled = promotion.enabled && start < end;
    const mode: ShortVideoPriceMode = enabled && start <= at && at < end
      ? 'promotion'
      : this.billing.enabled() ? 'metered' : 'disabled';
    return {
      mode,
      chargeCents: mode === 'metered' ? null : 0,
      minBalanceCents: mode === 'metered' ? PIPELINE_MIN_BALANCE_CENTS : 0,
      serverTime: new Date(at).toISOString(),
      startsAt: enabled ? promotion.startsAt : null,
      endsAt: enabled ? promotion.endsAt : null,
    };
  }

  async accept(userId: string, expected: ShortVideoPriceMode | undefined, minBalanceCents: number): Promise<ShortVideoBilling> {
    const quote = await this.quote();
    if (expected && expected !== quote.mode && (expected === 'promotion' || quote.mode === 'metered')) {
      throw new ConflictException({ message: '价格已更新，请确认后继续', data: { shortVideoQuote: quote } });
    }
    if (quote.mode === 'metered' && minBalanceCents > 0) {
      await this.billing.assertCanSpend(userId, minBalanceCents);
    }
    return { mode: quote.mode, acceptedAt: quote.serverTime, chargeCents: quote.chargeCents };
  }

  async runPreview<T>(userId: string, expected: ShortVideoPriceMode | undefined, minBalanceCents: number, run: () => Promise<T>) {
    const billing = await this.accept(userId, expected, minBalanceCents);
    return runWithBilling(userId, run, { waived: billing.mode !== 'metered' });
  }
}
