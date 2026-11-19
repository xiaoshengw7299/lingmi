import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsIn, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { Request } from 'express';
import { RequirePerm } from '../../common/decorators/auth';
import { CurrentAdmin } from '../../common/decorators/current-user';
import { PERMS } from '../../common/constants';
import { yuanToCents } from '../../common/money';
import { PageQueryDto } from '../../common/dto/page.dto';
import { AdminAuthGuard } from '../../common/guards/auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { shanghaiDayStart, shanghaiYmd } from '../../common/time';
import { AuditLog, PayOrder, ReconItem, WalletUser } from '../../entities';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Not, Repository } from 'typeorm';
import { WalletService } from '../wallet/wallet.service';
import { PaymentService } from '../payment/payment.service';
import { RefundService } from '../refund/refund.service';
import { TransferService } from '../transfer/transfer.service';
import { DivisionService } from '../division/division.service';
import { ReconService } from '../recon/recon.service';
import { ChannelConfigService } from '../channel-config/channel-config.service';
import { IamService } from '../iam/iam.service';

class LoginDto {
  @IsString() username: string;
  @IsString() password: string;
}
class RefreshDto {
  @IsString() refreshToken: string;
}
class KeywordQuery extends PageQueryDto {
  @IsOptional() @IsString() keyword?: string;
  @IsOptional() @IsString() status?: string;
}
/** 后台接口里的金额一律是元（最多两位小数），由服务端换算成分 */
class AdjustDto {
  @Type(() => String) @IsString() amount: string;
  @IsIn(['grant', 'revoke']) direction: 'grant' | 'revoke';
  @IsOptional() @IsString() remark?: string;
}
class StatusDto {
  @IsIn(['ACTIVE', 'DISABLED']) status: string;
  @IsOptional() @IsString() remark?: string;
}
class RefundDto {
  @IsString() orderNo: string;
  /** 不传 = 退剩余全额 */
  @IsOptional() @Type(() => String) @IsString() amount?: string;
  @IsOptional() @IsString() reason?: string;
}
class TransferDto {
  @Type(() => String) @IsString() amount: string;
  @IsString() accountNo: string;
  @IsString() accountName: string;
  @IsOptional() @IsString() identityType?: string;
  @IsOptional() @IsString() orderTitle?: string;
  @IsString() @MinLength(1) remark: string;
}
class ReceiverDto {
  @IsString() name: string;
  @IsString() accountNo: string;
  @IsString() accountName: string;
  @Type(() => Number) @IsInt() ratioBps: number;
  @IsOptional() @IsString() remark?: string;
}
class ReconRunDto {
  @IsString() billDate: string;
  @IsOptional() @IsString() endDate?: string;
}
class SettingDto {
  @IsString() key: string;
  @IsString() value: string;
}
class UserDto {
  @IsString() username: string;
  @IsString() @MinLength(6) password: string;
  @IsOptional() @IsString() realName?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) roleIds?: string[];
}
class UpdateUserDto {
  @IsOptional() @IsString() realName?: string;
  @IsOptional() @IsString() @MinLength(6) password?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) roleIds?: string[];
  @IsOptional() @IsIn(['ACTIVE', 'DISABLED']) status?: string;
}
class RoleDto {
  @IsOptional() @IsString() id?: string;
  @IsString() code: string;
  @IsString() name: string;
  @IsOptional() @IsString() remark?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) permissionIds?: string[];
}

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly iam: IamService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.iam.login(dto.username, dto.password);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.iam.refresh(dto.refreshToken);
  }

  @Get('profile')
  @UseGuards(AdminAuthGuard)
  profile(@CurrentAdmin() admin: Express.Request['admin']) {
    return this.iam.profile(admin!.id);
  }
}

@Controller('admin/dashboard')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class DashboardController {
  constructor(
    @InjectRepository(WalletUser) private readonly users: Repository<WalletUser>,
    @InjectRepository(PayOrder) private readonly orders: Repository<PayOrder>,
    @InjectRepository(ReconItem) private readonly recon: Repository<ReconItem>,
  ) {}

  @Get('stats')
  @RequirePerm(PERMS.DASHBOARD_VIEW)
  async stats() {
    const start = shanghaiDayStart();
    const [walletTotal, balance, todayOrders, todayPaid, paying, recent, reconOpenDiffs] = await Promise.all([
      this.users.count(),
      this.users.createQueryBuilder('u').select('COALESCE(SUM(u.balanceCents),0)', 'sum').getRawOne<{ sum: string }>(),
      this.orders.count({ where: { createdAt: MoreThanOrEqual(start), status: Not('CLOSED') } }),
      this.orders
        .createQueryBuilder('o')
        .select('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(o.amountCents),0)', 'sum')
        .where('o.status IN (:...st) AND o.paidAt >= :start AND o.testPay = false', { st: ['SUCCESS', 'REFUNDED'], start })
        .getRawOne<{ count: string; sum: string }>(),
      this.orders.count({ where: { status: 'PAYING' } }),
      this.orders.find({ where: { status: Not('CLOSED') }, take: 8, order: { createdAt: 'DESC' }, relations: { user: true } }),
      this.recon
        .createQueryBuilder('i')
        .innerJoin('i.batch', 'b')
        .where('b.billDate = :d AND i.diffType <> :m AND i.handleStatus = :h', { d: shanghaiYmd(-1), m: 'MATCHED', h: 'OPEN' })
        .getCount(),
    ]);
    return {
      walletTotal,
      balanceCents: Number(balance?.sum || 0),
      todayOrders,
      todayPaidCount: Number(todayPaid?.count || 0),
      todayPaidCents: Number(todayPaid?.sum || 0),
      paying,
      recent,
      reconOpenDiffs,
    };
  }
}

