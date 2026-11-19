import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VideoQcReport } from '../video/entities/video-take.entity';
import { Canvas, ClipPrepareResult, FitMode, GridCell, SubtitleStyle, TextOverlay, TimedCue } from './media-pipeline.types';
import { buildOverlayFilter, buildSubtitleFilter, DrawtextFile } from './subtitle.util';

const COMPOSE_CANVAS: Record<string, Canvas> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:3': { width: 1440, height: 1080 },
  '3:4': { width: 1080, height: 1440 },
  '21:9': { width: 2560, height: 1080 },
};

/** 旁白/BGM 单次 loudnorm，对齐工厂：先归一再裁切，避免滤镜截断尾音 */
const VOICE_LOUDNORM = 'loudnorm=I=-16:TP=-1.5:LRA=11';
const BGM_LOUDNORM = 'loudnorm=I=-25:TP=-1.5:LRA=11';

export function composeCanvas(ratio: string): Canvas {
  return COMPOSE_CANVAS[ratio] ?? COMPOSE_CANVAS['9:16'];
}

/** 转场模式 → ffmpeg xfade 滤镜的 transition 名；Shuffle 每次从候选里随机挑一个 */
const XFADE_TRANSITIONS: Record<string, string[]> = {
  FadeIn: ['fade'],
  FadeOut: ['fade'],
  SlideIn: ['slideright'],
  SlideOut: ['slideleft'],
  ZoomIn: ['zoomin'],
  ZoomOut: ['fade'], // xfade 内置转场没有"缩小"，退化为淡入淡出
  Shuffle: ['fade', 'slideright', 'slideleft', 'slideup', 'slidedown', 'zoomin', 'circleopen', 'wiperight'],
};
const XFADE_DURATION_SEC = 0.5;

/**
 * FFmpeg 媒体处理服务（视频制作 / 一键成片共用）
 *
 * 三类能力：
 *   1. 分镜合成（video-producer 专用）—— concatShots/extractFrame/probeMedia/inspectVideo
 *   2. 素材预处理 + 拼接（一键成片）—— prepareVideoClip/prepareImageClip/concatClips
 *   3. 收尾合成（一键成片）—— composeFinal（字幕烧录 + 配音/BGM 混音 + 时长收口）
 *
 * 部署约定：
 *   - Linux 生产：系统安装带 libx264 的 ffmpeg（`apt install ffmpeg` 等），可选 FFMPEG_PATH
 *   - Windows 本机：仓库 ffmpeg.exe 常无 libx264，启动时回退 h264_mf / GPU 编码器
 *   - 字幕烧录用 drawtext（无需 libass），中文字体固定使用 resource/fonts 下随包字体，不依赖系统字体
 */
@Injectable()
export class FfmpegService implements OnModuleInit {
  private readonly logger = new Logger(FfmpegService.name);
  private readonly ffmpegPath: string;
  /** 片段预处理用：很快 + CRF，避免无质量约束的 veryfast 码率漂移 */
  private videoEncodeArgs: string[] = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'];
  /** 成片收尾用：medium + 同 CRF，只压一次，画质更稳 */
  private finalVideoEncodeArgs: string[] = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23'];
  /** ffmpeg 是否可执行（spawn 成功且 -version 正常） */
  private available = false;

  constructor(private readonly configService: ConfigService) {
    this.ffmpegPath = this.resolveFfmpegPath();
  }

  async onModuleInit() {
    const probe = await this.probeFfmpeg();
    this.available = probe.ok;
    if (probe.ok === false) {
      this.logger.error(
        `FFmpeg 不可用（path=${this.ffmpegPath}）：${probe.error}。` +
          '成片合成与视频 QC 将失败。请安装 ffmpeg 或设置 FFMPEG_PATH。',
      );
      return;
    }
    const encoder = await this.resolveVideoEncoder();
    this.videoEncodeArgs = encoder.clip;
    this.finalVideoEncodeArgs = encoder.final;
    this.logger.log(`FFmpeg: ${this.ffmpegPath}, clip encoder: ${this.videoEncodeArgs.join(' ')}, final encoder: ${this.finalVideoEncodeArgs.join(' ')}`);
  }

