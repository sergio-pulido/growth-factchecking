// claim -> embedding -> nearest facts -> Decisions -> verdict
import type { Decider, Embedder, FactSearch, LiveFactCheck } from './types.js';
import { mapVerdict } from './verdict.js';
import type { VerdictThresholds } from './verdict.js';

export type PipelineDeps = {
  embed: Embedder;
  search: FactSearch;
  decide: Decider;
  topK: number;
  thresholds: VerdictThresholds;
  cacheTtlMs: number;
  now?: () => number;
};

export type FactChecker = (claim: string) => Promise<LiveFactCheck>;

/** Collapses whitespace and case so near-identical captions (Meet) hit the cache. */
export function normalizeClaim(claim: string): string {
  return claim.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function createFactChecker(deps: PipelineDeps): FactChecker {
  const now = deps.now ?? (() => performance.now());
  const clock = () => Date.now();
  const cache = new Map<string, { at: number; value: LiveFactCheck }>();
  const MAX_CACHE = 500;

  return async (rawClaim) => {
    const claim = rawClaim.trim();
    const key = normalizeClaim(claim);

    if (deps.cacheTtlMs > 0) {
      const hit = cache.get(key);
      if (hit && clock() - hit.at < deps.cacheTtlMs) {
        return { ...hit.value, meta: { ...hit.value.meta, cached: true } };
      }
    }

    const t0 = now();
    const embedding = await deps.embed(claim);
    const t1 = now();
    const evidence = await deps.search(embedding, deps.topK);
    const t2 = now();

    let value: LiveFactCheck;
    if (evidence.length === 0) {
      // Spec rule: no evidence in the corpus -> neutral, no Decisions call.
      value = {
        result: { verdict: 'neutral', sources: [] },
        meta: {
          verdict: 'neutral',
          reason: 'no_evidence',
          relevance: null,
          confidence: null,
          evidenceCount: 0,
          cached: false,
          timings: { embedMs: t1 - t0, searchMs: t2 - t1, decideMs: 0, totalMs: t2 - t0 },
        },
      };
    } else {
      const outcome = await deps.decide(claim, evidence);
      const t3 = now();
      const mapped = mapVerdict(outcome, deps.thresholds);
      value = {
        result: {
          verdict: mapped.verdict,
          sources: evidence.map((f) => ({ statement: f.statement, sourceUrl: f.sourceUrl })),
        },
        meta: {
          verdict: mapped.verdict,
          reason: mapped.reason,
          relevance: outcome.relevance,
          confidence: outcome.confidence,
          evidenceCount: evidence.length,
          cached: false,
          timings: { embedMs: t1 - t0, searchMs: t2 - t1, decideMs: t3 - t2, totalMs: t3 - t0 },
        },
      };
    }

    if (deps.cacheTtlMs > 0) {
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: clock(), value });
    }
    return value;
  };
}
