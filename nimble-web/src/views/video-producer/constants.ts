/** 素材/分镜/合成状态的统一中文文案，供 StatusTag 展示和工作台上下文摘要文本复用 */
export const MEDIA_STATUS_LABEL: Record<string, string> = {
  idle: '待生成',
  draft: '待生成',
  queued: '排队中',
  generating: '生成中',
  composing: '合成中',
  success: '已完成',
  done: '已完成',
  failed: '失败',
}
