import { randomBytes } from 'crypto';
import dayjs from 'dayjs';

export function genNo(prefix: string): string {
  const t = dayjs().format('YYYYMMDDHHmmss');
  const r = randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}${t}${r}`;
}

export function genAppId(): string {
  return `lp${randomBytes(8).toString('hex')}`;
}

export function genAppSecret(): string {
  return `lpsk_${randomBytes(24).toString('hex')}`;
}

export function genPayToken(): string {
  return randomBytes(16).toString('hex');
}

export function maskSecret(value: string, head = 4, tail = 4): string {
  if (!value) return '';
  if (value.length <= head + tail) return '*'.repeat(value.length);
  return `${value.slice(0, head)}${'*'.repeat(6)}${value.slice(-tail)}`;
}

export function looksMasked(value?: string): boolean {
  return !value || value.includes('*');
}
