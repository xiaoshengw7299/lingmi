import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ShortVideoService } from '../short-video.service';
import { SHORT_VIDEO_QUEUE, ShortVideoJobData } from '../short-video.queues';

/**
 * 一键成片 Worker：文案/配音/字幕/素材/合成全部在本进程内完成（不再依赖外部 MoneyPrinterTurbo 服务），
 * 一个 job 跑到底，进度通过 ShortVideoService.runPipeline 内部的阶段性 DB 写入体现，前端仍按原节奏轮询任务详情。
 * 单个任务耗时可能到几分钟（尤其 AI 生成素材/多版本），并发数按 CPU/网络出口能力控制，避免 ffmpeg 抢资源。
 */
@Processor(SHORT_VIDEO_QUEUE, { concurrency: 2, lockDuration: 25 * 60 * 1000 })
export class ShortVideoProcessor extends WorkerHost {
  private readonly logger = new Logger(ShortVideoProcessor.name);

  constructor(private readonly shortVideoService: ShortVideoService) {
    super();
  }

  process(job: Job<ShortVideoJobData>): Promise<void> {
    return this.shortVideoService.runPipeline(job.data.taskId, job.stalledCounter > 0);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ShortVideoJobData> | undefined, error: Error) {
    if (!job) return;
    this.logger.error(`一键成片任务异常: ${job.data.taskId}`, error.stack);
    await this.shortVideoService.interrupt(job.data.taskId).catch((failure: Error) => this.logger.error(failure.stack));
  }
}
