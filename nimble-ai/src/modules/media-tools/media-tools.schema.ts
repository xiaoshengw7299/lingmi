import { BadRequestException } from '@nestjs/common';
import { InputFile, ToolContext, ToolDef, ToolMode, ToolOption } from './media-tools.catalog';
import { Showcase, TOOL_CONTENT } from './media-tools.content';

const FILE_ID = /^mediakit:\/\/[\w\-.~%+/=]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 浏览器读出的时长允许少量误差 */
const DURATION_SLACK_SEC = 2;
const BOX_KEYS = ['top_left_x', 'top_left_y', 'bottom_right_x', 'bottom_right_y'] as const;

const fail = (message: string): never => {
  throw new BadRequestException(message);
};

/** 示例里的相对路径换成可访问的地址 */
export function presentShowcase(showcase: Showcase[] | undefined, exampleUrl: (key: string) => string) {
  return (showcase ?? []).map((item) => ({
    ...item,
    items: item.items.map(({ key, ...rest }) => ({ ...rest, ...(key ? { url: exampleUrl(key) } : {}) })),
  }));
}

/** 前端拿到的工具目录：去掉函数，只留渲染表单需要的字段，并合并介绍和效果示例 */
export function presentTool(tool: ToolDef, unitPrice: (mode: ToolMode) => number, exampleUrl: (key: string) => string) {
  const { modes, ...rest } = tool;
  const { showcase, ...content } = TOOL_CONTENT[tool.id];
  return {
    ...rest,
    ...content,
    showcase: presentShowcase(showcase, exampleUrl),
    modes: modes.map((mode) => ({
      id: mode.id,
      label: mode.label,
      desc: mode.desc,
      sync: mode.path.startsWith('tools-sync/'),
      inputs: mode.inputs,
      options: mode.options,
      price: { unit: mode.price.unit, basis: mode.price.basis, price: unitPrice(mode) },
    })),
  };
}

export function isVisible(option: ToolOption, values: Record<string, unknown>): boolean {
  return Object.entries(option.when ?? {}).every(([key, allowed]) => allowed.some((value) => value === values[key]));
}

/** 校验并整理用户提交的参数。未显示的参数一律丢掉，避免下发无效字段 */
export function normalizeValues(mode: ToolMode, raw: Record<string, unknown> = {}): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const option of mode.options) {
    const value = raw[option.key] === undefined ? option.default : raw[option.key];
    values[option.key] = value === undefined || value === null ? undefined : coerce(option, value);
  }
  for (const option of mode.options) {
    if (!isVisible(option, values)) {
      delete values[option.key];
      continue;
    }
    if (option.required && isEmpty(values[option.key])) fail(`请填写${option.label}`);
    if (isEmpty(values[option.key])) delete values[option.key];
  }
  return values;
}

export function normalizeInputs(mode: ToolMode, raw: Record<string, unknown> = {}): Record<string, InputFile[]> {
  const inputs: Record<string, InputFile[]> = {};
  for (const input of mode.inputs) {
    const list = Array.isArray(raw[input.key]) ? (raw[input.key] as unknown[]) : [];
    if (!list.length && !input.optional) fail(`请上传${input.label}`);
    if (list.length > (input.max ?? 1)) fail(`${input.label}最多 ${input.max ?? 1} 个`);
    inputs[input.key] = list.map((item) => {
      const file = (item ?? {}) as Record<string, unknown>;
      const fileId = String(file.fileId ?? '');
      const kind = String(file.kind ?? '') as InputFile['kind'];
      if (!FILE_ID.test(fileId)) fail(`${input.label}上传未完成，请重新上传`);
      if (!input.kinds.includes(kind)) fail(`${input.label}的文件类型不支持`);
      const durationSec = toNumber(file.durationSec);
      if (input.maxDurationSec && durationSec && durationSec > input.maxDurationSec + DURATION_SLACK_SEC) {
        fail(`${input.label}超过时长上限（${formatSec(input.maxDurationSec)}）`);
      }
      return {
        fileId,
        kind,
        name: String(file.name ?? '').slice(0, 200),
        durationSec,
        width: toNumber(file.width),
        height: toNumber(file.height),
      };
    });
  }
  return inputs;
}

