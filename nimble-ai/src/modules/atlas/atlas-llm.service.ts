import { createOpenAI } from '@ai-sdk/openai';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateText, LanguageModel, wrapLanguageModel } from 'ai';
import { z } from 'zod';
import { BillingService } from '../billing/billing.service';
import { llmBillingMiddleware } from '../billing/llm-billing.middleware';
import { AtlasModelRegistryService } from './atlas-model-registry.service';

/**
 * 文本和视觉理解。当前走火山方舟的 OpenAI 兼容接口。
 * 结构化输出仍用 generateJson：把说明拼进消息，不依赖 json_schema。
 * system 消息会并进第一条 user，避免个别网关拒绝 system。
 */
@Injectable()
export class AtlasLlmService {
  private readonly logger = new Logger(AtlasLlmService.name);
  private readonly apiKey: string;
  private readonly baseURL: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly modelConfig: AtlasModelRegistryService,
    private readonly billing: BillingService,
  ) {
    this.apiKey = this.configService.get<string>('ARK_API_KEY', '');
    this.baseURL = this.configService.get<string>('ARK_BASE_URL', 'https://ark.cn-beijing.volces.com/api/v3');
  }

  private client() {
    if (!this.apiKey) throw new Error('未配置 ARK_API_KEY，无法调用文本模型');
    return createOpenAI({
      baseURL: this.baseURL,
      apiKey: this.apiKey,
      fetch: async (url, init) => {
        if (init?.body && typeof init.body === 'string') {
          init = { ...init, body: rewriteAtlasChatBody(init.body) };
        }
        return globalThis.fetch(url, init);
      },
    });
  }

  /** 纯文本场景；结构化输出请用 generateJson({ kind: 'llm' }) */
  text(modelId?: string): LanguageModel {
    return this.billed(this.modelConfig.resolveTextModel('llm', modelId).model);
  }

  /** 多模态图片理解；结构化输出请用 generateJson({ kind: 'vision' }) */
  vision(modelId?: string): LanguageModel {
    return this.billed(this.modelConfig.resolveTextModel('vision', modelId).model);
  }

  /** 所有文本模型调用的统一出口：包上计费中间件，业务代码不用关心扣费 */
  private billed(atlasModel: string): LanguageModel {
    return wrapLanguageModel({
      model: this.client().chat(atlasModel),
      middleware: llmBillingMiddleware(this.billing, atlasModel),
    });
  }

  /**
   * Atlas 结构化输出唯一入口：不走 json_schema。
   * `prompt` 与 `messages` 二选一。
   *
   * 提示用「实例形状」而不是完整 JSON Schema——后者会被视觉/文本模型原样回显，
   * 校验时全部字段变成 undefined。解析失败会先本地修补（枚举别名、缺字段默认值），
   * 再带着校验错误重试一次，避免脚本生成被一次非法 type 整单打挂。
   */
  async generateJson<T>(opts: {
    kind: 'llm' | 'vision';
    schema: z.ZodType<T>;
    instructions: string;
    prompt?: string;
    messages?: Parameters<typeof generateText>[0]['messages'];
    maxOutputTokens?: number;
    temperature?: number;
    modelId?: string;
  }): Promise<T> {
    const shape = jsonShapeHint(opts.schema);
    const instructions =
      `${opts.instructions.trim()}\n\n只输出一个 JSON 对象（实例数据，不要返回 JSON Schema）。` +
      `不要 markdown 代码块，不要解释。枚举字段必须使用形状里列出的可选值之一。字段形状：\n${shape}`;
    try {
      return hydrateJson(await this.complete(opts, instructions), opts.schema);
    } catch (error) {
      if (!isJsonShapeError(error)) throw error;
      this.logger.warn(`结构化输出校验失败，重试一次: ${formatJsonError(error)}`);
      const retry =
        `${instructions}\n\n上次输出未通过校验：${formatJsonError(error)}\n请按字段形状重新输出合法 JSON 实例。`;
      return hydrateJson(await this.complete(opts, retry), opts.schema);
    }
  }

  private async complete(
    opts: {
      kind: 'llm' | 'vision';
      prompt?: string;
      messages?: Parameters<typeof generateText>[0]['messages'];
      maxOutputTokens?: number;
      temperature?: number;
      modelId?: string;
    },
    instructions: string,
  ): Promise<string> {
    const model = opts.kind === 'vision' ? this.vision(opts.modelId) : this.text(opts.modelId);
    const { text } = opts.messages?.length
      ? await generateText({
          model,
          instructions,
          messages: opts.messages,
          maxOutputTokens: opts.maxOutputTokens,
          temperature: opts.temperature,
        })
      : await generateText({
          model,
          instructions,
          prompt: opts.prompt ?? '',
          maxOutputTokens: opts.maxOutputTokens,
          temperature: opts.temperature,
        });
    return text;
  }
}

