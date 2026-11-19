import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { VideoService } from '../video.service';
import { VIDEO_COMPOSE_QUEUE, ComposeJobData } from '../video.queues';

/**
 * FFmpeg 合成 Worker
 *
 * - concurrency=1：避免多任务抢 CPU/磁盘
 * - lockDuration=10min：合成耗时可能超过 BullMQ 默认 30s 锁，否则会 stalled 后反复重跑，打爆前端
 */
@Processor(VIDEO_COMPOSE_QUEUE, {
  concurrency: 1,
  lockDuration: 600_000,
  stalledInterval: 120_000,
  maxStalledCount: 1,
})
export class ComposeProcessor extends WorkerHost {
  private readonly logger = new Logger(ComposeProcessor.name);

  constructor(private readonly videoService: VideoService) {
    super();
  }

  async process(job: Job<ComposeJobData>): Promise<void> {
    try {
      await this.videoService.runComposeProject(job.data.projectId, job.data.composeToken);
    } catch (error) {
      // 兜底：确保异常也不会被 BullMQ 无限重试（attempts 已设为 1）
      this.logger.error(
        `视频合成任务异常: project=${job.data.projectId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
