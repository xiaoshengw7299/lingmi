import { Injectable, Logger } from '@nestjs/common';
import { AtlasWebhookHandler } from './atlas-webhook.types';

/**
 * Webhook 认领分发器：各业务模块（video-producer / 一键成片）在自己的 Service
 * 里通过 `register()` 挂上处理器，Atlas 模块本身不需要认识任何业务模块，避免反向依赖。
 */
@Injectable()
export class AtlasWebhookDispatcherService {
  private readonly logger = new Logger(AtlasWebhookDispatcherService.name);
  private readonly handlers: AtlasWebhookHandler[] = [];

  register(handler: AtlasWebhookHandler): void {
    this.handlers.push(handler);
  }

  /**
   * 按注册顺序尝试认领。
   * 返回 true 表示已有处理器认领（含「已经处理完」的重复投递）。
   */
  async dispatch(sessionId: string): Promise<boolean> {
    for (const handler of this.handlers) {
      try {
        if (await handler.tryHandle(sessionId)) return true;
      } catch (error) {
        this.logger.error(
          `Webhook 处理器 "${handler.name}" 处理 session=${sessionId} 异常`,
          error instanceof Error ? error.stack : String(error),
        );
        return false;
      }
    }
    this.logger.warn(`Webhook session=${sessionId} 未被任何处理器认领`);
    return false;
  }

  /** 各业务模块扫自己还没写完的任务。回调丢了或进程重启后，靠这个把 Atlas 终态补回去。 */
  async sweep(): Promise<void> {
    for (const handler of this.handlers) {
      if (!handler.sweep) continue;
      try {
        await handler.sweep();
      } catch (error) {
        this.logger.error(
          `Webhook 处理器 "${handler.name}" 对账异常`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }
}
