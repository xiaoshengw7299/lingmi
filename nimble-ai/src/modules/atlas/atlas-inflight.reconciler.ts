import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AtlasWebhookDispatcherService } from './atlas-webhook-dispatcher.service';
import { AtlasClientService } from './atlas-client.service';

/** 回调可能延迟、丢失，或打到已经不再等待的进程。定时把还开着的任务再问一次 Atlas。 */
const SWEEP_INTERVAL_MS = 20_000;

@Injectable()
export class AtlasInflightReconciler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AtlasInflightReconciler.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly dispatcher: AtlasWebhookDispatcherService,
    private readonly atlas: AtlasClientService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.reconcile().catch((error) => {
        this.logger.error('Atlas 任务对账失败', error instanceof Error ? error.stack : String(error));
      });
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** 先让业务把终态写回界面，再把没人认领的任务问一遍 Atlas：成功结清扣款，失败才退款。 */
  private async reconcile(): Promise<void> {
    await this.dispatcher.sweep();
    const ids = await this.atlas.listUnsettled();
    for (const id of ids) {
      if (this.atlas.hasWaiter(id)) continue;
      try {
        await this.atlas.getPrediction(id);
      } catch (error) {
        this.logger.warn(`对账查询失败 prediction=${id}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
}
