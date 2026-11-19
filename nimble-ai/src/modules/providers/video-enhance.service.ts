import { Injectable } from '@nestjs/common';
import { UpstreamTask } from './ark-client.service';
import { MediaKitClientService } from './mediakit-client.service';

/**
 * 火山 AI MediaKit。
 * 不传 fps，输出保持源片帧率。
 */
@Injectable()
export class VideoEnhanceService {
  constructor(private readonly mediakit: MediaKitClientService) {}

  submit(videoUrl: string, resolution: string): Promise<string> {
    return this.mediakit.submit('enhance-video-generative', { video_url: videoUrl, resolution });
  }

  async get(taskId: string): Promise<UpstreamTask> {
    const task = await this.mediakit.task(taskId);
    if (task.status === 'completed') return { state: 'succeeded', url: task.result?.video_url as string | undefined };
    if (task.status === 'failed') return { state: 'failed', error: '视频生成失败' };
    return { state: 'running' };
  }
}