@Controller('admin/wallets')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class WalletAdminController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @RequirePerm(PERMS.WALLET_VIEW)
  page(@Query() q: KeywordQuery) {
    return this.wallet.page(q);
  }

  @Get(':id')
  @RequirePerm(PERMS.WALLET_VIEW)
  detail(@Param('id') id: string) {
    return this.wallet.detail(id);
  }

  @Patch(':id')
  @RequirePerm(PERMS.WALLET_EDIT)
  status(@Param('id') id: string, @Body() dto: StatusDto) {
    return this.wallet.setStatus(id, dto.status, dto.remark);
  }

  @Post(':id/adjust')
  @RequirePerm(PERMS.WALLET_EDIT)
  adjust(@Param('id') id: string, @Body() dto: AdjustDto) {
    return this.wallet.adjust(id, yuanToCents(dto.amount), dto.direction, dto.remark || '');
  }
}

@Controller('admin/orders')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class OrderAdminController {
  constructor(private readonly payment: PaymentService) {}

  @Get()
  @RequirePerm(PERMS.ORDER_VIEW)
  page(@Query() q: KeywordQuery) {
    return this.payment.page(q);
  }

  @Get(':orderNo')
  @RequirePerm(PERMS.ORDER_VIEW)
  one(@Param('orderNo') orderNo: string) {
    return this.payment.getByNo(orderNo);
  }

  @Post(':orderNo/sync')
  @RequirePerm(PERMS.ORDER_OPERATE)
  sync(@Param('orderNo') orderNo: string) {
    return this.payment.syncFromChannel(orderNo);
  }

  @Post(':orderNo/close')
  @RequirePerm(PERMS.ORDER_OPERATE)
  close(@Param('orderNo') orderNo: string) {
    return this.payment.close(orderNo);
  }
}

@Controller('admin/refunds')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class RefundAdminController {
  constructor(private readonly refunds: RefundService) {}

  @Get()
  @RequirePerm(PERMS.REFUND_VIEW)
  page(@Query() q: KeywordQuery) {
    return this.refunds.page(q);
  }

  @Post()
  @RequirePerm(PERMS.REFUND_CREATE)
  create(@Body() dto: RefundDto, @CurrentAdmin() admin: Express.Request['admin']) {
    const amountCents = dto.amount?.trim() ? yuanToCents(dto.amount) : undefined;
    return this.refunds.create({ orderNo: dto.orderNo, amountCents, reason: dto.reason || '充值退款', operatorId: admin!.id });
  }

  @Post(':refundNo/sync')
  @RequirePerm(PERMS.REFUND_CREATE)
  sync(@Param('refundNo') refundNo: string) {
    return this.refunds.sync(refundNo);
  }
}

@Controller('admin/transfers')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class TransferAdminController {
  constructor(private readonly transfers: TransferService) {}

  @Get()
  @RequirePerm(PERMS.TRANSFER_VIEW)
  page(@Query() q: KeywordQuery) {
    return this.transfers.page(q);
  }

  @Post()
  @RequirePerm(PERMS.TRANSFER_CREATE)
  create(@Body() dto: TransferDto, @CurrentAdmin() admin: Express.Request['admin']) {
    const { amount, ...rest } = dto;
    return this.transfers.create({ ...rest, amountCents: yuanToCents(amount), operatorId: admin!.id });
  }

  @Post(':transferNo/sync')
  @RequirePerm(PERMS.TRANSFER_CREATE)
  sync(@Param('transferNo') transferNo: string) {
    return this.transfers.sync(transferNo);
  }
}

@Controller('admin/division')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class DivisionAdminController {
  constructor(private readonly division: DivisionService) {}

  @Get('receivers')
  @RequirePerm(PERMS.DIVISION_VIEW)
  receivers() {
    return this.division.pageReceivers();
  }

  @Post('receivers')
  @RequirePerm(PERMS.DIVISION_EDIT)
  create(@Body() dto: ReceiverDto) {
    return this.division.createReceiver(dto);
  }

  @Patch('receivers/:id')
  @RequirePerm(PERMS.DIVISION_EDIT)
  patch(@Param('id') id: string, @Body() dto: Partial<ReceiverDto> & { enabled?: boolean }) {
    return this.division.updateReceiver(id, dto);
  }

  @Post('receivers/:id/bind')
  @RequirePerm(PERMS.DIVISION_EDIT)
  bind(@Param('id') id: string) {
    return this.division.bind(id);
  }

  @Post('receivers/:id/unbind')
  @RequirePerm(PERMS.DIVISION_EDIT)
  unbind(@Param('id') id: string) {
    return this.division.unbind(id);
  }

  @Get('records')
  @RequirePerm(PERMS.DIVISION_VIEW)
  records(@Query() q: KeywordQuery) {
    return this.division.pageRecords(q);
  }

  @Post('exec')
  @RequirePerm(PERMS.DIVISION_EXEC)
  exec(@Body() body: { orderNo: string }) {
    return this.division.execByOrderNo(body.orderNo);
  }

  @Post('query')
  @RequirePerm(PERMS.DIVISION_VIEW)
  query(@Body() body: { batchNo: string }) {
    return this.division.queryBatch(body.batchNo);
  }
}