/**
 * Atlas chat/completions 允许的顶层字段。
 * AI SDK 还会塞 OpenAI Responses 专用字段（如 store / metadata），原样转发会 400。
 * 智能体 ToolLoopAgent 依赖 tools / tool_choice，必须保留。
 */
const ATLAS_CHAT_KEYS = new Set([
  'model',
  'messages',
  'max_tokens',
  'temperature',
  'top_p',
  'top_k',
  'min_p',
  'frequency_penalty',
  'presence_penalty',
  'repetition_penalty',
  'seed',
  'logit_bias',
  'stop',
  'n',
  'stream',
  'stream_options',
  'user',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
]);

/** AI SDK 的 chat() 会把 instructions 写成 system；Atlas 只收 user/assistant，把系统提示拼进第一条 user */
function rewriteAtlasChatBody(body: string): string {
  try {
    const payload = JSON.parse(body) as Record<string, unknown>;
    if (payload.max_completion_tokens != null && payload.max_tokens == null) {
      payload.max_tokens = payload.max_completion_tokens;
    }
    const messages = payload.messages;
    if (Array.isArray(messages)) {
      const systemTexts: string[] = [];
      const rest: Array<{ role?: string; content?: unknown }> = [];
      for (const raw of messages) {
        const msg = raw as { role?: string; content?: unknown };
        if (msg.role === 'system' || msg.role === 'developer') {
          const text = flattenMessageContent(msg.content);
          if (text) systemTexts.push(text);
        } else {
          rest.push(msg);
        }
      }
      if (systemTexts.length) {
        const prefix = systemTexts.join('\n\n');
        const firstUser = rest.find((m) => m.role === 'user');
        if (firstUser) {
          firstUser.content = prependTextContent(firstUser.content, prefix);
        } else {
          rest.unshift({ role: 'user', content: prefix });
        }
      }
      payload.messages = rest;
    }
    const cleaned: Record<string, unknown> = {};
    for (const key of ATLAS_CHAT_KEYS) {
      if (payload[key] !== undefined) cleaned[key] = payload[key];
    }
    return JSON.stringify(cleaned);
  } catch {
    return body;
  }
}

function prependTextContent(content: unknown, prefix: string): unknown {
  if (typeof content === 'string') return `${prefix}\n\n${content}`;
  if (Array.isArray(content)) return [{ type: 'text', text: prefix }, ...content];
  return [{ type: 'text', text: prefix }];
}

function flattenMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part) return String((part as { text?: unknown }).text ?? '');
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function jsonShapeHint(schema: z.ZodType): string {
  try {
    const json = z.toJSONSchema(schema) as Record<string, unknown>;
    return JSON.stringify(shapeFromJsonSchema(json, json));
  } catch {
    return '{}';
  }
}

