import axios from 'axios';
import { formatHttpError } from '../../common/http/retryable-http-client';

type Side = 'input' | 'output';
type Media = 'text' | 'image' | 'video' | 'audio';
type Reason = 'privacy' | 'copyright' | 'deepfake' | 'sensitive';

const MEDIA_LABEL: Record<Media, string> = { text: '提示词', image: '图片', video: '视频', audio: '音频' };

/**
 * 内容审核类错误码：`(Input|Output)(Text|Image|Video|Audio)SensitiveContentDetected[.后缀]`，
 * 见火山方舟错误码文档。不带前缀的 `SensitiveContentDetected[.*]` 是输入文本。
 */
const CODE_PATTERN = /^(Input|Output)?(Text|Image|Video|Audio)?SensitiveContentDetected(?:\.(\w+))?$/;
const SUFFIX_REASON: Record<string, Reason> = {
  PrivacyInformation: 'privacy',
  PolicyViolation: 'copyright',
  DeepFake: 'deepfake',
};

/** 报错里没有错误码时，按英文原文识别。例如 "the input image may contain real person" */
const MESSAGE_PATTERN = /\b(input|output)\s+(text|image|video|audio)?\b.*?\b(real person|copyright|counterfeit|sensitive)/i;
const MESSAGE_REASON: Record<string, Reason> = {
  'real person': 'privacy',
  copyright: 'copyright',
  counterfeit: 'deepfake',
  sensitive: 'sensitive',
};

function describe(side: Side, media: Media | undefined, reason: Reason): string {
  const label = media ? MEDIA_LABEL[media] : '内容';
  const target = side === 'input' ? `输入的${label}` : `生成的${label}`;
  const retry = side === 'input' ? `请更换${label}后重试` : '请调整输入内容后重试';
  switch (reason) {
    case 'privacy':
      return `${target}可能包含真人，官方模型暂不支持直接使用真人素材，请更换为非真人的${label}后重试`;
    case 'copyright':
      return `${target}可能涉及版权限制（如知名角色、品牌或影视片段），${retry}`;
    case 'deepfake':
      return `${target}可能涉及伪造证件或凭证的风险，${retry}`;
    default:
      return `${target}可能包含敏感信息，${retry}`;
  }
}

/** 把方舟的英文审核报错换成用户能直接看懂的中文，其它错误原样返回 */
export function translateArkError(code: string | undefined, message: string): string {
  const byCode = code ? CODE_PATTERN.exec(code) : null;
  if (byCode) {
    const [, side, media, suffix] = byCode;
    return describe(
      side === 'Output' ? 'output' : 'input',
      media ? (media.toLowerCase() as Media) : side ? undefined : 'text',
      (suffix && SUFFIX_REASON[suffix]) || 'sensitive',
    );
  }
  const byMessage = MESSAGE_PATTERN.exec(message);
  if (byMessage) {
    const [, side, media, reason] = byMessage;
    return describe(side.toLowerCase() as Side, media?.toLowerCase() as Media | undefined, MESSAGE_REASON[reason.toLowerCase()]);
  }
  return message;
}

/** 方舟接口的错误：取响应里的错误码做翻译，没有错误码时退回到原文识别 */
export function formatArkError(error: unknown): string {
  const code = axios.isAxiosError(error) ? (error.response?.data as { error?: { code?: string } } | undefined)?.error?.code : undefined;
  return translateArkError(code, formatHttpError(error));
}
