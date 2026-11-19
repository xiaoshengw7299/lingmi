import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserService } from './user.service';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { Status } from '../../common/enums';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { Type } from 'class-transformer';

class QueryAccountDto {
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

  @IsOptional()
  @IsString()
  keyword?: string;
}

class UpdateStatusDto {
  @IsIn([Status.Disabled, Status.Enabled])
  status: Status;
}

class UpdateAdminDto {
  @IsBoolean()
  isAdmin: boolean;
}

class UpdateDistributorDto {
  @IsBoolean()
  isDistributor: boolean;

  /** 佣金比例（%），不传沿用原值 */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionPercent?: number;
}

@Controller('admin/users')
@UseGuards(PlatformAdminGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  findPage(@Query() dto: QueryAccountDto) {
    return this.userService.findPage(dto.page || 1, dto.pageSize || 20, dto.keyword);
  }

  @Get(':id')
  async overview(@Param('id', ParseIntPipe) id: number) {
    const data = await this.userService.overview(id);
    if (!data) throw new NotFoundException('用户不存在');
    return data;
  }

  @Get(':id/ledgers')
  ledgers(@Param('id', ParseIntPipe) id: number, @Query() dto: QueryAccountDto) {
    return this.userService.ledgers(id, dto.page || 1, dto.pageSize || 20);
  }

  /** 指定 / 取消管理员：只有默认管理员可以，其他管理员的其余权限和它一致 */
  @Patch(':id/admin')
  @UseGuards(SuperAdminGuard)
  async setAdmin(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAdminDto) {
    const user = await this.userService.setAdmin(id, dto.isAdmin);
    if (!user) throw new NotFoundException('用户不存在');
    return user;
  }

  /** 任命 / 取消分销商、调整佣金比例：只有默认管理员可以 */
  @Patch(':id/distributor')
  @UseGuards(SuperAdminGuard)
  async setDistributor(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDistributorDto) {
    const user = await this.userService.setDistributor(id, dto.isDistributor, dto.commissionPercent);
    if (!user) throw new NotFoundException('用户不存在');
    return user;
  }

  @Patch(':id/status')
  async setStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStatusDto) {
    const user = await this.userService.setStatus(id, dto.status);
    if (!user) throw new NotFoundException('用户不存在');
    return user;
  }
}
