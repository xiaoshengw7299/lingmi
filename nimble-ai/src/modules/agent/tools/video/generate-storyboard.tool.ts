import { z } from 'zod';
import { defineTool, toolBi, toolFail } from '../tool.define';

const referenceNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((name) => !/[\s,，。!！?？、@：:；;（）()【】[\]“”"'‘’]/.test(name), {
    message: '名称不能包含空格、@ 或句读标点',
  });

const assetSchema = z.object({
  name: referenceNameSchema.describe('唯一主体名称，用于通过 "@名称" 引用，如"白连衣裙""女模特""灰棚""片尾曲"；同一主体不得按角度拆成多条，也不得做成宫格拼贴'),
  prompt: z
    .string()
    .default('')
    .describe(
      '可直接交付图片模型的完整提示词，生成一张独立完整图。禁止四宫格、分屏、拼贴、产品墙。' +
        '不混入分镜动作；场景必须为空场、不得生成人物。若该素材来自 uploadedFilePath，可留空或简述用途',
    ),
  uploadedFilePath: z
    .string()
    .optional()
    .describe(
      '若该素材应直接复用用户在对话中已上传的附件，填写附件路径（与 [用户附件] 列表中的路径完全一致，如 "uploads/xxx.png"）。' +
        '支持图片、视频与音频：系统按文件内容自动识别类型并转存，图片作参考图、视频作参考视频、音频作参考音频，均不会再用模型重新生成。' +
        '参考视频与参考音频单段需为 2–30 秒',
    ),
});

const shotSchema = z.object({
  name: referenceNameSchema.optional().describe('稳定名称；仅一条时用「成片」或产品名，不要用分镜1/2/3暗示再拆。缺省时后端按顺序自动生成'),
  videoPrompt: z
    .string()
    .describe(
      '视频提示词（正文中文；字段名可保留英文）。一条工作台分镜对应一次生成：' +
        '用 [Shot 1]/[Shot 2] 于 00:mm.sss 在片内切换场景，不要为此再拆多条 shots。' +
        '必须用 "@名称" 引用本分镜需要的素材（与 assets 名称完全一致），图片、视频、音频素材统一用 @ 引用，' +
        '不要手写 Picture/Video/Audio 或 图片/视频/音频 编号标签。' +
        '推荐含 integrated_multimodal_description、overall_soundscape、non_diegetic_music；多参考素材时再补主体与保留说明。',
    ),
  durationSec: z.number().int().min(4).max(30).optional().describe('目标时长（秒），默认 15；Seedance 2.5 最长 30，其它模型生成时会按上限钳制'),
  ratio: z
    .enum(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'])
    .optional()
    .describe('该分镜画幅。通常与整片 ratio 相同；不传则用整片画幅'),
});

export default defineTool({
  name: 'generate_storyboard',
  title: '生成视频分镜脚本',
  tag: 'video_gen',
  description:
    '根据用户的视频制作需求，生成独立素材库 + 结构化分镜提示词，并落库创建视频制作项目。' +
    '默认 15 秒、1 个工作台分镜；总长 16–30 秒才拆成 2 条均分。多场景写进同一条 videoPrompt 的 [Shot N] 时间线。' +
    '调用前完成需求拆解；涉及具体产品/品牌/卖点时只采用用户提供的信息，再一次性提交完整脚本。',
  parameters: z.object({
    title: z.string().describe('视频项目标题（简短概括，15字以内）'),
    requirement: z.string().describe('对用户原始需求的简要总结（用于后续在工作台展示）'),
    assets: z
      .array(assetSchema)
      .describe(
        '独立素材。图片一个主体一张完整图，禁止宫格/拼贴，只创建需要锁定一致性的产品、模特、空场场景等；' +
          '用户上传的参考视频、背景音乐等音视频附件也在这里登记（填 uploadedFilePath）',
      ),
    ratio: z
      .enum(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'])
      .optional()
      .describe('整片画幅，写入各分镜。电商信息流默认 9:16；用户明确要横屏时用 16:9。不传则生成时回退为当前视频模型的默认画幅'),
    shots: z
      .array(shotSchema)
      .min(1)
      .describe(
        '工作台分镜列表（一次视频生成任务一项）。≤15 秒必须 1 条；16–30 秒 2 条均分（20 秒→10+10）。' +
          '片内场景切换写在 videoPrompt 的 [Shot N] 时间线里，不要为每个动作单开一条。',
      ),
  }),
  async execute({ title, requirement, assets, ratio, shots }, ctx) {
    const videoService = ctx.services.videoService;
    if (!videoService) return toolFail('视频制作服务不可用');

    try {
      const project = await videoService.createFromStoryboard({
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        title,
        requirement,
        assets,
        ratio,
        shots,
      });

      const content =
        `已生成分镜脚本《${project.title}》，共 ${project.shots.length} 个分镜、${project.assets.length} 个素材。` +
        `请先在右侧工作台审核素材与提示词，再生成视频。`;

      return toolBi(content, {
        tag: 'video-storyboard',
        title: project.title,
        data: {
          projectId: project.id,
          title: project.title,
          shotCount: project.shots.length,
          assetCount: project.assets.length,
        },
      });
    } catch (error) {
      return toolFail(`分镜脚本生成失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});
