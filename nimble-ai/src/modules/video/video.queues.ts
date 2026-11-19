import { BillingJobData } from '../billing/billing-context';

/** BullMQ 队列名与任务数据类型定义（video 模块共用） */

export const VIDEO_IMAGE_QUEUE = 'video-image';
export const VIDEO_GEN_QUEUE = 'video-gen';
export const VIDEO_COMPOSE_QUEUE = 'video-compose';

/** 图片生成任务（素材库中的 AI 图片素材，走 Seedream） */
export interface ImageJobData extends BillingJobData {
  projectId: string;
  refId: string;
  /** 批量生成链中的后续素材；当前任务结束后才投递下一项，跨进程也保持拓扑顺序。 */
  remainingRefIds?: string[];
}

/** 视频生成任务：submit 提交任务给 Seedance；poll 轮询任务结果（延时自重入，直到 succeeded/failed） */
export type VideoJobData = BillingJobData &
  (
    | { kind: 'submit'; projectId: string; shotId: string; takeId: string; continuous: boolean }
    | {
        kind: 'poll';
        projectId: string;
        shotId: string;
        takeId: string;
        taskId: string;
        attempt: number;
        continuous: boolean;
        /** 首次开始轮询的时间戳，用于 90 分钟超时（与间隔无关） */
        pollStartedAt?: number;
      }
  );

/** FFmpeg 合成任务 */
export interface ComposeJobData {
  projectId: string;
  composeToken: string;
}
