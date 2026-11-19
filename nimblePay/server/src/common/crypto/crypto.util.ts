import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto';

const ALGO = 'aes-256-gcm';

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function hmacSha256Hex(secret: string, text: string): string {
  return createHmac('sha256', secret).update(text, 'utf8').digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a.toLowerCase());
  const bb = Buffer.from(b.toLowerCase());
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function encryptAesGcm(plain: string, keyHex: string): string {
  if (!plain) return '';
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptAesGcm(payload: string, keyHex: string): string {
  if (!payload) return '';
  const [ivHex, tagHex, dataHex] = payload.split(':');
  const key = Buffer.from(keyHex, 'hex');
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}
