import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { USAGE_RANGES, UsageRange } from '../billing/bill.service';
import { StatsService } from './stats.service';

class StatsQueryDto {
  @IsOptional()
  @IsIn(Object.keys(USAGE_RANGES))
  range?: UsageRange;
}

@Controller('admin/stats')
@UseGuards(PlatformAdminGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  overview(@Query() query: StatsQueryDto) {
    return this.stats.overview(query.range ?? '7d');
  }
}