/** 按目录把输入和参数拼成上游请求体 */
export function buildBody(mode: ToolMode, ctx: ToolContext): Record<string, unknown> {
  const body: Record<string, unknown> = structuredClone(mode.fixed ?? {});
  for (const input of mode.inputs) {
    const files = ctx.inputs[input.key] ?? [];
    if (!files.length) continue;
    const field = input.field.replace('{kind}', files[0].kind);
    setPath(body, field, (input.max ?? 1) > 1 ? files.map((file) => file.fileId) : files[0].fileId);
  }
  for (const option of mode.options) {
    if (option.field === false || ctx.values[option.key] === undefined) continue;
    setPath(body, option.field ?? option.key, ctx.values[option.key]);
  }
  mode.build?.(body, ctx);
  return body;
}

function coerce(option: ToolOption, value: unknown): unknown {
  switch (option.type) {
    case 'select': {
      const choice = option.choices?.find((item) => String(item.value) === String(value));
      return choice ? choice.value : fail(`${option.label}的取值不支持`);
    }
    case 'switch':
      return value === true || value === 'true';
    case 'number':
    case 'slider':
      return inRange(option, Number(value));
    case 'text':
    case 'textarea':
      return limitText(option, value);
    case 'mask': {
      const text = String(value);
      return text && !FILE_ID.test(text) ? fail(`${option.label}上传未完成，请重新绘制`) : text;
    }
    case 'record':
      return UUID.test(String(value)) ? String(value) : fail(`请选择${option.label}`);
    case 'tags': {
      const list = asList(option, value).map((item) => inRange(option, Number(item)));
      return [...new Set(list)];
    }
    case 'pairs':
      return asList(option, value).map((item) => {
        const pair = (item ?? {}) as Record<string, unknown>;
        const from = limitText(option, pair.from);
        const to = limitText(option, pair.to);
        if (!from || !to) fail(`${option.label}的原文和新文案都要填写`);
        // 可选的定位时间段（秒），同一句话出现多次时用来锁定位置
        const start = Number(pair.start);
        const end = Number(pair.end);
        const ranged = pair.start != null && pair.end != null && pair.start !== '' && pair.end !== '';
        if (ranged && !(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start)) fail(`${option.label}的时间段无效`);
        return ranged ? { from, to, start, end } : { from, to };
      });
    case 'boxes':
      return asList(option, value).map((item) => {
        const box = (item ?? {}) as Record<string, unknown>;
        const [x1, y1, x2, y2] = BOX_KEYS.map((key) => Number(box[key]));
        const valid = [x1, y1, x2, y2].every((n) => Number.isFinite(n) && n >= 0 && n <= 1) && x2 > x1 && y2 > y1;
        if (!valid) fail(`${option.label}的区域无效，请重新框选`);
        return { top_left_x: round(x1), top_left_y: round(y1), bottom_right_x: round(x2), bottom_right_y: round(y2) };
      });
  }
}

function inRange(option: ToolOption, value: number): number {
  if (!Number.isFinite(value)) fail(`${option.label}需要是数字`);
  if ((option.min != null && value < option.min) || (option.max != null && value > option.max)) {
    fail(`${option.label}需在 ${option.min ?? '-'} 到 ${option.max ?? '-'} 之间`);
  }
  return value;
}

function limitText(option: ToolOption, value: unknown): string {
  const text = String(value ?? '').trim();
  if (option.maxLength && text.length > option.maxLength) fail(`${option.label}不能超过 ${option.maxLength} 字`);
  return text;
}

function asList(option: ToolOption, value: unknown): unknown[] {
  if (!Array.isArray(value)) fail(`${option.label}格式不正确`);
  const list = value as unknown[];
  if (option.maxItems && list.length > option.maxItems) fail(`${option.label}最多 ${option.maxItems} 项`);
  return list;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let node: Record<string, unknown> = target;
  parts.slice(0, -1).forEach((part, i) => {
    node[part] ??= /^\d+$/.test(parts[i + 1]) ? [] : {};
    node = node[part] as Record<string, unknown>;
  });
  node[parts[parts.length - 1]] = value;
}

function toNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

function formatSec(seconds: number): string {
  if (seconds >= 3600) return `${seconds / 3600} 小时`;
  if (seconds >= 60) return `${seconds / 60} 分钟`;
  return `${seconds} 秒`;
}
