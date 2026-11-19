import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import {
  ALL_PERMS,
  DEFAULT_APP_SECRET,
  MIN_RECHARGE_CENTS,
  NIMBLE_APP_ID,
  ORDER_EXPIRE_MINUTES,
  REWARD_SETTINGS,
} from '../../common/constants';
import { SecretService } from '../../common/crypto/secret.service';
import { maskSecret } from '../../common/ids';
import {
  AlipayConfig,
  OpenApp,
  SysPermission,
  SysRole,
  SysRolePermission,
  SysSetting,
  SysUser,
} from '../../entities';

@Injectable()
export class BootstrapService implements OnModuleInit {
  constructor(
    private readonly config: ConfigService,
    private readonly secrets: SecretService,
    @InjectRepository(SysPermission) private readonly perms: Repository<SysPermission>,
    @InjectRepository(SysRole) private readonly roles: Repository<SysRole>,
    @InjectRepository(SysRolePermission) private readonly rolePerms: Repository<SysRolePermission>,
    @InjectRepository(SysUser) private readonly users: Repository<SysUser>,
    @InjectRepository(AlipayConfig) private readonly alipay: Repository<AlipayConfig>,
    @InjectRepository(SysSetting) private readonly settings: Repository<SysSetting>,
    @InjectRepository(OpenApp) private readonly apps: Repository<OpenApp>,
  ) {}

  async onModuleInit() {
    for (const p of ALL_PERMS) {
      const row = await this.perms.findOne({ where: { code: p.code } });
      if (!row) await this.perms.save(this.perms.create(p));
      else {
        row.name = p.name;
        row.group = p.group;
        await this.perms.save(row);
      }
    }
    const all = await this.perms.find();
    const operator = await this.upsertRole('operator', '运营', '日常运营，不含改密钥和权限');
    const finance = await this.upsertRole('finance', '财务', '订单、退款、转账、分账、对账');
    await this.bind(operator.id, all.filter((p) => !p.code.startsWith('iam:') && p.code !== 'alipay:edit').map((p) => p.id));
    const financeCodes = new Set([
      'dashboard:view',
      'wallet:view',
      'order:view',
      'refund:view',
      'refund:create',
      'transfer:view',
      'transfer:create',
      'division:view',
      'division:edit',
      'division:exec',
      'recon:view',
      'recon:exec',
    ]);
    await this.bind(finance.id, all.filter((p) => financeCodes.has(p.code)).map((p) => p.id));

    const username = 'admin';
    if (!(await this.users.findOne({ where: { username } }))) {
      const password = this.config.get('ADMIN_BOOTSTRAP_PASSWORD', 'ly@0807.');
      await this.users.save(
        this.users.create({
          username,
          realName: '超级管理员',
          passwordHash: await argon2.hash(password),
          isSuperAdmin: true,
          status: 'ACTIVE',
        }),
      );
    }

    if (!(await this.alipay.findOne({ where: { id: 'default' } }))) {
      await this.alipay.save(this.alipay.create({ id: 'default', sandbox: true, enabled: false }));
    }

    const defaults = [
      { key: 'order.expireMinutes', name: '订单超时分钟', group: 'pay', value: String(ORDER_EXPIRE_MINUTES) },
      { key: 'division.defaultMode', name: '默认分账模式', group: 'pay', value: 'AUTO' },
      { key: 'pay.minRechargeCents', name: '最低充值金额', group: 'pay', value: String(MIN_RECHARGE_CENTS) },
      { key: 'site.name', name: '站点名称', group: 'site', value: 'nimblePay' },
      ...Object.values(REWARD_SETTINGS).map((s) => ({
        key: s.key,
        name: s.name,
        group: 'reward',
        value: String(s.fallback),
      })),
    ];
    for (const s of defaults) {
      const row = await this.settings.findOne({ where: { key: s.key } });
      if (!row) await this.settings.save(this.settings.create(s));
      else if (row.name !== s.name) await this.settings.save({ ...row, name: s.name }); // 名称以代码为准，值保持运营改过的
    }

    const secret = this.config.get<string>('NIMBLE_APP_SECRET')?.trim() || DEFAULT_APP_SECRET;
    const appId = this.config.get<string>('NIMBLE_APP_ID')?.trim() || NIMBLE_APP_ID;
    let app = await this.apps.findOne({ where: { appId } });
    const secretEnc = this.secrets.encrypt(secret);
    if (!app) {
      app = this.apps.create({
        appId,
        appName: 'nimble',
        secretEnc,
        secretHint: maskSecret(secret, 8, 4),
        status: 'ACTIVE',
        remark: 'nimble-ai 调用凭据',
      });
    } else {
      app.secretEnc = secretEnc;
      app.secretHint = maskSecret(secret, 8, 4);
      app.status = 'ACTIVE';
    }
    await this.apps.save(app);
  }

  private async upsertRole(code: string, name: string, remark: string) {
    let role = await this.roles.findOne({ where: { code } });
    if (!role) role = this.roles.create({ code, name, remark });
    else {
      role.name = name;
      role.remark = remark;
    }
    return this.roles.save(role);
  }

  private async bind(roleId: string, permissionIds: string[]) {
    await this.rolePerms.delete({ roleId });
    if (!permissionIds.length) return;
    await this.rolePerms.save(permissionIds.map((permissionId) => this.rolePerms.create({ roleId, permissionId })));
  }
}