function shapeFromJsonSchema(schema: unknown, root: Record<string, unknown>): unknown {
  if (!schema || typeof schema !== 'object') return null;
  const raw = schema as Record<string, unknown>;
  const s = resolveJsonRef(raw, root);
  if (Array.isArray(s.enum)) return s.enum.join('|');
  const alts = (Array.isArray(s.anyOf) ? s.anyOf : Array.isArray(s.oneOf) ? s.oneOf : null) as unknown[] | null;
  if (alts?.length) {
    const useful = alts.filter((item) => {
      if (!item || typeof item !== 'object') return true;
      return (item as { type?: unknown }).type !== 'null';
    });
    if (useful.length === 1) return shapeFromJsonSchema(useful[0], root);
  }
  const type = s.type;
  if (type === 'object' || s.properties) {
    const props = (s.properties ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) out[key] = shapeFromJsonSchema(value, root);
    return out;
  }
  if (type === 'array') return [shapeFromJsonSchema(s.items, root)];
  if (type === 'integer' || type === 'number') return 1;
  if (type === 'boolean') return true;
  return 'string';
}

function resolveJsonRef(schema: Record<string, unknown>, root: Record<string, unknown>): Record<string, unknown> {
  const ref = schema.$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return schema;
  let cur: unknown = root;
  for (const part of ref.slice(2).split('/')) {
    if (!cur || typeof cur !== 'object') return schema;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur && typeof cur === 'object' ? (cur as Record<string, unknown>) : schema;
}

export function parseJsonObject(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型未返回 JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function hydrateJson<T>(text: string, schema: z.ZodType<T>): T {
  const raw = parseJsonObject(text);
  const candidates = jsonCandidates(raw);
  let lastError: z.ZodError | undefined;
  for (const candidate of candidates) {
    let current = candidate;
    for (let i = 0; i < 3; i++) {
      const parsed = schema.safeParse(current);
      if (parsed.success) return parsed.data;
      lastError = parsed.error;
      current = repairJsonForSchema(current, parsed.error);
    }
  }
  throw lastError ?? new Error('模型未返回 JSON');
}

function jsonCandidates(raw: unknown): unknown[] {
  const out: unknown[] = [];
  const push = (value: unknown) => {
    if (value != null && !out.includes(value)) out.push(value);
  };
  if (!looksLikeJsonSchema(raw)) push(raw);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    for (const key of ['result', 'data', 'output', 'json', 'analysis', 'productAnalysis', 'object', 'payload']) {
      if (key in obj && !looksLikeJsonSchema(obj[key])) push(obj[key]);
    }
    if (!looksLikeJsonSchema(raw)) {
      const nested = Object.values(obj).filter((value) => value && typeof value === 'object' && !Array.isArray(value) && !looksLikeJsonSchema(value));
      if (nested.length === 1) push(nested[0]);
    }
  }
  if (!out.length) push(raw);
  return out;
}

function looksLikeJsonSchema(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return obj.$schema != null || (obj.type === 'object' && obj.properties != null && obj.required != null);
}

function repairJsonForSchema(data: unknown, error: z.ZodError): unknown {
  const clone: unknown = data == null ? {} : structuredClone(data);
  for (const issue of error.issues) {
    const expected = 'expected' in issue ? String((issue as { expected?: unknown }).expected ?? '') : '';
    const values = 'values' in issue && Array.isArray((issue as { values?: unknown[] }).values)
      ? (issue as { values: unknown[] }).values.filter((item): item is string => typeof item === 'string')
      : [];
    if (issue.code === 'invalid_value' && values.length) {
      setPath(clone, issue.path, coerceEnumValue(getPath(clone, issue.path), values));
      continue;
    }
    if (issue.code === 'invalid_type') {
      if (expected === 'string') setPath(clone, issue.path, stringifyUnknown(getPath(clone, issue.path)));
      else if (expected === 'array') setPath(clone, issue.path, Array.isArray(getPath(clone, issue.path)) ? getPath(clone, issue.path) : []);
      else if (expected === 'object') setPath(clone, issue.path, getPath(clone, issue.path) && typeof getPath(clone, issue.path) === 'object' ? getPath(clone, issue.path) : {});
      else if (expected === 'number' || expected === 'int' || expected === 'integer') {
        const num = Number(getPath(clone, issue.path));
        setPath(clone, issue.path, Number.isFinite(num) ? num : 0);
      } else if (expected === 'boolean') {
        const cur = getPath(clone, issue.path);
        setPath(clone, issue.path, cur === true || cur === 'true' || cur === 1 || cur === '1');
      }
      continue;
    }
    if (issue.code === 'too_big') {
      const maximum = Number((issue as { maximum?: unknown }).maximum);
      const cur = getPath(clone, issue.path);
      if (Array.isArray(cur) && Number.isFinite(maximum)) setPath(clone, issue.path, cur.slice(0, maximum));
      else if (typeof cur === 'string' && Number.isFinite(maximum)) setPath(clone, issue.path, cur.slice(0, maximum));
    }
  }
  return clone;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

const ENUM_ALIASES: Record<string, string> = {
  opening: 'hook',
  intro: 'hook',
  hook_shot: 'hook',
  钩子: 'hook',
  开场: 'hook',
  pain: 'pain_point',
  problem: 'pain_point',
  painpoint: 'pain_point',
  痛点: 'pain_point',
  reveal: 'product_reveal',
  product: 'product_reveal',
  showcase: 'product_reveal',
  unboxing: 'product_reveal',
  productreveal: 'product_reveal',
  产品登场: 'product_reveal',
  开箱: 'product_reveal',
  demonstration: 'demo',
  usage: 'demo',
  feature: 'demo',
  benefit: 'demo',
  howto: 'demo',
  how_to: 'demo',
  演示: 'demo',
  展示: 'demo',
  comparison: 'demo',
  scene: 'demo',
  story: 'demo',
  talking_head: 'demo',
  proof: 'social_proof',
  testimonial: 'social_proof',
  review: 'social_proof',
  social: 'social_proof',
  口碑: 'social_proof',
  评价: 'social_proof',
  call_to_action: 'cta',
  ending: 'cta',
  close: 'cta',
  outro: 'cta',
  引导: 'cta',
  下单: 'cta',
  pacing: '节奏',
  rhythm: '节奏',
  spoken: '口语',
  oral: '口语',
  creative: '创意',
  structure: '结构',
  must: 'invariant',
  hard: 'invariant',
  required: 'invariant',
  suggest: 'default',
  recommended: 'default',
  prefer: 'taste',
  preference: 'taste',
};

function coerceEnumValue(raw: unknown, allowed: string[]): string {
  const text = String(raw ?? '').trim();
  const normalized = text.toLowerCase().replace(/[\s-]+/g, '_');
  const exact = allowed.find((item) => item === text || item.toLowerCase() === normalized);
  if (exact) return exact;
  const aliased = ENUM_ALIASES[normalized] ?? ENUM_ALIASES[text];
  if (aliased && allowed.includes(aliased)) return aliased;
  const fuzzy = allowed.find((item) => normalized.includes(item.toLowerCase()) || item.toLowerCase().includes(normalized));
  if (fuzzy) return fuzzy;
  return allowed.includes('demo') ? 'demo' : allowed[0];
}

function getPath(obj: unknown, path: PropertyKey[]): unknown {
  let cur = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[String(key)];
  }
  return cur;
}

function setPath(obj: unknown, path: PropertyKey[], value: unknown): void {
  if (!path.length || obj == null || typeof obj !== 'object') return;
  let cur = obj as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const key = String(path[i]);
    const nextIsIndex = typeof path[i + 1] === 'number' || /^\d+$/.test(String(path[i + 1]));
    if (cur[key] == null || typeof cur[key] !== 'object') cur[key] = nextIsIndex ? [] : {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[String(path[path.length - 1])] = value;
}

function isZodError(error: unknown): error is z.ZodError {
  return (
    error instanceof z.ZodError ||
    (typeof error === 'object' &&
      !!error &&
      (error as { name?: string }).name === 'ZodError' &&
      Array.isArray((error as { issues?: unknown }).issues))
  );
}

function isJsonShapeError(error: unknown): boolean {
  if (isZodError(error)) return true;
  if (error instanceof SyntaxError) return true;
  return error instanceof Error && error.message === '模型未返回 JSON';
}

function formatJsonError(error: unknown): string {
  if (isZodError(error)) {
    return error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}
