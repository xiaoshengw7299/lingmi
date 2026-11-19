import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Put, UseGuards } from '@nestjs/common';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { PriceBoardService, toPublicRow } from './price-board.service';
import { PricingService } from './pricing.service';

class SettingsDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.1)
  @Max(10)
  markup?: number | null;
}

class ModelRuleDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.1)
  @Max(10)
  markup?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  officialUnitCny?: number | null;

  /** 视频售价系数。1 为官方价，0.8 为八折 */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.05)
  @Max(3)
  discount?: number | null;
}

/** 对外价目表：只暴露用户价和官方价，不暴露成本与加价 */
@Controller('pricing')
export class PricingController {
  constructor(private readonly board: PriceBoardService) {}

  @Public()
  @Get('models')
  async models() {
    const rows = await this.board.rows();
    return { currency: 'CNY', rows: rows.filter((row) => row.price != null).map(toPublicRow) };
  }
}

@Controller('admin/pricing')
@UseGuards(PlatformAdminGuard)
export class AdminPricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly board: PriceBoardService,
  ) {}

  @Get()
  async overview() {
    return { settings: await this.pricing.settings(), rows: await this.board.rows() };
  }

  @Put('settings')
  async saveSettings(@Body() dto: SettingsDto) {
    return this.pricing.saveSettings(dto);
  }

  @Put('models/:id')
  async saveModel(@Param('id') id: string, @Body() dto: ModelRuleDto) {
    const row = (await this.board.rows()).find((r) => r.id === id);
    if (!row) throw new NotFoundException('模型不存在');
    if (row.pricingMode === 'video') {
      if (dto.discount != null) {
        try {
          await this.board.assertVideoDiscount(row.id, dto.discount);
        } catch (error) {
          throw new BadRequestException(error instanceof Error ? error.message : '售价不能低于成本，请提高售价系数');
        }
      }
      if (dto.discount !== undefined) await this.pricing.saveModelRules(row.atlasModels, { discount: dto.discount });
      // 手填官方价只改价目上展示的这一档，其它清晰度仍按各自官方价计算
      if (dto.officialUnitCny !== undefined && row.atlasModels[0]) {
        await this.pricing.saveModelRules([row.atlasModels[0]], { officialUnitCny: dto.officialUnitCny });
      }
    } else {
      await this.pricing.saveModelRules(row.atlasModels, dto);
    }
    return (await this.board.rows()).find((r) => r.id === id);
  }

  /** 重新取汇率，并向 Atlas 逐个询价后写入数据库。这是唯一会请求 Atlas 报价的入口 */
  @Post('refresh')
  async refresh() {
    await this.pricing.refreshExchangeRate();
    const failed = await this.board.refreshFromAtlas();
    return { settings: await this.pricing.settings(), rows: await this.board.rows(), failed };
  }
}
