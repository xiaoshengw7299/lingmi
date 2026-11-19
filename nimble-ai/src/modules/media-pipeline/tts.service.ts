import { randomBytes } from 'crypto';
import { IncomingMessage } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import axios from 'axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// ws 是 CommonJS 导出，项目没开 esModuleInterop，只能用 import = require
// eslint-disable-next-line @typescript-eslint/no-require-imports
import WebSocket = require('ws');
import { BillingService } from '../billing/billing.service';
import { PricingService } from '../pricing/pricing.service';
import { FfmpegService } from './ffmpeg.service';
import { generateSecMsGecV2 } from './sec-ms-gec';
import { TimedCue, TtsResult } from './media-pipeline.types';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split('.')[0];
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;
const CONNECT_TIMEOUT_MS = 10000;
const MAX_ATTEMPTS = 2;
/** 付费配音：voiceName = "doubao:<speaker>"。旧的 atlas: 前缀转到豆包默认音色 */
export const DOUBAO_VOICE_PREFIX = 'doubao:';
export const ATLAS_VOICE_PREFIX = 'atlas:';
const DEFAULT_DOUBAO_SPEAKER = 'zh_female_vv_uranus_bigtts';

export interface TtsInput {
  text: string;
  voiceName: string;
  /** 语速倍率：Edge 映射到 SSML rate（-20%~+100%），Atlas 映射到 speed（0.7~1.5，超出范围自动收口） */
  rate?: number;
  /** 音量倍率，仅 Edge 使用（Atlas 无独立音量参数，靠合成阶段的 narrationVolume 调） */
  volume?: number;
}

/**
 * 配音合成服务（一键成片）
 *
 * 免费档：Edge TTS 在线合成（与 MoneyPrinterTurbo 相同的协议），整篇文案一次性合成，
 * 同时解析 `Path:audio.metadata` 帯的词级时间戳，供字幕对齐使用（见 subtitle.util.ts）。
 * AI 档：豆包语音合成 2.0。不返回词级时间戳，字幕改走比例回退对齐。
 * 两档统一用 ffprobe 读取解码后的真实时长兜底，不采信"最后一个词结束时间"（该时间点前通常还有
 * 一小段静音尾巴，用它当时长会让合成视频结尾卡顿/被截断）。
 */
