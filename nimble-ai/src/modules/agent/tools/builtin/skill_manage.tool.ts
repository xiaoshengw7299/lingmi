import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { defineTool, toolOk, toolFail } from '../tool.define';

const SKILL_FILENAME = 'SKILL.md';
const MAX_NAME_LENGTH = 64;
const MAX_CONTENT_CHARS = 50_000;
const VALID_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * 技能自学工具 —— 让智能体把摸索出的解决方案沉淀为可复用的技能
 *
 * 只操作"用户专属技能库"（`ai/_users/<userId>/skills/`），不会创建/修改/删除
 * 全局共享技能：即使 name 与全局技能同名，也只是在专属库里新建一份覆盖显示给
 * 该用户，绝不触碰全局文件——因此本工具可以自动生效、无需审核，风险面始终
 * 局限在该用户自己身上。
 *
 * 无 tag，始终可用。description/参数说明/消息用英文——同一套指令在英文表述下
 * 模型执行更稳定，措辞参考 hermes-agent 的 skill_manager_tool.py。
 */
export default defineTool({
  name: 'skill_manage',
  title: '技能管理',
  // 无 tag（始终可用），但仍展示进度块，让用户能感知到"学会了新技能"
  showProgress: true,
  description:
    'Manage your own skills — reusable, step-by-step procedures for recurring task types. Skills are your ' +
    'procedural memory (how to do something); general memory (see the memory tool) is broad and declarative ' +
    '(who/what). This only affects your personal skill library for the current user — it never touches ' +
    'shared/global skills, even when the name collides with one.\n\n' +
    'ACTIONS: create needs name + content (full SKILL.md: YAML frontmatter with name/description + body). ' +
    'patch needs name + old_string + new_string — prefer this to fix an outdated or wrong step in an existing ' +
    'skill. edit needs name + content — full rewrite, only for major overhauls. delete needs name only.\n\n' +
    'CREATE WHEN: a complex, multi-step task (especially one with pitfalls) succeeded and the approach is worth ' +
    'reusing. PATCH WHEN: using a skill and finding a stale or missing step — fix it on the spot. Skip trivial, ' +
    'one-off tasks.',
  parameters: z.object({
    action: z.enum(['create', 'edit', 'patch', 'delete']).describe('Action to perform'),
    name: z
      .string()
      .describe('Skill name (lowercase letters/digits/hyphens/underscores, e.g. my-skill), required for all actions'),
    content: z.string().optional().describe('Full SKILL.md content, required for create/edit'),
    old_string: z.string().optional().describe('Text to find, required for patch, must be unique in the file'),
    new_string: z.string().optional().describe('Replacement text, required for patch (can be an empty string)'),
    replace_all: z.boolean().optional().describe('Allow replacing all matches for patch (default requires a unique match)'),
  }),
  async execute({ action, name, content, old_string, new_string, replace_all }, ctx) {
    const skillLoader = ctx.services.skillLoader;
    if (!skillLoader || !ctx.skillsDir) return toolFail('Skill service is not configured');

    const nameError = validateName(name);
    if (nameError) return toolFail(nameError);

    const skillDir = path.join(skillLoader.personalSkillsDir(ctx.userId), name);
    const skillFile = path.join(skillDir, SKILL_FILENAME);

    if (action === 'create') {
      if (!content) return toolFail("action='create' requires content");
      if (fs.existsSync(skillFile)) return toolFail(`Skill '${name}' already exists. Use edit/patch to modify it.`);
      const err = validateContent(skillLoader, content);
      if (err) return toolFail(err);

      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(skillFile, normalizeNewlines(content), 'utf-8');
      return toolOk(`Skill '${name}' created — effective next turn (visible only to you).`);
    }

    if (action === 'edit') {
      if (!content) return toolFail("action='edit' requires content");
      if (!fs.existsSync(skillFile)) return toolFail(skillNotFoundHint(name));
      const err = validateContent(skillLoader, content);
      if (err) return toolFail(err);

      fs.writeFileSync(skillFile, normalizeNewlines(content), 'utf-8');
      return toolOk(`Skill '${name}' rewritten — effective next turn.`);
    }

    if (action === 'patch') {
      if (!old_string) return toolFail("action='patch' requires old_string");
      if (new_string === undefined) return toolFail("action='patch' requires new_string (can be an empty string)");
      if (!fs.existsSync(skillFile)) return toolFail(skillNotFoundHint(name));

      const current = fs.readFileSync(skillFile, 'utf-8');
      const patched = applyPatch(current, old_string, new_string, !!replace_all);
      if (patched.error) return toolFail(patched.error);

      const err = validateContent(skillLoader, patched.content!);
      if (err) return toolFail(`Patched content is invalid: ${err}`);

      fs.writeFileSync(skillFile, patched.content!, 'utf-8');
      return toolOk(`Skill '${name}' patched (${patched.count} replacement(s)) — effective next turn.`);
    }

    // delete
    if (!fs.existsSync(skillDir)) return toolFail(skillNotFoundHint(name));
    fs.rmSync(skillDir, { recursive: true, force: true });
    return toolOk(`Skill '${name}' deleted.`);
  },
});

function validateName(name: string): string | null {
  if (!name) return 'Skill name is required.';
  if (name.length > MAX_NAME_LENGTH) return `Skill name exceeds ${MAX_NAME_LENGTH} characters.`;
  if (!VALID_NAME_RE.test(name)) {
    return `Invalid skill name '${name}'. Use lowercase letters, digits, hyphens, underscores, or dots.`;
  }
  return null;
}

function validateContent(
  skillLoader: { validateSkillContent: (c: string) => string | null },
  content: string,
): string | null {
  if (content.length > MAX_CONTENT_CHARS) return `Content exceeds the ${MAX_CONTENT_CHARS}-character limit.`;
  return skillLoader.validateSkillContent(content);
}

function skillNotFoundHint(name: string): string {
  return `Skill '${name}' not found in your personal skill library (a same-named global skill, if any, is unaffected). Use create to add it.`;
}

function normalizeNewlines(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** 唯一子串查找替换：多处匹配且未显式 replaceAll 时报错，避免误改 */
function applyPatch(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): { content?: string; error?: string; count: number } {
  const count = content.split(oldString).length - 1;
  if (count === 0) return { error: `No match found for "${oldString}" in the skill file.`, count: 0 };
  if (count > 1 && !replaceAll) {
    return { error: `Found ${count} matches — not unique. Add more context, or set replace_all=true.`, count };
  }
  const next = content.split(oldString).join(newString);
  return { content: next, count };
}
