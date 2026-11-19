export const SHORT_VIDEO_QUEUE = 'short-video';

/** 全流程（文案/配音/字幕/素材/合成）都在本进程内完成，不再需要外部轮询，单一 job 跑到底即可 */
export interface ShortVideoJobData {
  taskId: string;
}
