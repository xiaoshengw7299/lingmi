import { Injectable, Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Server, Socket } from 'socket.io';
import { VideoProjectEntity } from './entities/video-project.entity';
import { RedisService } from '../redis/redis.service';
import { AuthUser } from '../../common/types/auth-user';

const roomOf = (projectId: string) => `video-project:${projectId}`;

/**
 * AI 视频制作实时推送
 *
 * 连接时校验 JWT；加入房间时再校验项目归属（管理员可旁路）。
 * 前端打开某个视频项目工作台时加入对应房间，图片/视频生成、FFmpeg 合成等
 * 后台任务（见 processors/）每次状态变化都会主动推送最新项目数据。
 */
@Injectable()
@WebSocketGateway({ namespace: '/video', cors: { origin: true, credentials: true } })
export class VideoGateway implements OnGatewayConnection {
  private readonly logger = new Logger(VideoGateway.name);

  @WebSocketServer()
  private server: Server;

  constructor(
    @InjectRepository(VideoProjectEntity)
    private readonly projectRepo: Repository<VideoProjectEntity>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) throw new Error('missing token');

      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('jwt.secret'),
      });
      if (payload.type === 'refresh') throw new Error('refresh token');

      const exists = await this.redisService.exists(`session:${payload.sub}`);
      if (!exists) throw new Error('session expired');

      const user: AuthUser = {
        userId: payload.sub,
        loginName: payload.loginName ?? null,
        nickname: payload.nickname ?? null,
        isAdmin: !!payload.isAdmin,
      };
      client.data.user = user;
    } catch (err) {
      this.logger.warn(`WS 拒绝连接 ${client.id}: ${err instanceof Error ? err.message : String(err)}`);
      client.disconnect(true);
    }
  }

  @SubscribeMessage('join')
  async onJoin(@MessageBody() projectId: string, @ConnectedSocket() client: Socket) {
    if (!projectId) return;
    const user = client.data.user as AuthUser | undefined;
    if (!user) {
      client.disconnect(true);
      return;
    }
    const allowed = await this.canAccessProject(projectId, user);
    if (!allowed) {
      client.emit('error', { message: '无权订阅该项目' });
      return;
    }
    await client.join(roomOf(projectId));
    return { ok: true };
  }

  @SubscribeMessage('leave')
  onLeave(@MessageBody() projectId: string, @ConnectedSocket() client: Socket) {
    if (!projectId) return;
    client.leave(roomOf(projectId));
  }

  /** 供各 Processor / VideoService 在状态变化后调用，把最新项目数据推给所有关注该项目的客户端 */
  emitProjectUpdated(project: VideoProjectEntity) {
    if (!this.server) {
      this.logger.warn(`WS 尚未就绪，跳过推送 project=${project.id}`);
      return;
    }
    try {
      this.server.to(roomOf(project.id)).emit('project:updated', JSON.parse(JSON.stringify(project)));
    } catch (error) {
      this.logger.error(
        `推送项目更新失败 project=${project.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private extractToken(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth) return fromAuth;

    const header = client.handshake.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.substring(7);
    }
    return null;
  }

  private async canAccessProject(projectId: string, user: AuthUser): Promise<boolean> {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
      select: { id: true, userId: true },
    });
    if (!project) return false;
    return user.isAdmin || project.userId === String(user.userId);
  }
}
