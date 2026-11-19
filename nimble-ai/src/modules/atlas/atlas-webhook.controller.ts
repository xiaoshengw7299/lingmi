import { Controller, Logger, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { AtlasClientService } from './atlas-client.service';
import { AtlasWebhookDispatcherService } from './atlas-webhook-dispatcher.service';
import { AtlasWebhookVerifierService } from './atlas-webhook-verifier.service';

interface RequestWithRawBody extends Request {
  /** main.ts 的全局 express.json() 通过 verify 回调保留的原始请求体字节，签名校验必须用这个而不是重新序列化的 JSON */
  rawBody?: Buffer;
}

/**
 * 模型平台API Webhook 接收端点：`POST /api/webhooks/atlas-cloud`。
 *
 * 必须免登录：Atlas 服务器回调不带用户 token，全局 JwtAuthGuard 会直接 401，
 * 官方会按指数退避重试大约 10 次后放弃投递。验签在控制器内完成。
 *
 * 处理原则：验签 → 尽快 200 ack（官方建议几秒内响应，否则触发指数退避重试）→ 异步分发认领处理，
 * 不在响应前做任何业务落库，避免拖慢 ack 触发不必要的重试风暴。
 */
@Public()
@Controller('webhooks/atlas-cloud')
export class AtlasWebhookController {
  private readonly logger = new Logger(AtlasWebhookController.name);

  constructor(
    private readonly verifier: AtlasWebhookVerifierService,
    private readonly dispatcher: AtlasWebhookDispatcherService,
    private readonly atlas: AtlasClientService,
  ) {}

  @Post()
  async handle(@Req() req: RequestWithRawBody, @Res() res: Response): Promise<void> {
    const rawBody = req.rawBody;
    if (!rawBody?.length) {
      this.logger.error('Webhook 请求缺少原始 body，检查 main.ts 的 express.json verify 回调是否生效');
      res.status(500).send('server misconfigured');
      return;
    }

    const verified = await this.verifier.verify(rawBody, {
      timestamp: req.get('x-atlascloud-webhook-timestamp'),
      keyId: req.get('x-atlascloud-webhook-key-id'),
      signatureEd25519:
        req.get('x-atlascloud-webhook-signature-ed25519') || req.get('x-atlascloud-webhook-signature'),
    });
    if (!verified) {
      res.status(401).send('invalid signature');
      return;
    }

    const sessionId = req.get('x-atlascloud-webhook-id') || this.extractSessionId(rawBody);
    res.status(200).send('ok');
    if (!sessionId) {
      this.logger.warn('Webhook 请求缺少 session_id，无法分发');
      return;
    }
    // 回调只在 Atlas 终态时到达。先唤醒还在 pollUntilDone 里的调用方，再分发落库。
    // 本地等待已经结束、或这次请求打到了没有等待者的进程时，分发器负责把结果写回业务记录。
    const woke = this.atlas.wakePrediction(sessionId);
    this.logger.log(`收到 Atlas 回调 session=${sessionId} woke=${woke}`);
    this.dispatcher
      .dispatch(sessionId)
      .catch((error) => this.logger.error(`Webhook 分发异常 session=${sessionId}`, error instanceof Error ? error.stack : String(error)));
  }

  private extractSessionId(rawBody: Buffer): string | undefined {
    try {
      const parsed = JSON.parse(rawBody.toString('utf8'));
      return typeof parsed?.session_id === 'string' ? parsed.session_id : undefined;
    } catch {
      return undefined;
    }
  }
}
