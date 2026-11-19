import * as fs from 'fs';
import axios from 'axios';

export const STOCK_USER_AGENT = 'nimble-ai/1.0 (stock media search)';
export const STOCK_DOWNLOAD_MAX_BYTES = 80 * 1024 * 1024;

export const STOCK_REQUEST_HEADERS = {
  'User-Agent': STOCK_USER_AGENT,
  'Api-User-Agent': STOCK_USER_AGENT,
};

export async function downloadStockUrl(url: string, destPath: string): Promise<void> {
  const res = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 60_000,
    headers: STOCK_REQUEST_HEADERS,
    maxContentLength: STOCK_DOWNLOAD_MAX_BYTES,
    maxBodyLength: STOCK_DOWNLOAD_MAX_BYTES,
  });
  fs.writeFileSync(destPath, Buffer.from(res.data));
}

export function stockSourceExt(clip: { url: string; mediaType?: string }): string {
  if (clip.mediaType === 'image') {
    const match = clip.url.split('?')[0].match(/\.(jpe?g|png|webp|gif)$/i);
    return match ? `.${match[1].toLowerCase().replace('jpeg', 'jpg')}` : '.jpg';
  }
  const match = clip.url.split('?')[0].match(/\.(mp4|webm|mov)$/i);
  return match ? `.${match[1].toLowerCase()}` : '.mp4';
}

export function stockMime(clip: { mediaType?: string }, ext: string): string {
  if (clip.mediaType === 'image') {
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    return 'image/jpeg';
  }
  return ext === '.webm' ? 'video/webm' : 'video/mp4';
}