@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private clockSkewSeconds = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly billing: BillingService,
    private readonly pricing: PricingService,
    private readonly ffmpeg: FfmpegService,
  ) {}

  async synthesize(input: TtsInput): Promise<TtsResult> {
    if (input.voiceName.startsWith(DOUBAO_VOICE_PREFIX) || input.voiceName.startsWith(ATLAS_VOICE_PREFIX)) {
      const raw = input.voiceName.startsWith(DOUBAO_VOICE_PREFIX)
        ? input.voiceName.slice(DOUBAO_VOICE_PREFIX.length)
        : '';
      const speaker = raw.includes('_bigtts') ? raw : DEFAULT_DOUBAO_SPEAKER;
      return this.synthesizeDoubao(input.text, speaker, input.rate ?? 1);
    }
    return this.synthesizeEdge(input.text, input.voiceName, input.rate ?? 1, input.volume ?? 1);
  }

  /** 仅试听用：短句、不需要词时间戳，失败即抛错供 controller 转 400 */
  async previewEdge(text: string, voiceName: string, rate: number, volume: number): Promise<Buffer> {
    const result = await this.synthesizeEdge(text, voiceName, rate, volume, 15_000);
    return result.audio;
  }

  // ───────────────────────── Edge TTS（免费） ─────────────────────────

  private async synthesizeEdge(
    rawText: string,
    voiceName: string,
    rate: number,
    volume: number,
    streamTimeoutMs = 60_000,
  ): Promise<TtsResult> {
    const text = sanitizeText(rawText);
    const voice = toEdgeVoiceName(voiceName);
    const ratePercent = toSignedPercent(rate, -20, 100);
    const volumePercent = toSignedPercent(volume, -40, 100);
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { audio, wordCues } = await this.connectAndSynthesize(text, voice, ratePercent, volumePercent, streamTimeoutMs);
        const durationSec = await this.probeDurationSec(audio, 'mp3');
        return { audio, mimeType: 'audio/mpeg', durationSec, wordCues };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`edge tts try ${attempt} failed: ${lastError.message}`);
      }
    }
    throw lastError ?? new Error('配音合成失败');
  }

  private connectAndSynthesize(
    text: string,
    voice: string,
    rate: string,
    volume: string,
    streamTimeoutMs: number,
  ): Promise<{ audio: Buffer; wordCues: TimedCue[] }> {
    const connectionId = randomBytes(16).toString('hex');
    const url =
      `${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
      `&ConnectionId=${connectionId}` +
      `&Sec-MS-GEC=${this.generateSecMsGec()}` +
      `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const wordCues: TimedCue[] = [];
      let settled = false;
      let connectTimer: NodeJS.Timeout | null = null;
      let streamTimer: NodeJS.Timeout | null = null;
      let socket: WebSocket | null = null;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (connectTimer) clearTimeout(connectTimer);
        if (streamTimer) clearTimeout(streamTimer);
        if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
          socket.close();
        }
        if (error) {
          reject(error);
          return;
        }
        const audio = Buffer.concat(chunks);
        if (!audio.length) {
          reject(new Error('未收到配音音频'));
          return;
        }
        resolve({ audio, wordCues });
      };

      const ws = new WebSocket(url, {
        headers: {
          Pragma: 'no-cache',
          'Cache-Control': 'no-cache',
          Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          'User-Agent':
            `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
            `(KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 ` +
            `Edg/${CHROMIUM_MAJOR}.0.0.0`,
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Accept-Language': 'en-US,en;q=0.9',
          Cookie: `muid=${randomBytes(16).toString('hex').toUpperCase()};`,
        },
      });
      socket = ws;

      connectTimer = setTimeout(() => finish(new Error('配音合成连接超时')), CONNECT_TIMEOUT_MS);

      ws.on('unexpected-response', (_req, res: IncomingMessage) => {
        this.adjustClockSkew(res.headers.date);
        const status = res.statusCode || 0;
        res.resume();
        finish(new Error(`配音服务返回 ${status}`));
      });

      ws.on('open', () => {
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }
        streamTimer = setTimeout(() => finish(new Error('配音合成超时')), streamTimeoutMs);
        const timestamp = jsDateString();
        ws.send(
          `X-Timestamp:${timestamp}\r\n` +
            'Content-Type:application/json; charset=utf-8\r\n' +
            'Path:speech.config\r\n\r\n' +
            '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
            '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"' +
            '},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n',
        );
        ws.send(
          `X-RequestId:${connectionId}\r\n` +
            'Content-Type:application/ssml+xml\r\n' +
            `X-Timestamp:${timestamp}Z\r\n` +
            'Path:ssml\r\n\r\n' +
            buildSsml(text, voice, rate, volume),
        );
      });

      ws.on('message', (raw) => {
        const data = toBuffer(raw as Buffer | ArrayBuffer | Buffer[] | string);
        const audio = extractAudioChunk(data);
        if (audio) {
          chunks.push(audio);
        } else if (data.includes('Path:audio.metadata')) {
          parseWordBoundaries(data.toString('utf8'), wordCues);
        }
        if (data.toString('utf8').includes('Path:turn.end')) finish();
      });

      ws.on('error', (error) => finish(error));
      ws.on('close', () => {
        if (!settled) finish();
      });
    });
  }

  private generateSecMsGec(): string {
    return generateSecMsGecV2(Date.now() / 1000 + this.clockSkewSeconds, TRUSTED_CLIENT_TOKEN);
  }

  private adjustClockSkew(dateHeader?: string | string[]) {
    const raw = Array.isArray(dateHeader) ? dateHeader[0] : dateHeader;
    if (!raw) return;
    const serverUnix = Date.parse(raw);
    if (Number.isNaN(serverUnix)) return;
    this.clockSkewSeconds += serverUnix / 1000 - Date.now() / 1000;
  }

  // ───────────────────────── 豆包语音合成 2.0（付费） ─────────────────────────

  private async synthesizeDoubao(text: string, speaker: string, rate: number): Promise<TtsResult> {
    const apiKey = this.config.get<string>('DOUBAO_SPEECH_API_KEY', '') || this.config.get<string>('ARK_API_KEY', '');
    if (!apiKey) throw new Error('未配置 DOUBAO_SPEECH_API_KEY，无法合成付费配音');
    const quote = await this.pricing.quoteSpeech(text.length, 'seed-tts-2.0');
    const ticket = await this.billing.chargeQuoted('audio', {
      model: 'doubao-tts',
      modelName: '豆包语音合成 2.0',
      cents: quote.cents,
      upstreamCents: quote.upstreamCents,
    });
    const speechRate = Math.round(Math.min(100, Math.max(-50, (rate - 1) * 100)));
    try {
      const response = await axios.post<string>(
        `${this.config.get<string>('DOUBAO_SPEECH_BASE_URL', 'https://openspeech.bytedance.com')}/api/v3/tts/unidirectional`,
        {
          req_params: {
            text,
            speaker,
            audio_params: { format: 'mp3', speech_rate: speechRate },
          },
        },
        {
          headers: {
            'X-Api-Key': apiKey,
            'X-Api-Resource-Id': 'seed-tts-2.0',
            'X-Api-Request-Id': randomBytes(16).toString('hex'),
          },
          responseType: 'text',
          timeout: 120_000,
        },
      );
      const audio = decodeDoubaoAudio(response.data);
      const durationSec = await this.probeDurationSec(audio, 'mp3');
      return { audio, mimeType: 'audio/mpeg', durationSec, wordCues: [] };
    } catch (error) {
      await this.billing.refund(ticket);
      throw error instanceof Error ? error : new Error('配音合成失败');
    }
  }

  // ───────────────────────── 公共：真实时长探测 ─────────────────────────

  /** 用 ffprobe 读解码后的真实时长；不采信 TTS 引擎自报的时间戳（末尾常有静音尾巴） */
  private async probeDurationSec(audio: Buffer, ext: string): Promise<number> {
    const tempPath = path.join(os.tmpdir(), `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
    try {
      fs.writeFileSync(tempPath, audio);
      const { durationSec } = await this.ffmpeg.probeMedia(tempPath);
      return durationSec ?? estimateDurationFallback(audio);
    } finally {
      fs.rm(tempPath, { force: true }, () => undefined);
    }
  }
}

// ───────────────────────── 纯函数（无状态，供 controller 预览文案/校验音色用） ─────────────────────────

export function toEdgeVoiceName(voiceName: string): string {
  return voiceName.replace(/-Female$/i, '').replace(/-Male$/i, '').trim();
}

function decodeDoubaoAudio(payload: string): Buffer {
  const chunks: Buffer[] = [];
  for (const line of payload.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: { code?: number; data?: string | null; message?: string };
    try {
      row = JSON.parse(trimmed) as typeof row;
    } catch {
      continue;
    }
    if (row.code && row.code !== 0 && row.code !== 20000000) {
      throw new Error(row.message || '配音合成失败');
    }
    if (row.data) chunks.push(Buffer.from(row.data, 'base64'));
  }
  if (!chunks.length) throw new Error('配音合成失败：未返回音频');
  return Buffer.concat(chunks);
}

export function previewSampleText(voiceName: string): string {
  if (voiceName.startsWith(DOUBAO_VOICE_PREFIX) || voiceName.startsWith(ATLAS_VOICE_PREFIX)) {
    return '你好，这是当前 AI 配音音色的试听。';
  }
  const voice = toEdgeVoiceName(voiceName);
  if (voice.startsWith('zh-HK')) return '你好，呢個係而家揀嘅配音聲線試聽。';
  if (voice.startsWith('en-')) return 'Hello, this is a preview of the selected voice.';
  return '你好，这是当前配音音色的试听。';
}

export function clipPreviewText(text: string, maxChars = 200): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const chars = [...normalized];
  if (chars.length <= maxChars) return normalized;
  return chars.slice(0, maxChars).join('');
}

function sanitizeText(text: string): string {
  return [...text]
    .map((char) => {
      const code = char.codePointAt(0) || 0;
      if ((code >= 0 && code <= 8) || (code >= 11 && code <= 12) || (code >= 14 && code <= 31)) return ' ';
      return char;
    })
    .join('')
    .trim();
}

function toSignedPercent(multiplier: number, min: number, max: number): string {
  const value = Number(multiplier);
  const rate = !Number.isFinite(value) || value <= 0 ? 1 : value;
  const percent = Math.max(min, Math.min(max, Math.round((rate - 1) * 100)));
  return percent >= 0 ? `+${percent}%` : `${percent}%`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSsml(text: string, voice: string, rate: string, volume: string): string {
  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${voice}'>` +
    `<prosody pitch='+0Hz' rate='${rate}' volume='${volume}'>` +
    `${escapeXml(text)}` +
    '</prosody></voice></speak>'
  );
}

function jsDateString(): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${days[now.getUTCDay()]} ${months[now.getUTCMonth()]} ${pad(now.getUTCDate())} ` +
    `${now.getUTCFullYear()} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} ` +
    'GMT+0000 (Coordinated Universal Time)'
  );
}

function toBuffer(raw: Buffer | ArrayBuffer | Buffer[] | string): Buffer {
  if (typeof raw === 'string') return Buffer.from(raw);
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw);
}

function extractAudioChunk(data: Buffer): Buffer | null {
  const needle = Buffer.from('Path:audio\r\n');
  const pathIdx = data.indexOf(needle);
  if (pathIdx === -1) return null;
  const audio = data.subarray(pathIdx + needle.length);
  return audio.length ? audio : null;
}

/** 解析一条 `Path:audio.metadata` 文本消息里的全部 WordBoundary 条目；Offset/Duration 单位是 100ns（tick） */
function parseWordBoundaries(text: string, out: TimedCue[]): void {
  const idx = text.indexOf('\r\n\r\n');
  if (idx === -1) return;
  try {
    const json = JSON.parse(text.slice(idx + 4)) as { Metadata?: Array<{ Type?: string; Data?: any }> };
    for (const item of json.Metadata ?? []) {
      if (item.Type !== 'WordBoundary') continue;
      const offset = Number(item.Data?.Offset ?? 0);
      const duration = Number(item.Data?.Duration ?? 0);
      const wordText = String(item.Data?.text?.Text ?? '');
      if (!wordText) continue;
      out.push({ text: wordText, startMs: offset / 10_000, endMs: (offset + duration) / 10_000 });
    }
  } catch {
    // 忽略单条元数据解析失败，不影响整体合成音频
  }
}

/** ffprobe 也拿不到时长时的最后兜底：按 mp3 24kHz/48kbps 粗略估算，仅用于极端异常场景 */
function estimateDurationFallback(audio: Buffer): number {
  return Math.max(1, audio.length / (48_000 / 8));
}
