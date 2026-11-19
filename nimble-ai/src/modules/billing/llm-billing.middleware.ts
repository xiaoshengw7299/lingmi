import type { LanguageModelMiddleware } from 'ai';
import { BillingService } from './billing.service';

/**
 * 给文本模型包一层计费：所有走 AtlasLlmService 的调用（对话、脚本、视觉理解、结构化输出）
 * 都经过这里，业务代码不用关心计费。
 * 调用前预检余额，调用后按真实 token 用量结算。userId 在调用前取好，
 * 因为流式响应的结束回调不一定还在原来的异步上下文里。
 */
export function llmBillingMiddleware(billing: BillingService, atlasModel: string): LanguageModelMiddleware {
  return {
    wrapGenerate: async ({ doGenerate }) => {
      await billing.assertLlmPriced(atlasModel);
      const userId = await billing.guardLlm();
      const result = await doGenerate();
      billing.chargeLlm(userId, atlasModel, result.usage);
      return result;
    },
    wrapStream: async ({ doStream }) => {
      await billing.assertLlmPriced(atlasModel);
      const userId = await billing.guardLlm();
      const { stream, ...rest } = await doStream();
      return {
        ...rest,
        stream: stream.pipeThrough(
          new TransformStream({
            transform(part, controller) {
              if (part.type === 'finish') billing.chargeLlm(userId, atlasModel, part.usage);
              controller.enqueue(part);
            },
          }),
        ),
      };
    },
  };
}
