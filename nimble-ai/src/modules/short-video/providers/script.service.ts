import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AtlasLlmService } from '../../atlas/atlas-llm.service';

export interface GenerateScriptOptions {
  /** 由所选配音音色的语言分组换算而来：'zh' | 'yue' | 'en'；未知时按中文处理 */
  language: string;
  /** 期望的段落数（不是硬性字数），用户可通过 scriptPrompt 进一步补充要求 */
  paragraphNumber: number;
  /** 用户对文案风格/角度的补充要求，如"悬疑开头""种草口吻" */
  scriptPrompt?: string;
}

const LANGUAGE_LABEL: Record<string, string> = {
  zh: '简体中文',
  yue: '粤语口语',
  en: 'English',
};

/**
 * 文案与检索词生成（自研，替代原先转发 MoneyPrinterTurbo 的方式）
 *
 * 两次独立 LLM 调用：
 *   1. generateScript —— 按主题写口播文案（自然语言）
 *   2. generateTerms  —— 从文案提炼英文检索关键词（Pexels 素材库以英文标签为主，
 *      即便文案是中文也要出英文词，否则免费素材搜索基本搜不到东西）
 * 结构化输出走 AtlasLlmService.generateJson（Atlas 不允许 system 消息，也不走 json_schema）。
 *
 * 文案生成模型固定走 模型平台API（AtlasLlmService），与智能体聊天共用同一套
 * atlas-models.json llm 分组，保证媒体生产链路稳定可控。
 */
@Injectable()
export class ScriptService {
  constructor(private readonly atlasLlm: AtlasLlmService) {}

  async generateScript(subject: string, opts: GenerateScriptOptions): Promise<string> {
    const languageLabel = LANGUAGE_LABEL[opts.language] ?? LANGUAGE_LABEL.zh;
    const object = await this.atlasLlm.generateJson({
      kind: 'llm',
      schema: z.object({
        script: z.string().describe('完整的短视频口播文案正文，仅口语内容，不含任何标记'),
      }),
      instructions:
        '你是一名经验丰富的短视频文案编导，擅长为短视频撰写抓人眼球、朗朗上口的口播文案。' +
        '要求：1）只输出可以直接念出来的口播内容，不要分镜标号、不要小标题、不要 Markdown、不要表情符号、不要旁白提示（如"（画面）"）；' +
        '2）开头 3 秒必须有强钩子（提问/反常识/悬念/痛点），中段信息密度高、避免空话套话，结尾自然收束；' +
        '3）句子偏短、口语化，像真人说话，不要书面语长句；4）只返回文案正文本身。',
      prompt:
        `创作提示词：${subject}\n` +
        `文案语言：${languageLabel}\n` +
        `期望长度：约 ${opts.paragraphNumber} 段口播内容\n` +
        (opts.scriptPrompt ? `额外要求：${opts.scriptPrompt}\n` : ''),
      maxOutputTokens: 2000,
    });
    return object.script.trim();
  }

  /** Pexels 素材库以英文标签为主，检索词固定生成英文，与文案本身的语言无关 */
  async generateTerms(subject: string, script: string): Promise<string[]> {
    const object = await this.atlasLlm.generateJson({
      kind: 'llm',
      schema: z.object({
        terms: z
          .array(z.string())
          .min(3)
          .max(12)
          .describe('English stock-footage search keywords, 1-3 words each, concrete and visual'),
      }),
      instructions:
        'You extract stock-video search keywords from a short-video script. ' +
        'Return 3-12 concrete, visual, camera-friendly English keywords or short phrases ' +
        '(1-3 words each) that a stock footage site like Pexels can match to real footage. ' +
        'Avoid abstract nouns (e.g. "happiness", "success"); prefer filmable subjects (e.g. "coffee cup", "city street at night").',
      prompt: `Video subject: ${subject}\n\nScript:\n${script}`,
      maxOutputTokens: 500,
    });
    return object.terms;
  }
}