@Controller('admin/recon')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class ReconAdminController {
  constructor(private readonly recon: ReconService) {}

  @Get('batches')
  @RequirePerm(PERMS.RECON_VIEW)
  batches(@Query() q: PageQueryDto & { startDate?: string; endDate?: string }) {
    return this.recon.pageBatches(q);
  }

  @Get('items')
  @RequirePerm(PERMS.RECON_VIEW)
  items(@Query() q: PageQueryDto & { batchId: string; diffType?: string; onlyDiffs?: boolean }) {
    return this.recon.pageItems(q);
  }

  @Get('summary')
  @RequirePerm(PERMS.RECON_VIEW)
  summary(@Query('billDate') billDate?: string) {
    return this.recon.summary(billDate);
  }

  @Post('run')
  @RequirePerm(PERMS.RECON_EXEC)
  run(@Body() dto: ReconRunDto, @CurrentAdmin() admin: Express.Request['admin']) {
    return this.recon.runRange(dto.billDate, dto.endDate || dto.billDate, admin!.id);
  }

  @Post('items/:id/handle')
  @RequirePerm(PERMS.RECON_EXEC)
  handle(
    @Param('id') id: string,
    @Body() body: { action: 'ignore' | 'sync' | 'fixed'; remark?: string },
    @CurrentAdmin() admin: Express.Request['admin'],
  ) {
    return this.recon.handle(id, body.action, admin!.id, body.remark);
  }
}

@Controller('admin/config')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class ConfigAdminController {
  constructor(private readonly cfg: ChannelConfigService) {}

  @Get('alipay')
  @RequirePerm(PERMS.ALIPAY_VIEW)
  alipay() {
    return this.cfg.getAlipay();
  }

  @Patch('alipay')
  @RequirePerm(PERMS.ALIPAY_EDIT)
  save(@Body() body: Record<string, unknown>) {
    return this.cfg.saveAlipay(body as never);
  }

  @Post('alipay/ping')
  @RequirePerm(PERMS.ALIPAY_VIEW)
  ping() {
    return this.cfg.ping();
  }

  @Post('alipay/test-pay')
  @RequirePerm(PERMS.ALIPAY_EDIT)
  test(@Req() req: Request) {
    return this.cfg.testPay(req.ip);
  }

  @Get('settings')
  @RequirePerm(PERMS.ALIPAY_VIEW)
  settings() {
    return this.cfg.listSettings();
  }

  @Patch('settings')
  @RequirePerm(PERMS.ALIPAY_EDIT)
  saveSetting(@Body() dto: SettingDto) {
    return this.cfg.saveSetting(dto.key, dto.value);
  }
}

@Controller('admin/iam')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class IamAdminController {
  constructor(private readonly iam: IamService) {}

  @Get('users')
  @RequirePerm(PERMS.IAM_VIEW)
  users() {
    return this.iam.listUsers();
  }

  @Post('users')
  @RequirePerm(PERMS.IAM_EDIT)
  createUser(@Body() dto: UserDto) {
    return this.iam.createUser(dto);
  }

  @Patch('users/:id')
  @RequirePerm(PERMS.IAM_EDIT)
  patchUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.iam.updateUser(id, dto);
  }

  @Get('roles')
  @RequirePerm(PERMS.IAM_VIEW)
  roles() {
    return this.iam.listRoles();
  }

  @Post('roles')
  @RequirePerm(PERMS.IAM_EDIT)
  createRole(@Body() dto: RoleDto) {
    return this.iam.saveRole(dto);
  }

  @Patch('roles/:id')
  @RequirePerm(PERMS.IAM_EDIT)
  patchRole(@Param('id') id: string, @Body() dto: RoleDto) {
    return this.iam.saveRole({ ...dto, id });
  }

  @Get('permissions')
  @RequirePerm(PERMS.IAM_VIEW)
  perms() {
    return this.iam.listPerms();
  }
}

@Controller('admin/audit-logs')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class AuditAdminController {
  constructor(@InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>) {}

  @Get()
  @RequirePerm(PERMS.AUDIT_VIEW)
  async page(@Query() q: KeywordQuery) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
    const qb = this.logs.createQueryBuilder('a').orderBy('a.createdAt', 'DESC');
    if (q.keyword) qb.where('a.username ILIKE :k OR a.path ILIKE :k', { k: `%${q.keyword}%` });
    const [items, total] = await qb.skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
    return { items, total, page, pageSize };
  }
}
