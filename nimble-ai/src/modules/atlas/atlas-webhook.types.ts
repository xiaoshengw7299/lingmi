/**
 * 本地曾经把「自己不再等」写成失败。这类记录 Atlas 仍可能成功，回调和对账要能把结果补回来。
 * 补写时不能再退款：钱只在 Atlas 返回 failed / timeout / cancelled 时退。
 */
export const isAtlasTimeoutError = (error?: string | null): boolean => (error ?? '').includes('生成超时');

/**
 * 模型平台API webhook 到达后需要认领处理的业务处理器。
 *
 * 设计为"触发即时轮询"而不是直接解析 webhook payload 落库：webhook 与轮询最终都要拿到同一个
 * `GET /model/prediction/{id}` 结果，让两条路径共用同一套"解析结果并落库"的既有代码（VideoService.pollShotVideoTask
 * 等），避免维护两套状态机、也避免 webhook 与轮询并发写入同一条记录产生竞态。webhook 只是把"下一次轮询"提前触发。
 */
export interface AtlasWebhookHandler {
  /** 仅用于日志排查 */
  readonly name: string;
  /**
   * 尝试认领并处理该 sessionId（即提交任务时拿到的 taskId）。
   * 返回 true 表示这个任务归属于本处理器（不论此次是否真的触发了动作，例如任务已处理完的重复投递），
   * 分发器据此判断是否需要继续尝试下一个处理器。
   */
  tryHandle(sessionId: string): Promise<boolean>;
  /** 进程重启或本地等待已经交棒后，把仍未终态的任务再查一遍。没有则省略。 */
  sweep?(): Promise<void>;
}
