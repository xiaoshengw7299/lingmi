import { Body, Controller, Get, Header, Put, UseGuards } from '@nestjs/common';
import { IsBoolean, IsISO8601, Matches, ValidateIf } from 'class-validator';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { ShortVideoPricingService, type ShortVideoPromotion } from './short-video-pricing.service';

const EXPLICIT_TIME_ZONE = /(?:Z|[+-]\d{2}:\d{2})$/;

class ShortVideoPromotionDto implements ShortVideoPromotion {
  @IsBoolean()
  enabled: boolean;

  @ValidateIf((_, value) => value !== null)
  @IsISO8601({ strict: true, strictSeparator: true }, { message: '开始时间格式无效' })
  @Matches(EXPLICIT_TIME_ZONE, { message: '开始时间须包含时区' })
  startsAt: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsISO8601({ strict: true, strictSeparator: true }, { message: '结束时间格式无效' })
  @Matches(EXPLICIT_TIME_ZONE, { message: '结束时间须包含时区' })
  endsAt: string | null;
}

@Controller('admin/config/short-video-promotion')
@UseGuards(PlatformAdminGuard)
export class ShortVideoAdminController {
  constructor(private readonly pricing: ShortVideoPricingService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  getPromotion() {
    return this.pricing.getPromotion();
  }

  @Put()
  savePromotion(@Body() dto: ShortVideoPromotionDto) {
    return this.pricing.savePromotion(dto);
  }
}
