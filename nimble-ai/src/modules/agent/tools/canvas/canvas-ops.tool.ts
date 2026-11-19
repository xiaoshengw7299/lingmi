import { z } from 'zod';
import { defineTool, toolBi } from '../tool.define';

const NODE_TYPES = ['image', 'video', 'audio', 'text'] as const;

/** 节点引用：已有节点 id，或本次操作里 add_node 声明的 ref */
const nodeRef = z.string().min(1);

const opSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_node'),
    ref: nodeRef.describe('本次操作内的临时名称，供后续 connect / generate 引用，如 "n1"'),
    type: z.enum(NODE_TYPES),
    title: z.string().max(40).optional(),
    prompt: z.string().max(4000).optional().describe('生成指令；图片/视频是画面描述，音频是要朗读的文字，文本节点是让 AI 写什么'),
    text: z.string().max(8000).optional().describe('仅文本节点：直接写入的正文（笔记、分镜文案等）'),
    ratio: z.string().optional().describe('画面比例，如 16:9 / 9:16 / 1:1'),
    durationSec: z.number().int().min(1).max(30).optional().describe('仅视频节点：时长（秒）'),
  }),
  z.object({
    op: z.literal('connect'),
    from: nodeRef.describe('参考来源节点'),
    to: nodeRef.describe('被生成的节点；from 的内容会作为它的参考素材'),
  }),
  z.object({
    op: z.literal('update_node'),
    node: nodeRef,
    title: z.string().max(40).optional(),
    prompt: z.string().max(4000).optional(),
    text: z.string().max(8000).optional(),
  }),
  z.object({
    op: z.literal('generate'),
    node: nodeRef.describe('立即触发该节点生成（会扣费）；仅在用户明确要求出图/出片时使用'),
  }),
]);

export default defineTool({
  name: 'canvas_ops',
  title: '操作无限画布',
  tag: 'canvas',
  description:
    '在用户当前的无限画布上创建/修改节点、连线、触发生成。操作按顺序在用户浏览器里执行，' +
    '节点之间的连线表示"from 是 to 的参考素材"（图片/视频/音频作参考，文本作上下文）。' +
    '当前画布状态见对话里的【画布状态】；每次请求最多调用一次，把需要的全部操作放进 ops。',
  parameters: z.object({
    ops: z.array(opSchema).min(1).max(40).describe('按执行顺序排列的操作列表'),
    summary: z.string().max(200).describe('一句话告诉用户做了什么'),
  }),
  /** 真正的执行在浏览器：画布状态只存在前端，这里只把操作原样下发（引用是否有效由前端校验并忽略无效项） */
  async execute({ ops, summary }) {
    return toolBi(summary, { tag: 'canvas-ops', title: '画布操作', data: { ops } });
  },
});