  /** 合成/QC 前快速失败，避免只抛出晦涩的 spawn ENOENT */
  assertAvailable(): void {
    if (!this.available) {
      throw new Error(
        `FFmpeg 不可用（path=${this.ffmpegPath}）。请安装 ffmpeg 或设置环境变量 FFMPEG_PATH`,
      );
    }
  }

  private resolveFfmpegPath(): string {
    const configured = this.configService.get<string>('FFMPEG_PATH');
    if (configured) return configured;
    // 仅 Windows 开发机使用仓库自带二进制；Linux 生产一律走 PATH / FFMPEG_PATH
    const bundled = path.join(process.cwd(), 'ffmpeg.exe');
    if (process.platform === 'win32' && fs.existsSync(bundled)) return bundled;
    return 'ffmpeg';
  }

  /** 探测 ffmpeg 是否可启动（区分「二进制不存在」与「无编码器」） */
  private probeFfmpeg(): Promise<{ ok: true } | { ok: false; error: string }> {
    return new Promise((resolve) => {
      const proc = spawn(this.ffmpegPath, ['-hide_banner', '-version']);
      let output = '';
      proc.stdout.on('data', (c) => { output += c.toString(); });
      proc.stderr.on('data', (c) => { output += c.toString(); });
      proc.on('error', (err) => {
        const code = (err as NodeJS.ErrnoException).code;
        resolve({
          ok: false,
          error:
            code === 'ENOENT'
              ? `找不到可执行文件（ENOENT）。请确认已安装 ffmpeg，或 FFMPEG_PATH 指向正确路径`
              : err.message,
        });
      });
      proc.on('close', (exitCode) => {
        if (exitCode === 0 || /ffmpeg\s+version/i.test(output)) {
          resolve({ ok: true });
          return;
        }
        resolve({
          ok: false,
          error: `执行 -version 失败 (exit ${exitCode ?? -1})${output.trim() ? `: ${output.trim().slice(0, 200)}` : ''}`,
        });
      });
    });
  }

