/**
 * 桌面端开放 API 签名示例（Node.js ESM）
 *
 * canonical = timestamp + "\n" + nonce + "\n" + METHOD + "\n" + path + "\n" + sha256(rawBody)
 * path 必须是带 /api 前缀的完整路径，例如 /api/open/v1/plans。
 * GET 的 rawBody 为空字符串。
 */
import { createHmac, createHash, randomUUID } from 'crypto';

export function signHeaders({ appId, appSecret, method, path, rawBody = '' }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const bodyHash = createHash('sha256').update(rawBody, 'utf8').digest('hex');
  const canonical = `${timestamp}\n${nonce}\n${method.toUpperCase()}\n${path}\n${bodyHash}`;
  const sign = createHmac('sha256', appSecret).update(canonical, 'utf8').digest('hex');
  return {
    'X-App-Id': appId,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Sign': sign,
  };
}
