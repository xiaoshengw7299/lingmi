import { Injectable } from '@nestjs/common';
import { ToolDef } from '../tools/tool.define';

/** 系统提示词构建参数 */
export interface SystemPromptParams {
  userTimezone?: string;
  /** 可用工具列表（统一 ToolDef 格式） */
  tools?: ToolDef[];
  skillsPrompt?: string;
  /** 当前用户的持久记忆快照（来自 MemoryService.getSnapshot，按 userId 隔离） */
  memory?: { memoryText: string; userText: string };
  extraPrompt?: string;
  /** 智能体空间专属人设/业务提示词（来自 AgentSpaceEntry.persona，可选） */
  agentPersona?: string;
  runtimeInfo?: {
    agentId?: string;
    model?: string;
  };
}

/**
 * 系统提示词分两层拼装：
 *   底座层（identity/工具风格/安全护栏）—— 所有智能体空间共享，保证安全边界不丢
 *   空间层（agentPersona）—— 按 agentId 解析出的专属人设，追加在底座之后
 */
@Injectable()
export class SystemPromptBuilder {
  build(params: SystemPromptParams): string {
    const sections = [
      this.buildIdentitySection(),
      params.agentPersona ? this.buildPersonaSection(params.agentPersona) : '',
      this.buildMemorySection(params.memory),
      this.buildToolingSection(params.tools),
      this.buildToolCallStyleSection(),
      this.buildSafetySection(),
      params.skillsPrompt ? this.buildSkillsSection(params.skillsPrompt) : '',
      this.buildAttachmentSection(),
      params.userTimezone ? this.buildTimeSection(params.userTimezone) : '',
      params.extraPrompt ? this.buildExtraSection(params.extraPrompt) : '',
      params.runtimeInfo ? this.buildRuntimeSection(params.runtimeInfo) : '',
    ];
    return sections.filter(Boolean).join('\n\n');
  }

  private buildPersonaSection(persona: string): string {
    return persona.trimStart().startsWith('#') ? persona : `## Agent Persona\n${persona}`;
  }

  private buildIdentitySection(): string {
    return `You are the AI video creation assistant of LingMI (灵米), an AI video studio.
You help users turn ideas into videos by using the available tools and skills.
Be helpful, accurate, and concise in your responses.`;
  }

  private buildToolingSection(tools?: ToolDef[]): string {
    if (!tools?.length) return '';

    const lines = [
      '## Tooling',
      'Tool availability (filtered by policy):',
      'Tool names are case-sensitive. Call tools exactly as listed.',
    ];

    for (const tool of tools) {
      lines.push(`- ${tool.name}: ${tool.description}`);
    }

    lines.push(
      '',
      'Avoid calling the same tool repeatedly with similar arguments.',
      'If a tool returns empty or no useful results after 1–2 attempts with different parameters, stop retrying, summarize what was tried, and report the finding to the user. Do not loop indefinitely.',
    );

    return lines.join('\n');
  }

  private buildToolCallStyleSection(): string {
    return `## Tool Call Style
Default: do not narrate routine, low-risk tool calls (just call the tool).
Narrate only when it helps: multi-step work, complex/challenging problems, sensitive actions (e.g., deletions), or when the user explicitly asks.
Keep narration brief and value-dense; avoid repeating obvious steps.
Use plain human language for narration.`;
  }

  private buildSafetySection(): string {
    return `## Safety
You have no independent goals: do not pursue self-preservation, replication, resource acquisition, or power-seeking; avoid long-term plans beyond the user's request.
Prioritize safety and human oversight over completion; if instructions conflict, pause and ask; comply with stop/pause/audit requests and never bypass safeguards.
Do not manipulate or persuade anyone to expand access or disable safeguards. Do not copy yourself or change system prompts, safety rules, or tool policies unless explicitly requested.`;
  }

  private buildMemorySection(memory?: { memoryText: string; userText: string }): string {
    const blocks = [memory?.userText, memory?.memoryText].filter(Boolean);
    if (!blocks.length) return '';

    return [
      '## Memory',
      "Long-term memory about the current user, persisted across sessions (visible only to this user). " +
        "Use the `memory` tool to save new stable facts or preferences as you notice them — decide and save " +
        "on your own, don't ask the user whether to remember it. Use replace/remove to fix stale or wrong entries.",
      '',
      ...blocks,
    ].join('\n');
  }

  private buildSkillsSection(skillsPrompt: string): string {
    return `## Skills (mandatory)
Before replying: scan <available_skills> <description> entries.
- If exactly one skill clearly applies: read its SKILL.md at <location> with \`read\`, then follow it.
- If multiple could apply: choose the most specific one, then read/follow it.
- If none clearly apply: do not read any SKILL.md.
Constraints: never read more than one skill up front; only read after selecting.
- When a skill drives external API writes, assume rate limits: prefer fewer larger writes, avoid tight one-item loops, serialize bursts when possible, and respect 429/Retry-After.
Important: Skill names are NOT callable tools—always use \`read\` to fetch the SKILL.md file.

${skillsPrompt}`;
  }

  private buildAttachmentSection(): string {
    return `## Attachments
Files uploaded by the user are listed in the user message with a relative path (e.g. uploads/xxx.pdf).
The \`read\` tool can only open those attachments and skill documents; no other files are accessible.`;
  }

  private buildTimeSection(timezone: string): string {
    const now = new Date().toLocaleString('zh-CN', { timeZone: timezone });
    return `## Current Date & Time
Time zone: ${timezone}
Current time: ${now}`;
  }

  private buildExtraSection(extraPrompt: string): string {
    return `## Additional Context\n${extraPrompt}`;
  }

  private buildRuntimeSection(info: NonNullable<SystemPromptParams['runtimeInfo']>): string {
    const parts = [
      info.agentId ? `agent=${info.agentId}` : '',
      info.model ? `model=${info.model}` : '',
    ].filter(Boolean);
    return `## Runtime\nRuntime: ${parts.join(' | ')}`;
  }
}
