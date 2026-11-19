import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RedisService } from '../../modules/redis/redis.service';
import { PresenceService } from '../../modules/stats/presence.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly presence: PresenceService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);
    // 公开接口允许游客。带了 token 仍解析登录态：论坛要据此显示自己的「仅管理员」帖和是否已点赞。
    // token 无效时照常 401，前端会刷新登录后再重试，避免把已登录用户当成游客。
    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('未授权，请先登录');
    }

    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('jwt.secret'),
      });

      if (payload.type === 'refresh') {
        throw new UnauthorizedException('请使用 accessToken 访问接口');
      }

      const exists = await this.redisService.exists(`session:${payload.sub}`);
      if (!exists) {
        throw new UnauthorizedException('登录已过期，请重新登录');
      }

      request.user = {
        userId: payload.sub,
        loginName: payload.loginName ?? null,
        nickname: payload.nickname ?? null,
        isAdmin: !!payload.isAdmin,
      };
      // 记录活跃时间，统计页的"在线用户"据此判断；写失败不能影响请求
      void this.presence.touch(payload.sub).catch(() => undefined);
      return true;
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('无效的 token');
    }
  }

  private extractToken(request: any): string | null {
    const auth = request.headers?.authorization as string;
    if (auth?.startsWith('Bearer ')) return auth.substring(7);
    return null;
  }
}
