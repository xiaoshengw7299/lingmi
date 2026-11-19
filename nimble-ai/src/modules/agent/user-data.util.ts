import * as path from 'path';

/** 净化用户标识为文件系统安全字符，避免路径穿越（如 `../`、`/` 等恶意输入） */
export function sanitizeUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
}

/**
 * 用户自学数据目录：`<usersRoot>/<safeUserId>/<subdir>`
 *
 * 统一布局为 `ai/_users/<userId>/{skills,memory}/`，按用户归档而非按数据类型归档，
 * 便于后续查看/迁移/删除某个用户的全部自学数据。由 SkillLoader（技能自学）与
 * MemoryService（持久记忆）共用同一套目录规则。
 */
export function personalDataDir(usersRoot: string, userId: string, subdir: string): string {
  return path.join(usersRoot, sanitizeUserId(userId), subdir);
}
