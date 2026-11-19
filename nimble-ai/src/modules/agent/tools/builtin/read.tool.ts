import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { defineTool, toolOk, toolFail, ToolExecuteCtx } from '../tool.define';
import { BINARY_DOC_EXTS, extractFileContent, resolveWithin, userUploadsDir } from '../../file-content.util';

export default defineTool({
  name: 'read',
  title: '文件读取',
  description:
    '读取技能文档（SKILL.md 及其 references/）或用户上传的附件内容；其它路径无权访问。支持文本文件（txt/md/json 等）及 Office/PDF 格式（docx/pdf/xlsx/xls）。' +
    '文本文件支持 offset/limit 按行范围读取；Office/PDF 提取全文（offset/limit 对这些格式无效）。' +
    '.doc 格式不支持，请提示转换为 .docx 后使用。',
  parameters: z.object({
    path: z.string().describe('文件路径（技能文档用 <location> 给出的路径；附件用消息里给出的相对路径，如 uploads/xxx.pdf）'),
    offset: z.number().optional().describe('起始行号（从1开始，仅文本文件有效）'),
    limit: z.number().optional().describe('读取的行数（仅文本文件有效）'),
  }),
  async execute({ path: filePath, offset, limit }, ctx) {
    const resolved = resolveWithin(readableRoots(ctx), filePath, ctx.workspaceDir || process.cwd());
    if (!resolved) return toolFail(`无权读取该路径: ${filePath}（仅限技能文档和用户上传的附件）`);

    if (!fs.existsSync(resolved)) return toolFail(`文件不存在: ${filePath}`);
    if (fs.statSync(resolved).isDirectory()) return toolFail(`路径是一个目录: ${filePath}`);

    const ext = path.extname(resolved).toLowerCase();

    try {
      const content = await extractFileContent(resolved, ext);
      const lines = content.split('\n');

      if (BINARY_DOC_EXTS.has(ext)) {
        const numbered = lines.map((l, i) => `${String(i + 1).padStart(6)}|${l}`).join('\n');
        return toolOk(numbered, { totalLines: lines.length });
      }

      const start = Math.max(0, (offset || 1) - 1);
      const end = limit ? start + limit : lines.length;
      const selected = offset || limit ? lines.slice(start, end) : lines;
      const numbered = selected
        .map((l, i) => `${String(start + i + 1).padStart(6)}|${l}`)
        .join('\n');

      return toolOk(numbered, {
        totalLines: lines.length,
        startLine: start + 1,
        endLine: Math.min(end, lines.length),
      });
    } catch (err) {
      return toolFail(`文件解析失败: ${(err as Error).message}`);
    }
  },
});

/** 允许读取的根目录：全局技能库、当前用户自己的专属技能库、上传附件目录（不含他人数据） */
function readableRoots(ctx: ToolExecuteCtx): Array<string | undefined> {
  return [
    ctx.skillsDir,
    ctx.services.skillLoader?.personalSkillsDir(ctx.userId),
    ctx.workspaceDir ? userUploadsDir(ctx.workspaceDir, ctx.userId) : undefined,
  ];
}
