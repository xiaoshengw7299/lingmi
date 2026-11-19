/** 取文件扩展名（小写、最长 5 位字母数字）；取不到用 fallback */
export function extOf(name: string, fallback: string): string {
  return /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(name)?.[1]?.toLowerCase() ?? fallback;
}

/** 提示词里 @名称 引用不能包含的字符（与前端 MentionInput 保持一致） */
export const MENTION_NAME_RE = /^[^\s,，。!！?？、@＠：:；;（）()【】[\]“”"'‘’]+$/;