  /**
   * 选择 H.264 编码器。
   * Linux 生产优先且应以 libx264 为准；其余仅为本机/GPU 回退。
   */
  private async resolveVideoEncoder(): Promise<{ clip: string[]; final: string[] }> {
    const { encoders, spawnError } = await this.listEncoders();
    const libx264 = {
      name: 'libx264',
      clip: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'],
      final: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23'],
    };
    const hardware: Array<{ name: string; args: string[] }> = [];
    if (process.platform === 'win32') {
      hardware.push(
        { name: 'h264_mf', args: ['-c:v', 'h264_mf', '-rate_control', 'cbr', '-b:v', '8M'] },
        { name: 'h264_amf', args: ['-c:v', 'h264_amf', '-b:v', '8M'] },
      );
    }
    hardware.push(
      { name: 'h264_nvenc', args: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-b:v', '8M'] },
      { name: 'h264_qsv', args: ['-c:v', 'h264_qsv', '-b:v', '8M'] },
    );
    if (encoders.has(libx264.name)) return { clip: libx264.clip, final: libx264.final };
    for (const c of hardware) {
      if (encoders.has(c.name)) return { clip: c.args, final: c.args };
    }
    if (spawnError) {
      this.logger.warn(`列举编码器失败（path=${this.ffmpegPath}）：${spawnError}，回退 libx264`);
    } else {
      this.logger.warn(
        process.platform === 'win32'
          ? '未探测到可用 H.264 编码器，回退 libx264（本机 ffmpeg.exe 可能失败）'
          : '未探测到 libx264：Linux 请安装完整 ffmpeg（含 libx264），或设置 FFMPEG_PATH',
      );
    }
    return { clip: libx264.clip, final: libx264.final };
  }

  private listEncoders(): Promise<{ encoders: Set<string>; spawnError?: string }> {
    return new Promise((resolve) => {
      const proc = spawn(this.ffmpegPath, ['-hide_banner', '-encoders']);
      let out = '';
      proc.stdout.on('data', (c) => { out += c.toString(); });
      proc.stderr.on('data', (c) => { out += c.toString(); });
      proc.on('error', (err) => {
        const code = (err as NodeJS.ErrnoException).code;
        const message =
          code === 'ENOENT'
            ? `找不到可执行文件（ENOENT）：${this.ffmpegPath}`
            : err.message;
        this.logger.warn(`FFmpeg 启动失败（列举编码器）: ${message}`);
        resolve({ encoders: new Set(), spawnError: message });
      });
      proc.on('close', () => {
        const names = new Set<string>();
        for (const line of out.split('\n')) {
          const m = /^\s*\S+\s+(\S+)\s+/.exec(line);
          if (m) names.add(m[1]);
        }
        resolve({ encoders: names });
      });
    });
  }

  // ───────────────────────── 分镜合成（video-producer） ─────────────────────────

  /** 拼接分镜视频为完整视频（本地文件路径）。画布随多数分镜的比例变化。 */
  async concatShots(localPaths: string[], outputPath: string, ratio = '9:16'): Promise<void> {
    this.assertAvailable();
    const workDir = path.join(path.dirname(outputPath), `.concat_${Date.now()}`);
    fs.mkdirSync(workDir, { recursive: true });
    const canvas = composeCanvas(ratio);

    try {
      const normalizedPaths: string[] = [];
      for (let i = 0; i < localPaths.length; i++) {
        const normalized = path.join(workDir, `norm_${i}.mp4`);
        await this.normalizeWithAudio(localPaths[i], normalized, canvas, 'contain');
        normalizedPaths.push(normalized);
      }
      await this.concatByDemuxer(normalizedPaths, outputPath);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }

  /** 截取视频某一帧作为封面图（JPEG），用于合成历史列表 / 生成示例封面 */
  async extractFrame(inputPath: string, outputPath: string, seekSec = 0.5): Promise<void> {
    this.assertAvailable();
    await this.run(['-y', '-ss', String(seekSec), '-i', inputPath, '-vframes', '1', '-q:v', '2', outputPath]);
  }

  /** 把任意图片/视频帧压成 Vision 可接受的 JPEG（最长边 1280），避免原图过大或 webp/png 被网关拒收 */
  async encodeJpegForVision(inputPath: string, outputPath: string): Promise<void> {
    this.assertAvailable();
    await this.run(['-y', '-i', inputPath, '-vf', "scale='min(1280,iw)':-2", '-frames:v', '1', '-q:v', '5', outputPath]);
  }

  /**
   * 读取媒体文件的时长与画面尺寸，供上传素材校验参考素材限制使用。
   * 音频没有画面尺寸、图片没有时长，对应字段返回 undefined。
   */
  async probeMedia(inputPath: string): Promise<{ durationSec?: number; width?: number; height?: number; hasAudio?: boolean }> {
    this.assertAvailable();
    const { output } = await this.capture(['-hide_banner', '-i', inputPath]);
    return this.parseMediaInfo(output);
  }

  private parseMediaInfo(output: string): { durationSec?: number; width?: number; height?: number; hasAudio: boolean } {
    const durationMatch = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(output);
    const videoMatch = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(output);
    return {
      durationSec: durationMatch
        ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
        : undefined,
      width: videoMatch ? Number(videoMatch[1]) : undefined,
      height: videoMatch ? Number(videoMatch[2]) : undefined,
      hasAudio: /Stream #\d+:\d+.*?:\s*Audio:/.test(output),
    };
  }

  /** 成片若丢掉音轨，把源片音轨贴回去。视频流不重编码 */
  async attachAudio(videoPath: string, audioSourcePath: string, outputPath: string): Promise<void> {
    this.assertAvailable();
    await this.run([
      '-y',
      '-i', videoPath,
      '-i', audioSourcePath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-shortest',
      outputPath,
    ]);
  }

  /** 下载后的生成结果基础 QC：元数据、视频流、目标时长及完整解码。 */
  async inspectVideo(inputPath: string, expectedDurationSec: number): Promise<VideoQcReport> {
    this.assertAvailable();
    const metadata = await this.capture(['-hide_banner', '-i', inputPath]);
    const videoMatch = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(metadata.output);
    const { durationSec, width, height } = this.parseMediaInfo(metadata.output);
    const issues: string[] = [];

    if (!videoMatch) issues.push('未检测到视频流');
    if (!durationSec || !Number.isFinite(durationSec)) issues.push('无法读取视频时长');
    if (durationSec && Math.abs(durationSec - expectedDurationSec) > Math.max(2, expectedDurationSec * 0.4)) {
      issues.push(`视频时长 ${durationSec.toFixed(2)} 秒与目标 ${expectedDurationSec} 秒明显不符`);
    }

    if (!issues.length) {
      const decode = await this.capture([
        '-v', 'error', '-i', inputPath, '-map', '0:v:0', '-f', 'null', '-',
      ]);
      if (decode.code !== 0) issues.push(`视频无法完整解码：${decode.output.trim().slice(-300)}`);
    }

    return {
      result: issues.length ? 'failed' : 'passed',
      summary: issues.length ? '基础质量检查未通过' : '视频可播放，流、时长与尺寸正常',
      issues,
      durationSec,
      width,
      height,
    };
  }

  /** 统一到目标画布 / 30fps / H.264+AAC；无音轨时自动补静音（video-producer 分镜专用，保留原声） */
  private async normalizeWithAudio(inputPath: string, outputPath: string, canvas: Canvas, fit: FitMode): Promise<void> {
    const scaleFilter = this.scaleFilter(canvas, fit) + ',setsar=1,fps=30';
    try {
      await this.run([
        '-y', '-i', inputPath,
        '-vf', scaleFilter,
        ...this.videoEncodeArgs,
        '-c:a', 'aac', '-ar', '44100', '-ac', '2',
        '-map', '0:v:0', '-map', '0:a:0',
        outputPath,
      ]);
    } catch {
      await this.run([
        '-y', '-i', inputPath,
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
        '-vf', scaleFilter,
        ...this.videoEncodeArgs,
        '-c:a', 'aac', '-ar', '44100', '-ac', '2',
        '-map', '0:v:0', '-map', '1:a:0', '-shortest',
        outputPath,
      ]);
    }
  }

  // ───────────────────────── 素材预处理（一键成片） ─────────────────────────

  private scaleFilter(canvas: Canvas, fit: FitMode): string {
    const { width, height } = canvas;
    return fit === 'cover'
      ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
      : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
  }

  /**
   * 视频素材预处理：裁剪/填充到画布 + 限定时长 + 变速 + 去除原声。
   * 最终成片的声音统一由旁白/BGM 单独混音提供，素材自带的声音（如免费素材的环境音）不使用。
   * `sourceSeconds`（= durationSec * speed）必须作为**输入**选项传给 ffmpeg（在 -i 之前），
   * 这样时长裁剪发生在变速之前，输出正好是 durationSec 秒；放到输出端会在变速之后裁剪，语义就错了。
   */
  async prepareVideoClip(
    inputPath: string,
    outputPath: string,
    opts: { canvas: Canvas; fit: FitMode; durationSec: number; speed?: number; loop?: boolean; startSec?: number },
  ): Promise<void> {
    this.assertAvailable();
    const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
    const sourceSeconds = Math.max(0.1, opts.durationSec * speed);
    const speedFilter = speed !== 1 ? `,setpts=PTS/${speed}` : '';
    const filter = `${this.scaleFilter(opts.canvas, opts.fit)}${speedFilter},setsar=1,fps=30`;
    // loop=true：素材实际时长未知/可能短于目标时长时，先按 -stream_loop -1 无限循环输入，再用 -t 精确裁到目标时长——
    // 当源素材本就够长时，循环不会被触发，等价于不加该参数，故可以无条件对"时长未知"的来源开启。
    // startSec：从素材内部某点起切，而不是永远从 0 秒；-ss/-t 必须在 -i 之前，裁切发生在变速之前。
    const inputArgs: string[] = [];
    if (opts.loop) inputArgs.push('-stream_loop', '-1');
    if (opts.startSec && opts.startSec > 0) inputArgs.push('-ss', opts.startSec.toFixed(3));
    inputArgs.push('-t', sourceSeconds.toFixed(3), '-i', inputPath);
    await this.run([
      '-y', ...inputArgs,
      '-vf', filter,
      ...this.videoEncodeArgs,
      '-an', '-pix_fmt', 'yuv420p',
      outputPath,
    ]);
  }

  /** 静态图转 Ken Burns 缓慢推镜片段（AI 生成素材默认用图+推镜，比逐镜生视频更省成本） */
  async prepareImageClip(
    inputPath: string,
    outputPath: string,
    opts: { canvas: Canvas; durationSec: number },
  ): Promise<void> {
    this.assertAvailable();
    const { width, height } = opts.canvas;
    const fps = 30;
    const frames = Math.max(1, Math.round(opts.durationSec * fps));
    // 先放大 2 倍再 zoompan，减少缩放抖动；zoom 从 1.0 缓慢推进到 1.25
    const filter =
      `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,crop=${width * 2}:${height * 2},` +
      `zoompan=z='min(zoom+0.0015,1.25)':d=${frames}:s=${width}x${height}:fps=${fps},setsar=1`;
    await this.run([
      '-y', '-loop', '1', '-i', inputPath, '-t', String(opts.durationSec),
      '-vf', filter,
      ...this.videoEncodeArgs,
      '-an', '-pix_fmt', 'yuv420p',
      outputPath,
    ]);
  }

  /**
   * AI 生成的分镜视频（image-to-video）适配为最终合成用的静音片段：统一画布/帧率/编码 + 去除模型
   * 自带音轨（最终旁白由 TTS 单独提供，不用模型生成的原生配音/环境音）+ 精确对齐到目标时长。
   * 视频模型有自己的 min/max 时长档位（见 atlas-models.json），生成结果不会刚好等于目标时长：
   * 用 tpad 冻结尾帧先垫长（垫长量=目标时长，足够覆盖"生成结果比目标还短"的情况），再用输出端 `-t`
   * 精确裁到目标时长——垫长与裁短两种偏差统一处理，不必先探测生成结果的实际时长。
   */
  async prepareGeneratedVideoClip(
    inputPath: string,
    outputPath: string,
    opts: { canvas: Canvas; durationSec: number },
  ): Promise<void> {
    this.assertAvailable();
    const filter =
      `${this.scaleFilter(opts.canvas, 'cover')},setsar=1,fps=30,` +
      `tpad=stop_mode=clone:stop_duration=${opts.durationSec.toFixed(3)}`;
    await this.run([
      '-y', '-i', inputPath,
      '-vf', filter,
      '-t', opts.durationSec.toFixed(3),
      ...this.videoEncodeArgs,
      '-an', '-pix_fmt', 'yuv420p',
      outputPath,
    ]);
  }

  /** 拼接已预处理（同画布/帧率/编码、无声）的片段；none/单片段走 concat demuxer，其余走 xfade 转场链 */
  async concatClips(clips: ClipPrepareResult[], outputPath: string, transition: string): Promise<void> {
    this.assertAvailable();
    if (!clips.length) throw new Error('没有可用的素材片段');
    if (clips.length === 1 || transition === 'none') {
      return this.concatByDemuxer(clips.map((c) => c.path), outputPath);
    }
    return this.concatByXfade(clips, outputPath, transition);
  }

  private async concatByDemuxer(paths: string[], outputPath: string): Promise<void> {
    const workDir = path.join(path.dirname(outputPath), `.concat_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(workDir, { recursive: true });
    try {
      // concat demuxer 在 Windows 下要求正斜杠路径，反斜杠会直接失败
      const listFile = path.join(workDir, 'list.txt');
      const listContent = paths.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
      fs.writeFileSync(listFile, listContent, 'utf-8');
      await this.run(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputPath]);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }

  private async concatByXfade(clips: ClipPrepareResult[], outputPath: string, transition: string): Promise<void> {
    const names = XFADE_TRANSITIONS[transition] ?? XFADE_TRANSITIONS.Shuffle;
    const inputs = clips.flatMap((c) => ['-i', c.path]);
    let filter = '';
    let lastLabel = '0:v';
    let cumulative = clips[0].durationSec;
    for (let i = 1; i < clips.length; i++) {
      const name = names[Math.floor(Math.random() * names.length)];
      const offset = Math.max(0, cumulative - XFADE_DURATION_SEC);
      const outLabel = `v${i}`;
      filter += `[${lastLabel}][${i}:v]xfade=transition=${name}:duration=${XFADE_DURATION_SEC}:offset=${offset.toFixed(3)}[${outLabel}];`;
      lastLabel = outLabel;
      cumulative = cumulative + clips[i].durationSec - XFADE_DURATION_SEC;
    }
    filter = filter.slice(0, -1);
    await this.run([
      '-y', ...inputs,
      '-filter_complex', filter,
      '-map', `[${lastLabel}]`,
      ...this.videoEncodeArgs,
      '-an', '-pix_fmt', 'yuv420p',
      outputPath,
    ]);
  }

  // ───────────────────────── 收尾合成（一键成片） ─────────────────────────

  /**
   * 收尾合成：把静音的拼接视频叠上字幕 + 固定浮层，混入旁白（必选）与 BGM（可选），
   * 并按 targetDurationSec 硬收口（素材拼接的累计时长本就会因转场重叠等原因产生小偏差，
   * 以配音时长这一权威参考做最终裁剪/停帧，而不是让上游各环节都去追求像素级精确）。
   */
  async composeFinal(
    silentVideoPath: string,
    outputPath: string,
    opts: {
      narrationAudioPath?: string;
      narrationVolume: number;
      bgmPath?: string;
      bgmVolume?: number;
      subtitleCues?: TimedCue[];
      subtitleStyle?: SubtitleStyle;
      overlays?: TextOverlay[];
      fontFilePath: string;
      targetDurationSec: number;
      /** 用于按画布宽度换行；不传时按竖屏 9:16 工作画布估算，避免字幕撑出画面 */
      canvas?: Canvas;
    },
  ): Promise<void> {
    this.assertAvailable();
    const workDir = path.join(os.tmpdir(), `.compose_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(workDir, { recursive: true });
    try {
      const drawtextFiles: DrawtextFile[] = [];
      // 静音片段拼接后的实际时长可能因转场交叉叠化而略短于配音时长（concatByXfade 每处转场都会
      // 吃掉 XFADE_DURATION_SEC 的重叠）；先用 tpad 冻结最后一帧充分垫长，再靠下方输出端的
      // -t 精确收口到 targetDurationSec——垫长与裁短两种偏差统一用这一套机制处理，无需提前探测实际时长。
      const videoFilterParts: string[] = [`tpad=stop_mode=clone:stop_duration=${opts.targetDurationSec.toFixed(3)}`];

      if (opts.subtitleCues?.length && opts.subtitleStyle) {
        const canvas = opts.canvas ?? COMPOSE_CANVAS['9:16'];
        const { filterParts, files } = buildSubtitleFilter(
          opts.subtitleCues,
          opts.subtitleStyle,
          opts.fontFilePath,
          workDir,
          canvas,
        );
        videoFilterParts.push(...filterParts);
        drawtextFiles.push(...files);
      }
      (opts.overlays ?? []).forEach((overlay, i) => {
        const { filterPart, file } = buildOverlayFilter(overlay, opts.fontFilePath, workDir, i);
        videoFilterParts.push(filterPart);
        drawtextFiles.push(file);
      });
      for (const file of drawtextFiles) fs.writeFileSync(file.path, file.content, 'utf-8');

      const hasNarration = Boolean(opts.narrationAudioPath);
      const inputs = ['-i', silentVideoPath];
      if (hasNarration) inputs.push('-i', opts.narrationAudioPath!);
      if (opts.bgmPath) inputs.push('-stream_loop', '-1', '-i', opts.bgmPath);

      const graph: string[] = [`[0:v]${videoFilterParts.join(',')}[vout]`];
      const bgmIndex = hasNarration ? 2 : 1;
      const duration = opts.targetDurationSec.toFixed(3);
      if (hasNarration) {
        graph.push(`[1:a]${VOICE_LOUDNORM},volume=${opts.narrationVolume}[va]`);
      } else {
        // 一键整片等路径：画面轨自带原生音，没有独立旁白
        graph.push(`[0:a]${VOICE_LOUDNORM},volume=1[va]`);
      }
      let aout = 'va';
      if (opts.bgmPath) {
        const bgmVol = opts.bgmVolume ?? 1;
        const fadeStart = Math.max(0, opts.targetDurationSec - 1);
        graph.push(
          `[${bgmIndex}:a]${BGM_LOUDNORM},atrim=0:${duration},asetpts=PTS-STARTPTS,afade=t=out:st=${fadeStart.toFixed(3)}:d=1,volume=${bgmVol}[ba]`,
        );
        graph.push(`[va][ba]amix=inputs=2:duration=first:dropout_transition=0[aout]`);
        aout = 'aout';
      }

      const args = [
        '-y', ...inputs,
        '-filter_complex', graph.join(';'),
        '-map', '[vout]',
        '-map', `[${aout}]`,
        '-t', duration,
        ...this.finalVideoEncodeArgs,
        '-c:a', 'aac', '-ar', '44100', '-ac', '2',
        '-pix_fmt', 'yuv420p',
        outputPath,
      ];
      await this.run(args);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }

  /** 生成一段静音音频，采样率/声道与 TTS 输出对齐，避免拼接时重采样 */
  async generateSilence(durationSec: number, outputPath: string): Promise<void> {
    this.assertAvailable();
    await this.run(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', Math.max(0.05, durationSec).toFixed(3), '-c:a', 'aac', outputPath]);
  }

  // ───────────────────────── 图片小工具（无限画布） ─────────────────────────

  /** 裁剪图片；坐标为像素 */
  async cropImage(inputPath: string, outputPath: string, cell: GridCell): Promise<void> {
    this.assertAvailable();
    await this.run(['-y', '-i', inputPath, '-vf', `crop=${cell.w}:${cell.h}:${cell.x}:${cell.y}`, '-frames:v', '1', outputPath]);
  }

  /** 等比放大图片（Lanczos 插值，不依赖模型，不扣费） */
  async scaleImage(inputPath: string, outputPath: string, factor: number): Promise<void> {
    this.assertAvailable();
    await this.run(['-y', '-i', inputPath, '-vf', `scale=iw*${factor}:ih*${factor}:flags=lanczos`, '-frames:v', '1', outputPath]);
  }

  /** 把带透明底的标注图叠到原图上，尺寸以原图为准（局部重绘：让模型看到要改的区域） */
  async overlayMask(imagePath: string, maskPath: string, outputPath: string): Promise<void> {
    this.assertAvailable();
    await this.run([
      '-y', '-i', imagePath, '-i', maskPath,
      '-filter_complex', '[1:v][0:v]scale2ref[m][b];[b][m]overlay',
      '-frames:v', '1', outputPath,
    ]);
  }

  /** 图片或视频首帧的缩略图（最长边 maxSide，JPEG），画布与列表用它代替原图渲染 */
  async thumbnail(inputPath: string, outputPath: string, isVideo: boolean, maxSide = 480): Promise<void> {
    this.assertAvailable();
    const scale = `scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))'`;
    await this.run(['-y', ...(isVideo ? ['-ss', '0.3'] : []), '-i', inputPath, '-vf', scale, '-frames:v', '1', '-q:v', '4', outputPath]);
  }

  /** 转成 H.264 MP4。HEVC 在多数浏览器里放不出来，下游模型也不一定收 */
  async toH264(inputPath: string, outputPath: string): Promise<void> {
    this.assertAvailable();
    await this.run([
      '-y', '-i', inputPath, '-map', '0:v:0', '-map', '0:a?',
      ...this.finalVideoEncodeArgs, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', outputPath,
    ]);
  }

  // ───────────────────────── 底层执行 ─────────────────────────

  private run(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.ffmpegPath, args);
      let stderr = '';
      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      proc.on('error', (err) => {
        const code = (err as NodeJS.ErrnoException).code;
        reject(
          new Error(
            code === 'ENOENT'
              ? `FFmpeg 启动失败: 找不到可执行文件（${this.ffmpegPath}），请安装 ffmpeg 或设置 FFMPEG_PATH`
              : `FFmpeg 启动失败: ${err.message}`,
          ),
        );
      });
      proc.on('close', (code) => {
        if (code === 0) return resolve();
        const tail = stderr.trim().slice(-800);
        this.logger.error(`FFmpeg exited with code ${code}\n${tail}`);
        reject(
          new Error(
            `FFmpeg 处理失败 (exit ${code})${tail ? `: ${tail.split('\n').filter(Boolean).slice(-3).join(' | ')}` : ''}`,
          ),
        );
      });
    });
  }

  private capture(args: string[]): Promise<{ code: number; output: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.ffmpegPath, args);
      let output = '';
      proc.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
      proc.stderr.on('data', (chunk) => {
        output += chunk.toString();
      });
      proc.on('error', (error) => {
        const code = (error as NodeJS.ErrnoException).code;
        reject(
          new Error(
            code === 'ENOENT'
              ? `FFmpeg 启动失败: 找不到可执行文件（${this.ffmpegPath}），请安装 ffmpeg 或设置 FFMPEG_PATH`
              : `FFmpeg 启动失败: ${error.message}`,
          ),
        );
      });
      proc.on('close', (code) => resolve({ code: code ?? -1, output }));
    });
  }
}
