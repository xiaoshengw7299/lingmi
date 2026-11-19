import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { AtlasLlmService } from '../atlas/atlas-llm.service';
import { CoverrService } from './coverr.service';
import { OpenverseService } from './openverse.service';
import { PexelsService } from './pexels.service';
import { PixabayService } from './pixabay.service';
import { WikimediaService } from './wikimedia.service';
import {
  ALL_STOCK_SOURCES,
  DEFAULT_STOCK_SOURCES,
  STOCK_SOURCE_META,
  StockClip,
  StockMatchHit,
  StockMatchQuery,
  StockMatchRules,
  StockProviderOption,
  StockSearchOpts,
  StockSourceId,
} from './stock.types';

const DEFAULT_RULES: StockMatchRules = { semantic: true, dedupe: true };

/**
 * 共用选片引擎：多源并行检索 → 关键词启发打分 → 可选 LLM 语义重排 → 跨镜去重。
 * 一键成片选片走这里，避免各处各写一套「随机抽一条 Pexels」。
 */
@Injectable()
export class StockMatchService {
  private readonly logger = new Logger(StockMatchService.name);

  constructor(
    private readonly pexels: PexelsService,
    private readonly pixabay: PixabayService,
    private readonly coverr: CoverrService,
    private readonly wikimedia: WikimediaService,
    private readonly openverse: OpenverseService,
    private readonly atlasLlm: AtlasLlmService,
  ) {}

  listProviders(): StockProviderOption[] {
    return ALL_STOCK_SOURCES.map((value) => ({
      value,
      label: STOCK_SOURCE_META[value].label,
      hint: STOCK_SOURCE_META[value].hint,
      configured: this.isConfigured(value),
    }));
  }

  isConfigured(source: StockSourceId): boolean {
    if (source === 'pexels') return this.pexels.configured;
    if (source === 'pixabay') return this.pixabay.configured;
    if (source === 'coverr') return this.coverr.configured;
    return true;
  }

  anyConfigured(sources?: string[] | null): boolean {
    return this.resolveSources(sources).some((s) => this.isConfigured(s));
  }

  resolveSources(sources?: string[] | null): StockSourceId[] {
    const requested = (sources ?? []).filter((item): item is StockSourceId =>
      ALL_STOCK_SOURCES.includes(item as StockSourceId),
    );
    const pool = requested.length ? requested : [...DEFAULT_STOCK_SOURCES];
    const available = pool.filter((s) => this.isConfigured(s));
    if (available.length) return available;
    const fallback = ALL_STOCK_SOURCES.filter((s) => this.isConfigured(s));
    if (fallback.length) this.logger.warn(`所选素材源均不可用，已回退到: ${fallback.join(',')}`);
    return fallback;
  }

  async searchAll(term: string, sources: StockSourceId[], opts: StockSearchOpts): Promise<StockClip[]> {
    const tasks = sources.map((source) => this.searchOne(source, term, opts));
    const pools = await Promise.all(tasks);
    const seen = new Set<string>();
    const merged: StockClip[] = [];
    for (const clip of pools.flat()) {
      if (seen.has(clip.id) || seen.has(clip.url)) continue;
      seen.add(clip.id);
      seen.add(clip.url);
      merged.push(clip);
    }
    merged.sort((a, b) => Number(a.mediaType === 'image') - Number(b.mediaType === 'image'));
    return merged;
  }

