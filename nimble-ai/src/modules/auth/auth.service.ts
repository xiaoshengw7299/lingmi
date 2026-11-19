import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as dayjs from 'dayjs';
import { User } from '../user/entities/user.entity';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage';
import { randomBytes } from 'crypto';
import { ChangePasswordDto, LoginDto, LoginNameDto, UpdateProfileDto, WechatLoginDto } from './dto/auth.dto';
import { Status } from '../../common/enums';

const PASSWORD_ROUNDS = 10;
const AVATAR_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
/** 去掉容易看混的字符：0/o、1/l/i */
const LOGIN_NAME_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export interface AvatarFile {
  buffer: Buffer;
  mimetype: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly storage: StorageService,
  ) {}

  providers() {
    return { wechat: this.wechatReady() };
  }

  async wechatConnect() {
    const appId = this.wechatAppId();
    const redirectUri = this.wechatRedirectUri();
    if (!appId || !redirectUri || !this.wechatSecret()) {
      throw new HttpException('微信登录未配置', HttpStatus.BAD_REQUEST);
    }
    const state = randomBytes(16).toString('hex');
    await this.redisService.set(`wechat:state:${state}`, '1', 300);
    const url =
      'https://open.weixin.qq.com/connect/qrconnect' +
      `?appid=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      '&response_type=code&scope=snsapi_login' +
      `&state=${state}#wechat_redirect`;
    return { appId, redirectUri, state, url };
  }

  async loginByWechat(dto: WechatLoginDto) {
    const stateKey = `wechat:state:${dto.state}`;
    if (!(await this.redisService.exists(stateKey))) {
      throw new HttpException('扫码已过期，请重新打开微信登录', HttpStatus.UNAUTHORIZED);
    }
    await this.redisService.del(stateKey);

    const tokenJson = await this.wechatGet<{
      access_token?: string;
      openid?: string;
      unionid?: string;
      errcode?: number;
      errmsg?: string;
    }>('https://api.weixin.qq.com/sns/oauth2/access_token', {
      appid: this.wechatAppId(),
      secret: this.wechatSecret(),
      code: dto.code,
      grant_type: 'authorization_code',
    });
    if (!tokenJson.access_token || !tokenJson.openid) {
      throw new HttpException(tokenJson.errmsg || '微信授权失败', HttpStatus.UNAUTHORIZED);
    }

    const profile = await this.wechatGet<{
      nickname?: string;
      headimgurl?: string;
      errcode?: number;
    }>('https://api.weixin.qq.com/sns/userinfo', {
      access_token: tokenJson.access_token,
      openid: tokenJson.openid,
    });

    let user = await this.userRepo.findOne({ where: { wechatOpenId: tokenJson.openid } });
    if (!user && tokenJson.unionid) {
      user = await this.userRepo.findOne({ where: { wechatUnionId: tokenJson.unionid } });
    }
    if (!user) {
      user = await this.openWechatUser({
        openid: tokenJson.openid,
        unionid: tokenJson.unionid,
        nickname: profile.nickname,
        avatar: profile.headimgurl,
        ref: dto.ref,
      });
    } else {
      const patch: Partial<User> = {};
      if (!user.loginName) patch.loginName = await this.allocateLoginName();
      if (!user.wechatOpenId) patch.wechatOpenId = tokenJson.openid;
      if (tokenJson.unionid && !user.wechatUnionId) patch.wechatUnionId = tokenJson.unionid;
      if (!user.nickname && profile.nickname) patch.nickname = profile.nickname;
      if (!user.avatar && profile.headimgurl) patch.avatar = profile.headimgurl;
      if (Object.keys(patch).length) {
        await this.userRepo.update(user.id, patch);
        user = (await this.userRepo.findOne({ where: { id: user.id } }))!;
      }
    }
    if (user.status === Status.Disabled) {
      throw new HttpException('账号已被禁用', HttpStatus.FORBIDDEN);
    }
    return this.finishLogin(user);
  }

  async login(dto: LoginDto) {
    const account = dto.account.trim().toLowerCase();
    const user = await this.userRepo
      .createQueryBuilder('u')
      .addSelect('u.password')
      .where('u.loginName = :account', { account })
      .getOne();
    if (!user) {
      throw new HttpException('账号或密码错误', HttpStatus.UNAUTHORIZED);
    }
    if (!user.password) {
      throw new HttpException('这个账号还没有密码，请先用微信登录，再到账号安全里设置密码', HttpStatus.UNAUTHORIZED);
    }
    if (!(await bcrypt.compare(dto.password, user.password))) {
      throw new HttpException('账号或密码错误', HttpStatus.UNAUTHORIZED);
    }
    if (user.status === Status.Disabled) {
      throw new HttpException('账号已被禁用', HttpStatus.FORBIDDEN);
    }
    return this.finishLogin(user);
  }

  async refresh(refreshToken: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('jwt.secret'),
      });
    } catch {
      throw new UnauthorizedException('refreshToken 无效或已过期');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('非法的 token 类型');
    }

    const storedToken = await this.redisService.get<string>(`session:${payload.sub}`);
    if (storedToken !== refreshToken) {
      throw new UnauthorizedException('refreshToken 已失效，请重新登录');
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user || user.status === Status.Disabled) {
      throw new UnauthorizedException('账号不可用');
    }
    return this.issueSession(user);
  }

  async logout(userId: number) {
    await this.redisService.del(`session:${userId}`);
  }

  async getMe(userId: number) {
    const user = await this.userWithPassword(userId);
    return { user: this.present(user) };
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    await this.userRepo.update(userId, { nickname: dto.nickname.trim() });
    return this.getMe(userId);
  }

  async changeLoginName(userId: number, dto: LoginNameDto) {
    const user = await this.userWithPassword(userId);
    if ((!user.wechatOpenId && !user.wechatUnionId) || user.status === Status.Disabled) {
      throw new ForbiddenException('当前账号无法修改登录账号');
    }
    const loginName = dto.account.trim().toLowerCase();
    try {
      if (loginName !== user.loginName) await this.userRepo.update(user.id, { loginName });
    } catch (error) {
      const dbError = error as { code?: string; constraint?: string };
      if (dbError.code === '23505' && dbError.constraint === 'UQ_account_login_name') {
        throw new ConflictException('该登录账号已被使用');
      }
      throw error;
    }
    return this.getMe(userId);
  }

  /** 改密后换发会话：当前设备拿到新令牌继续使用，其他设备的刷新令牌随之失效 */
  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.userWithPassword(userId);
    if (user.password) {
      if (!dto.oldPassword || !(await bcrypt.compare(dto.oldPassword, user.password))) {
        throw new BadRequestException('当前密码不正确');
      }
      if (dto.oldPassword === dto.newPassword) throw new BadRequestException('新密码不能和当前密码相同');
    }
    await this.userRepo.update(userId, { password: await bcrypt.hash(dto.newPassword, PASSWORD_ROUNDS) });
    return this.issueSession(user);
  }

  async uploadAvatar(userId: number, file?: AvatarFile) {
    const ext = file && AVATAR_TYPES[file.mimetype];
    if (!file || !ext) throw new BadRequestException('请上传 JPG、PNG 或 WebP 图片');
    const user = await this.userWithPassword(userId);
    const key = `ai-avatar/${userId}/${Date.now()}.${ext}`;
    await this.storage.upload(key, file.buffer, file.mimetype);
    await this.userRepo.update(userId, { avatar: key });
    // 微信头像是外链，不属于我们的存储，不用删
    if (user.avatar && !/^https?:\/\//i.test(user.avatar)) void this.storage.remove(user.avatar);
    return this.getMe(userId);
  }

  private async finishLogin(user: User) {
    const full = user.password === undefined ? await this.userWithPassword(user.id) : user;
    const tokens = await this.issueSession(full);
    const lastLoginAt = dayjs().toDate();
    await this.userRepo.update(full.id, { lastLoginAt });
    full.lastLoginAt = lastLoginAt;
    return { ...tokens, user: this.present(full) };
  }

  private async userWithPassword(userId: number) {
    const user = await this.userRepo
      .createQueryBuilder('u')
      .addSelect('u.password')
      .where('u.id = :id', { id: userId })
      .getOne();
    if (!user) throw new HttpException('用户不存在', HttpStatus.NOT_FOUND);
    return user;
  }

  /** 第一次扫码建号。登录账号撞车或同一微信并发扫码时，落到已有账号上 */
  private async openWechatUser(input: {
    openid: string;
    unionid?: string;
    nickname?: string;
    avatar?: string;
    ref?: string;
  }) {
    const inviter = await this.inviterOf(input.ref);
    // 邀请人是分销商：新用户归他名下，但不写 invitedBy，这样不发邀请现金
    const invitedBy = inviter && !inviter.isDistributor ? inviter.id : null;
    const distributorId = await this.distributorOf(inviter);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.userRepo.save(
          this.userRepo.create({
            loginName: await this.allocateLoginName(),
            wechatOpenId: input.openid,
            wechatUnionId: input.unionid,
            nickname: input.nickname || '微信用户',
            avatar: input.avatar,
            isAdmin: false,
            invitedBy,
            distributorId,
          }),
        );
      } catch (error) {
        if ((error as { code?: string })?.code !== '23505') throw error;
        const existing =
          (await this.userRepo.findOne({ where: { wechatOpenId: input.openid } })) ||
          (input.unionid ? await this.userRepo.findOne({ where: { wechatUnionId: input.unionid } }) : null);
        if (existing) return existing;
      }
    }
    throw new HttpException('分配账号失败，请重新扫码', HttpStatus.SERVICE_UNAVAILABLE);
  }

  /**
   * 新用户归哪个分销商。邀请人是现任分销商（一级或二级）就归他；
   * 否则沿用邀请人的归属。二级已取消时，新用户改归其仍在任的一级，不再归这个二级。
   * 一级已取消则这条链不再带来新用户。归属只在注册时写一次。
   */
  private async distributorOf(
    inviter: Pick<User, 'id' | 'isDistributor' | 'distributorId' | 'distributorLevel' | 'parentDistributorId'> | null,
  ) {
    if (!inviter) return null;
    if (inviter.isDistributor) return inviter.id;
    if (inviter.distributorLevel === 2) return this.activeParent(inviter.parentDistributorId);
    return this.inheritActive(inviter.distributorId);
  }

  /** 沿用的归属必须仍在任；若是已取消的二级，改归其一级 */
  private async inheritActive(id: number | null) {
    if (!id) return null;
    const distributor = await this.userRepo.findOne({
      where: { id },
      select: { id: true, isDistributor: true, distributorLevel: true, parentDistributorId: true },
    });
    if (!distributor) return null;
    if (distributor.isDistributor) return distributor.id;
    if (distributor.distributorLevel === 2) return this.activeParent(distributor.parentDistributorId);
    return null;
  }

  private async activeParent(id: number | null) {
    if (!id) return null;
    const parent = await this.userRepo.findOne({
      where: { id, isDistributor: true, distributorLevel: 1 },
      select: { id: true },
    });
    return parent?.id ?? null;
  }

  /** 推广码换邀请人。码无效就当没有邀请人，不能因此挡住登录 */
  private async inviterOf(ref?: string) {
    const code = ref?.trim().toLowerCase();
    if (!code) return null;
    return this.userRepo.findOne({
      where: { referralCode: code },
      select: { id: true, isDistributor: true, distributorId: true, distributorLevel: true, parentDistributorId: true },
    });
  }

  /** 自动分配的登录账号形如 lm + 8 位 */
  private async allocateLoginName(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const bytes = randomBytes(8);
      let name = 'lm';
      for (let i = 0; i < 8; i++) name += LOGIN_NAME_ALPHABET[bytes[i] % LOGIN_NAME_ALPHABET.length];
      const taken = await this.userRepo.findOne({ where: { loginName: name }, select: { id: true } });
      if (!taken) return name;
    }
    throw new HttpException('分配账号失败，请重新扫码', HttpStatus.SERVICE_UNAVAILABLE);
  }

  private present(user: User) {
    return {
      id: user.id,
      loginName: user.loginName,
      canChangeLoginName: Boolean(user.wechatOpenId || user.wechatUnionId),
      nickname: user.nickname,
      // 头像库里存对象键，出站拼成可访问的地址；微信头像本身就是完整 URL，原样返回
      avatar: user.avatar ? this.storage.toPublicUrl(user.avatar) : null,
      isAdmin: user.isAdmin,
      isSuperAdmin: user.isSuperAdmin,
      isDistributor: user.isDistributor,
      status: user.status,
      plan: user.plan,
      hasPassword: !!user.password,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }

  private async issueSession(user: User) {
    const payload = {
      sub: user.id,
      loginName: user.loginName,
      nickname: user.nickname || null,
      isAdmin: user.isAdmin,
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...payload, type: 'access' },
        { expiresIn: this.configService.get<string>('jwt.accessExpires') as any },
      ),
      this.jwtService.signAsync(
        { ...payload, type: 'refresh' },
        { expiresIn: this.configService.get<string>('jwt.refreshExpires') as any },
      ),
    ]);
    await this.redisService.set(`session:${user.id}`, refreshToken, 7 * 24 * 3600);
    return { accessToken, refreshToken };
  }

  private wechatReady() {
    return !!(this.wechatAppId() && this.wechatSecret() && this.wechatRedirectUri());
  }

  private wechatAppId() {
    return this.configService.get<string>('WECHAT_APP_ID')?.trim() || '';
  }

  private wechatSecret() {
    return this.configService.get<string>('WECHAT_APP_SECRET')?.trim() || '';
  }

  private wechatRedirectUri() {
    return this.configService.get<string>('WECHAT_REDIRECT_URI')?.trim() || '';
  }

  private async wechatGet<T extends { errcode?: number }>(url: string, query: Record<string, string>): Promise<T> {
    const target = new URL(url);
    for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
    const response = await fetch(target);
    if (!response.ok) throw new HttpException('微信服务暂不可用', HttpStatus.BAD_GATEWAY);
    return (await response.json()) as T;
  }
}
