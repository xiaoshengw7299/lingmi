import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { runWithBilling } from '../../billing/billing-context';
import { VideoService } from '../video.service';
import { VIDEO_IMAGE_QUEUE, ImageJobData } from '../video.queues';

/**
 * 图片生成 Worker（角色定妆图 / 场景参考图，走 模型平台API）
 *
 * concurrency=1：同一时刻只跑一个生成请求，避免触发上游速率限制。
 */
@Processor(VIDEO_IMAGE_QUEUE, {
  concurrency: 1,
  // 进程内会等到 Atlas 返回或交棒（最长约 15 分钟）。锁短于这段时间时，续期一旦没跑上就会把任务判死重跑。
  lockDuration: 16 * 60 * 1000,
  stalledInterval: 120_000,
  maxStalledCount: 1,
})
export class ImageGenProcessor extends WorkerHost {
  private readonly logger = new Logger(ImageGenProcessor.name);

  constructor(private readonly videoService: VideoService) {
    super();
  }

  process(job: Job<ImageJobData>): Promise<void> {
    return runWithBilling(job.data.userId, async () => {
      const { projectId, refId, remainingRefIds = [] } = job.data;
      let pending = false;
      try {
        pending = (await this.videoService.runBoardImageGeneration(projectId, refId)) === 'pending';
      } catch (error) {
        this.logger.error(`图片生成任务异常: ${JSON.stringify(job.data)}`, error instanceof Error ? error.stack : String(error));
      } finally {
        // Atlas 仍在处理时先不投下一个依赖。回调或对账写完这张图后会继续。
        if (!pending) await this.videoService.enqueueNextBoardImage(projectId, remainingRefIds);
      }
    });
  }
}
