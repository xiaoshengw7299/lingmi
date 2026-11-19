import * as fs from 'fs';
import * as path from 'path';

/** 用户上传附件在工作目录下的子目录（上传接口、附件摘要、read 工具共用） */
export const UPLOADS_SUBDIR = 'uploads';

/** 某个用户自己的上传目录。附件按用户分目录，read 工具和附件摘要只认当前用户的目录，读不到别人的文件 */
export const userUploadsDir = (workspaceDir: string, userId: string | number) =>
  path.join(workspaceDir, UPLOADS_SUBDIR, String(userId));

/**
 * 把相对/绝对路径解析到允许的根目录之内；越界（绝对路径指向根目录外、`..` 穿越）返回 null。
 * 附件路径来自客户端、read 路径来自模型（可被提示词注入），必须先过这一关才能读文件，
 * 否则任何登录用户都能借智能体读取服务器上的 .env 等敏感文件。
 */
export function resolveWithin(roots: Array<string | undefined>, filePath: string, baseDir: string): string | null {
  const resolved = path.resolve(path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath));
  for (const root of roots) {
    if (!root) continue;
    const rel = path.relative(path.resolve(root), resolved);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return resolved;
  }
  return null;
}

/** 需要二进制解析（而非按行读文本）的 Office/PDF 格式 */
export const BINARY_DOC_EXTS = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls']);

/** 可安全提取为纯文本、适合自动注入对话上下文的文档扩展名（不含图片/视频等媒体文件） */
export const TEXT_DOC_EXTS = new Set([
  '.txt', '.md', '.csv', '.json', '.log', '.yaml', '.yml',
  '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.sql', '.xml',
]);

/**
 * 提取文件纯文本内容。
 * 供 `read` 工具（模型主动读取）与 AgentService（自动摘要注入上下文）共用，避免重复实现。
 * 调用方须先用 resolveWithin 校验路径。
 */
export async function extractFileContent(filePath: string, ext: string): Promise<string> {
  switch (ext) {
    case '.pdf':
      return extractPdf(filePath);
    case '.docx':
      return extractDocx(filePath);
    case '.doc':
      throw new Error('.doc 格式暂不支持，请将文件另存为 .docx 后重试');
    case '.xlsx':
    case '.xls':
      return extractExcel(filePath);
    default:
      return fs.readFileSync(filePath, 'utf-8');
  }
}

async function extractPdf(filePath: string): Promise<string> {
  // pdf-parse v2：导出 PDFParse 类，不再是默认函数
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PDFParse } = require('pdf-parse') as {
    PDFParse: new (opts: { data: Buffer }) => {
      getText: () => Promise<{ text: string }>;
      destroy?: () => Promise<void>;
    };
  };
  const parser = new PDFParse({ data: fs.readFileSync(filePath) });
  try {
    const result = await parser.getText();
    return result.text || '';
  } finally {
    await parser.destroy?.();
  }
}

async function extractDocx(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require('mammoth');
  const { value } = await mammoth.extractRawText({ path: filePath });
  return value;
}

function extractExcel(filePath: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(filePath);

  return workbook.SheetNames.map((sheetName: string) => {
    const rows: string[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: '',
    });

    if (!rows.length) return `## ${sheetName}\n（空表）`;

    // 计算各列最大宽度，保证对齐
    const colCount = Math.max(...rows.map((r) => r.length));
    const colWidths = Array.from({ length: colCount }, (_, ci) =>
      Math.max(...rows.map((r) => String(r[ci] ?? '').length), 1),
    );

    const fmtRow = (row: string[]) =>
      '| ' + colWidths.map((w, ci) => String(row[ci] ?? '').padEnd(w)).join(' | ') + ' |';
    const separator = '| ' + colWidths.map((w) => '-'.repeat(w)).join(' | ') + ' |';

    const [header, ...body] = rows;
    return [`## ${sheetName}`, fmtRow(header), separator, ...body.map(fmtRow)].join('\n');
  }).join('\n\n');
}
