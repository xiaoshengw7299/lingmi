import { AtlasRefFieldSpec, LoraSelection, MediaModelOption } from './atlas.types';

/**
 * 把一类参考素材（图片/视频/音频其中一类）写入请求体。
 * `spec` 未声明但确实带了引用时说明选错了变体或模型不支持该类引用，抛出的错误会被上层转成用户可读提示。
 */
export function applyRefField(
  body: Record<string, unknown>,
  spec: AtlasRefFieldSpec | undefined,
  urls: string[],
  label: string,
): void {
  if (!urls.length) return;
  if (!spec) throw new Error(`当前模型不支持${label}`);
  const mapped =
    spec.shape === 'url-object' ? urls.map((url) => ({ url, type: spec.mediaType })) : urls;
  if (!spec.array) {
    body[spec.field] = mapped[0];
    return;
  }
  const existing = body[spec.field];
  body[spec.field] = Array.isArray(existing) ? [...existing, ...mapped] : mapped;
}

/** 挂载 LoRA（仅所选模型 supportsLora=true 且携带的 name 命中 loras 预设时生效，未命中静默忽略） */
export function applyLora(body: Record<string, unknown>, model: MediaModelOption, lora?: LoraSelection | null): void {
  if (!lora || !model.supportsLora) return;
  const preset = model.loras.find((item) => item.name === lora.name);
  if (!preset) return;
  body[model.loraField ?? 'loras'] = [{ path: preset.path, scale: lora.weight ?? preset.defaultWeight }];
}
