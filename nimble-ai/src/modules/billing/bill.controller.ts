import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import * as dayjs from 'dayjs';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { BillService } from './bill.service';
import { UsageKind } from './entities/usage-log.entity';

class BillQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  userId?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  distributorId?: number;

  @IsOptional()
  @IsIn(['image', 'video', 'audio', 'llm', 'tool'])
  kind?: UsageKind;

  /** YYYY-MM-DD，含当天 */
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

/** 全平台消费账单：每笔扣费的实付、上游成本和利润 */
@Controller('admin/bills')
@UseGuards(PlatformAdminGuard)
export class BillController {
  constructor(private readonly bills: BillService) {}

  @Get()
  list(@Query() q: BillQueryDto) {
    const { page = 1, pageSize = 20, from, to, ...filter } = q;
    return this.bills.list(
      {
        ...filter,
        since: from ? dayjs(from).startOf('day').toDate() : undefined,
        until: to ? dayjs(to).endOf('day').toDate() : undefined,
      },
      page,
      pageSize,
    );
  }
}