  /**
   * 按分镜/关键词批次选片。skip 的查询不检索；失败的查询不出现在结果里，由调用方决定 AI 兜底。
   */
  async matchQueries(opts: {
    queries: StockMatchQuery[];
    sources?: string[];
    orientation: StockSearchOpts['orientation'];
    minDurationSec: number;
    rules?: Partial<StockMatchRules>;
    /** 重新获取时避开用户刚看过或删掉的素材 */
    excludeIds?: string[];
  }): Promise<StockMatchHit[]> {
    const rules: StockMatchRules = { ...DEFAULT_RULES, ...opts.rules };
    const sources = this.resolveSources(opts.sources);
    const active = opts.queries.filter((q) => !q.skip && q.term.trim());
    const hits: StockMatchHit[] = [];
    const used = new Set<string>();
    const banned = new Set(opts.excludeIds ?? []);

    for (const query of active) {
      const candidates = await this.searchAll(query.term, sources, {
        orientation: opts.orientation,
        minDurationSec: opts.minDurationSec,
        perPage: banned.size ? 15 : 8,
      });
      const fresh = banned.size ? candidates.filter((c) => !banned.has(c.id)) : candidates;
      const unused = rules.dedupe ? fresh.filter((c) => !used.has(c.id)) : fresh;
      const videos = unused.filter((c) => c.mediaType !== 'image');
      const available = videos.length ? videos : unused;
      if (!available.length) continue;

      let matchedBy: 'semantic' | 'heuristic' = 'heuristic';
      let picked: StockClip | undefined;
      if (rules.semantic && query.voiceover) {
        picked = await this.rerankByLlm(query, available);
        if (picked) matchedBy = 'semantic';
      }
      if (!picked) picked = this.pickByHeuristic(query, available);
      if (!picked) continue;

      used.add(picked.id);
      hits.push({ queryId: query.id, clip: picked, matchedBy });
    }
    return hits;
  }

  private async searchOne(source: StockSourceId, term: string, opts: StockSearchOpts): Promise<StockClip[]> {
    if (source === 'pexels') return this.pexels.search(term, opts);
    if (source === 'pixabay') return this.pixabay.search(term, opts);
    if (source === 'coverr') return this.coverr.search(term, opts);
    if (source === 'openverse') return this.openverse.search(term, opts);
    return this.wikimedia.search(term, opts);
  }

  private pickByHeuristic(query: StockMatchQuery, clips: StockClip[]): StockClip | undefined {
    if (!clips.length) return undefined;
    const tokens = this.tokens(`${query.term} ${query.voiceover ?? ''}`);
    let best = clips[0];
    let bestScore = -1;
    for (const clip of clips) {
      const hay = this.tokens(`${clip.title ?? ''} ${(clip.tags ?? []).join(' ')}`);
      const overlap = tokens.filter((t) => hay.includes(t)).length;
      const durationBonus = clip.durationSec >= 5 ? 1 : 0;
      const videoBonus = clip.mediaType === 'image' ? 0 : 2;
      const score = overlap * 3 + durationBonus + videoBonus;
      if (score > bestScore) {
        best = clip;
        bestScore = score;
      }
    }
    return bestScore > 0 ? best : clips[Math.floor(Math.random() * clips.length)];
  }

  private async rerankByLlm(query: StockMatchQuery, clips: StockClip[]): Promise<StockClip | undefined> {
    const top = clips.slice(0, 8);
    try {
      const object = await this.atlasLlm.generateJson({
        kind: 'llm',
        schema: z.object({
          id: z.coerce.string().describe('选中的素材 id，必须来自候选列表'),
        }),
        instructions:
          '你是短视频选片助理。根据旁白语义，从候选素材里挑一条画面最贴切、最不像广告空镜的。只返回素材 id。',
        prompt:
          `旁白：${query.voiceover}\n检索词：${query.term}\n候选：\n` +
          top
            .map(
              (c, i) =>
                `${i + 1}. id=${c.id} source=${c.source} type=${c.mediaType ?? 'video'} title=${c.title ?? '-'} tags=${(c.tags ?? []).join('/')}`,
            )
            .join('\n'),
        temperature: 0.2,
        maxOutputTokens: 80,
      });
      return top.find((c) => c.id === object.id) ?? undefined;
    } catch (error) {
      this.logger.warn(`选片语义重排失败，回退关键词启发: ${error instanceof Error ? error.message : error}`);
      return undefined;
    }
  }

  private tokens(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
  }
}
