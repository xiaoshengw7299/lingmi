import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { DataSource, Repository } from 'typeorm';
import { ApiException } from '../../common/api-exception';
import { SysPermission, SysRole, SysRolePermission, SysUser, SysUserRole } from '../../entities';

@Injectable()
export class IamService {
  constructor(
    @InjectRepository(SysUser) private readonly users: Repository<SysUser>,
    @InjectRepository(SysRole) private readonly roles: Repository<SysRole>,
    @InjectRepository(SysRolePermission) private readonly rolePerms: Repository<SysRolePermission>,
    @InjectRepository(SysPermission) private readonly perms: Repository<SysPermission>,
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.users.findOne({ where: { username } });
    if (!user || user.status !== 'ACTIVE') throw ApiException.bad('用户名或密码错误');
    if (!(await argon2.verify(user.passwordHash, password))) throw ApiException.bad('用户名或密码错误');
    return this.issue(user.id);
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string; typ: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, { secret: this.config.get('jwt.secret') });
    } catch {
      throw ApiException.unauthorized();
    }
    if (payload.typ !== 'admin_refresh') throw ApiException.unauthorized();
    return this.issue(payload.sub);
  }

  async profile(userId: string) {
    const user = await this.users.findOne({
      where: { id: userId },
      relations: { roles: { role: { permissions: { permission: true } } } },
    });
    if (!user) throw ApiException.notFound();
    const permissions = user.isSuperAdmin
      ? ['*']
      : [...new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)))];
    return {
      id: user.id,
      username: user.username,
      realName: user.realName,
      isSuperAdmin: user.isSuperAdmin,
      status: user.status,
      roles: user.roles.map((r) => ({ id: r.role.id, code: r.role.code, name: r.role.name })),
      permissions,
    };
  }

  async issue(userId: string) {
    const user = await this.profile(userId);
    const accessToken = await this.jwt.signAsync(
      { sub: userId, typ: 'admin' },
      { expiresIn: this.config.get('jwt.accessExpires', '2h') },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, typ: 'admin_refresh' },
      { secret: this.config.get('jwt.secret'), expiresIn: this.config.get('jwt.refreshExpires', '7d') },
    );
    return { accessToken, refreshToken, user };
  }

  async listUsers() {
    const users = await this.users.find({ relations: { roles: { role: true } }, order: { createdAt: 'ASC' } });
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      realName: u.realName,
      isSuperAdmin: u.isSuperAdmin,
      status: u.status,
      roles: u.roles.map((r) => r.role),
      createdAt: u.createdAt,
    }));
  }

  listRoles() {
    return this.roles.find({ relations: { permissions: { permission: true } }, order: { createdAt: 'ASC' } });
  }

  async createUser(input: { username: string; password: string; realName?: string; roleIds?: string[] }) {
    if (await this.users.findOne({ where: { username: input.username } })) throw ApiException.conflict('用户名已存在');
    const user = await this.users.save(
      this.users.create({
        username: input.username.trim(),
        realName: input.realName || input.username,
        passwordHash: await argon2.hash(input.password),
      }),
    );
    await this.setRoles(user.id, input.roleIds || []);
    return this.listUsers();
  }

  async updateUser(id: string, input: { realName?: string; status?: string; roleIds?: string[]; password?: string }) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw ApiException.notFound();
    if (user.isSuperAdmin && input.status === 'DISABLED') throw ApiException.bad('不能停用超级管理员');
    if (input.realName != null) user.realName = input.realName;
    if (input.status) user.status = input.status;
    if (input.password) user.passwordHash = await argon2.hash(input.password);
    await this.users.save(user);
    if (input.roleIds) await this.setRoles(id, input.roleIds);
    return this.listUsers();
  }

  async saveRole(input: { id?: string; code: string; name: string; remark?: string; permissionIds?: string[] }) {
    let role = input.id ? await this.roles.findOne({ where: { id: input.id } }) : null;
    if (input.id && !role) throw ApiException.notFound();
    if (!role) {
      if (await this.roles.findOne({ where: { code: input.code } })) throw ApiException.conflict('角色编码已存在');
      role = this.roles.create({ code: input.code, name: input.name, remark: input.remark || '' });
    } else {
      role.name = input.name;
      role.remark = input.remark ?? role.remark;
    }
    role = await this.roles.save(role);
    if (input.permissionIds) {
      await this.rolePerms.delete({ roleId: role.id });
      if (input.permissionIds.length) {
        await this.rolePerms.save(input.permissionIds.map((permissionId) => this.rolePerms.create({ roleId: role!.id, permissionId })));
      }
    }
    return this.listRoles();
  }

  listPerms() {
    return this.perms.find({ order: { group: 'ASC', code: 'ASC' } });
  }

  private async setRoles(userId: string, roleIds: string[]) {
    const repo = this.dataSource.getRepository(SysUserRole);
    await repo.delete({ userId });
    if (roleIds.length) await repo.save(roleIds.map((roleId) => repo.create({ userId, roleId })));
  }
}
