import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { runWithBilling } from '../billing/billing-context';
import { GENERATION_QUEUE, GenerationJobData, GenerationService } from './generation.service';

/** 通用生成 Worker：视频任务要等几分钟，所以并发开大一点，避免互相排队 */
@Processor(GENERATION_QUEUE, {
  concurrency: 8,
  // 图片会在进程内等到 Atlas 返回或交棒。锁要盖住这段等待，避免任务被判死重跑后又提交一次。
  lockDuration: 16 * 60 * 1000,
  stalledInterval: 120_000,
  maxStalledCount: 1,
})
export class GenerationProcessor extends WorkerHost {
  constructor(private readonly generation: GenerationService) {
    super();
  }

  process(job: Job<GenerationJobData>): Promise<void> {
    return runWithBilling(job.data.userId, () => this.generation.run(job.data.taskId));
  }
}
