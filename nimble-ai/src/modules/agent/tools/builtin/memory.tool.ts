import { z } from 'zod';
import { defineTool, toolOk, toolFail } from '../tool.define';

/**
 * 持久记忆工具 —— 让智能体在对话中主动积累关于用户/环境的长期认知
 *
 * 按 userId 隔离，每个用户独立存储，跨会话持久生效：
 *   target=user   记住这个用户是谁（偏好、习惯、身份等）
 *   target=memory 记住和这个用户打交道时学到的经验/事实（环境信息、约定等）
 *
 * 无 tag，始终可用（低风险、只影响当前用户自己的数据）。
 * description/参数说明用英文——同一套指令在英文表述下模型执行更稳定，做法参考 hermes-agent。
 */
export default defineTool({
  name: 'memory',
  title: '记忆管理',
  // 无 tag（始终可用，不受 toolGroups 过滤），但仍展示进度块，让用户能感知到"被记住了"
  showProgress: true,
  description:
    'Save durable facts to persistent memory. Entries are injected into every future turn, so keep them ' +
    'compact and high-signal.\n\n' +
    'WHEN: save proactively when the user states a preference, correction, or personal detail, or you learn ' +
    "a stable fact about their environment, conventions, or workflow. Skip trivial, one-off, or easily " +
    're-discovered info — reusable procedures belong in a skill (see skill_manage), not memory.\n\n' +
    'TARGETS: user = who the user is (name, role, preferences, communication style). memory = your own notes ' +
    '(environment facts, conventions, lessons learned).\n\n' +
    'ACTIONS: add needs content. replace needs old_text (an exact substring of the existing entry) + content. ' +
    'remove needs old_text.\n\n' +
    'IF FULL: the write is rejected and current entries are returned — consolidate with replace/remove first, ' +
    'then retry.',
  parameters: z.object({
    action: z.enum(['add', 'replace', 'remove']).describe('Action to perform'),
    target: z.enum(['memory', 'user']).default('memory').describe('Which memory store to use'),
    content: z.string().optional().describe('Entry content, required for add/replace'),
    old_text: z.string().optional().describe('Exact substring of the entry to modify, required for replace/remove'),
  }),
  async execute({ action, target, content, old_text }, ctx) {
    const memoryService = ctx.services.memoryService;
    if (!memoryService) return toolFail('Memory service is not configured');

    if (action === 'add' && !content) return toolFail("action='add' requires content");
    if (action === 'replace' && (!old_text || !content)) {
      return toolFail("action='replace' requires both old_text and content");
    }
    if (action === 'remove' && !old_text) return toolFail("action='remove' requires old_text");

    const result =
      action === 'add'
        ? await memoryService.add(ctx.userId, target, content!)
        : action === 'replace'
          ? await memoryService.replace(ctx.userId, target, old_text!, content!)
          : await memoryService.remove(ctx.userId, target, old_text!);

    return result.success ? toolOk(JSON.stringify(result)) : toolFail(JSON.stringify(result));
  },
});
