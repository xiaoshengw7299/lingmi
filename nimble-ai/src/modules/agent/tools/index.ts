/**
 * 工具全量注册表（目录自动扫描，无需手动登记）
 *
 * 按是否带 tag 字段分两类（与所在子目录无强制对应关系）：
 * - 无 tag：低风险内置工具，每次请求始终加载（read/memory/skill_manage）
 * - 有 tag：可选工具组，需请求 toolGroups 显式包含该 tag 才加载（未传 toolGroups = 默认加载全部）
 *
 * 新增工具只需：
 * 1. 在本目录（或任意子目录）新建 `*.tool.ts`
 * 2. 使用 defineTool() 定义并 `export default`
 * 完成，无需在此文件或任何地方手动 import/注册——启动时会自动递归扫描本目录下所有
 * `*.tool.ts`（编译后 `*.tool.js`）文件并收集其默认导出。
 */
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { ToolDef } from './tool.define';

const logger = new Logger('ToolScanner');
const TOOL_FILE_SUFFIX = '.tool.js';

/** 递归扫描目录，收集所有 `*.tool.js` 文件的默认导出（须满足 ToolDef 最小形状） */
function scanTools(dir: string): ToolDef[] {
  const found: ToolDef[] = [];
  if (!fs.existsSync(dir)) return found;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      found.push(...scanTools(fullPath));
      continue;
    }
    if (!entry.name.endsWith(TOOL_FILE_SUFFIX)) continue;

    // 运行时按目录扫描 dist 里的 *.tool.js，必须同步 require；换成静态 import 就失去了"新增文件即生效"
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(fullPath);
    const toolDef: ToolDef | undefined = mod?.default;
    if (toolDef?.name && typeof toolDef.execute === 'function') {
      found.push(toolDef);
    } else {
      logger.warn(`Skipped invalid tool file (missing default ToolDef export): ${fullPath}`);
    }
  }

  return found;
}

/** 所有工具集合，由 AgentModule 在初始化时统一注册 */
export const allTools: ToolDef[] = scanTools(__dirname);

// ─── 类型 & 辅助导出 ───────────────────────────────────────────
export { defineTool, toolOk, toolBi, toolFail } from './tool.define';
// BiBlock 不在此导出（避免与 content-block 中的同名类型冲突，需要时从 './tool.define' 直接导入）
export type { ToolDef, ToolExecuteCtx, ToolServices, ToolResult } from './tool.define';
export { ToolRegistry } from './tool.registry';
export type { ToolFilter } from './tool.registry';
