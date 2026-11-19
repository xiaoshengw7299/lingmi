import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { runWithBilling } from '../../billing/billing-context';
import { VideoService } from '../video.service';
import { VIDEO_GEN_QUEUE, VideoJobData } from '../video.queues';

const POLL_WINDOW_MS = 90 * 60 * 1000; // 长视频生成任务上限（个别模型可能要几十分钟）

/**
 * 前密后疏：短视频（Kling/Seedance）几十秒内完成，前半分钟 3 秒一查，避免完成后还空转；
 * 较慢的模型十几分钟才出结果，两分钟后再降到 10 秒，避免长时间打满上游。
 */
function nextPollDelayMs(attempt: number): number {
  if (attempt <= 10) return 3000;
  if (attempt <= 30) return 5000;
  return 10000;
}

/**
 * 视频生成 Worker
 *
 * - submit：提交到 模型平台API，成功后延时入队 poll（若已开启 webhook，回调会提前触发同一次轮询）；
 * - poll：查询任务状态，未完成则继续延时轮询。窗口用完后停止密集查询，任务仍保持生成中，不退款。
 */
@Processor(VIDEO_GEN_QUEUE, { concurrency: 5 })
export class VideoGenProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoGenProcessor.name);

  constructor(
    private readonly videoService: VideoService,
    @InjectQueue(VIDEO_GEN_QUEUE) private readonly queue: Queue<VideoJobData>,
  ) {
    super();
  }

  process(job: Job<VideoJobData>): Promise<void> {
    const { data } = job;
    return runWithBilling(data.userId, () => (data.kind === 'submit' ? this.handleSubmit(data) : this.handlePoll(data)));
  }

  private async handleSubmit(data: Extract<VideoJobData, { kind: 'submit' }>): Promise<void> {
    const taskId = await this.videoService.submitShotVideoTask(data.projectId, data.shotId, data.takeId, data.continuous);
    if (!taskId) return; // 提交失败，状态已在 submitShotVideoTask 内落库为 failed

    await this.enqueuePollOrFail({
      ...data,
      kind: 'poll',
      taskId,
      attempt: 1,
      pollStartedAt: Date.now(),
    });
  }

  private async handlePoll(data: Extract<VideoJobData, { kind: 'poll' }>): Promise<void> {
    const pollStartedAt = data.pollStartedAt ?? Date.now();
    try {
      const { done } = await this.videoService.pollShotVideoTask(
        data.projectId,
        data.shotId,
        data.takeId,
        data.taskId,
        data.continuous,
      );
      if (done) return;

      const nextAttempt = data.attempt + 1;
      if (Date.now() - pollStartedAt > POLL_WINDOW_MS) {
        await this.videoService.markShotVideoTimedOut(data.projectId, data.shotId, data.takeId, data.taskId, data.continuous);
        return;
      }
      await this.enqueuePollOrFail({ ...data, attempt: nextAttempt, pollStartedAt });
    } catch (error) {
      this.logger.error(`视频任务轮询异常: ${JSON.stringify(data)}`, error instanceof Error ? error.stack : String(error));
      const nextAttempt = data.attempt + 1;
      if (Date.now() - pollStartedAt > POLL_WINDOW_MS) {
        await this.videoService.markShotVideoTimedOut(
          data.projectId,
          data.shotId,
          data.takeId,
          data.taskId,
          data.continuous,
        );
        return;
      }
      await this.enqueuePollOrFail({ ...data, attempt: nextAttempt, pollStartedAt });
    }
  }

  private async enqueuePollOrFail(data: Extract<VideoJobData, { kind: 'poll' }>): Promise<void> {
    try {
      await this.queue.add(
        'poll',
        data,
        {
          delay: nextPollDelayMs(data.attempt),
          jobId: `poll-${data.takeId}-${data.taskId}-${data.attempt}`,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      const message = `视频状态轮询任务入队失败：${error instanceof Error ? error.message : String(error)}`;
      this.logger.error(message);
      await this.videoService.markShotVideoQueueFailed(
        data.projectId,
        data.shotId,
        data.takeId,
        data.taskId,
        data.continuous,
        message,
      );
    }
  }
}
