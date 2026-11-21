// utterances -> store -> extract claims -> fact-check each -> store claims
import type { ArgumentRelevance, UtteranceBatchResult, UtteranceInput } from '@growth-factcheking/shared';
import { CONTEXT_TURNS, RELEVANCE_FAILED } from './argument-relevance.js';
import type { RelevanceAssessor } from './argument-relevance.js';
import type { ClaimChecker, ClaimExtractor, ClaimRecord, ConversationStore, ExtractedClaim, StoredUtterance } from './types.js';

export type IngestDeps = {
  store: ConversationStore;
  extract: ClaimExtractor;
  check: ClaimChecker;
  contextSize: number;
  /** Max fact-checks running at once for one batch. */
  checkConcurrency: number;
  /** Optional extra (off by default). When absent, nothing below changes and no extra call is made. */
  assessRelevance?: RelevanceAssessor;
  onError?: (stage: 'extract' | 'check' | 'relevance', error: unknown) => void;
};

export class ConversationClosedError extends Error {
  constructor(readonly state: 'ended' | 'missing') {
    super(`Conversation is ${state}.`);
  }
}

/** Runs fn over items with at most `limit` in flight; results keep the input order. */
async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker));
  return results;
}

export function createIngest(deps: IngestDeps) {
  const verify = async (claim: string): Promise<ClaimRecord['check']> => {
    try {
      return await deps.check(claim);
    } catch (error) {
      deps.onError?.('check', error);
      return null;
    }
  };

  // A relevance failure never affects the verdict: it only marks the extra field as failed.
  const assess = async (
    assessor: RelevanceAssessor,
    { utteranceId, claim }: ExtractedClaim,
    timeline: readonly StoredUtterance[],
  ): Promise<ArgumentRelevance> => {
    const position = timeline.findIndex((u) => u.id === utteranceId);
    try {
      if (position < 0) throw new Error('Claim has no matching utterance.');
      const utterance = timeline[position]!;
      return await assessor({ claim, speaker: utterance.speaker, utterance, previous: timeline.slice(0, position) });
    } catch (error) {
      deps.onError?.('relevance', error);
      return RELEVANCE_FAILED;
    }
  };

  const processClaim = (timeline: readonly StoredUtterance[]) => async (extracted: ExtractedClaim): Promise<ClaimRecord> => {
    const assessor = deps.assessRelevance;
    if (!assessor) return { ...extracted, check: await verify(extracted.claim) };
    const [check, argumentRelevance] = await Promise.all([verify(extracted.claim), assess(assessor, extracted, timeline)]);
    return { ...extracted, check, argumentRelevance };
  };

  return async (conversationId: string, utterances: readonly UtteranceInput[]): Promise<UtteranceBatchResult> => {
    const state = await deps.store.state(conversationId);
    if (state !== 'open') throw new ConversationClosedError(state);

    // Store first: the transcript is kept even if extraction or checking fails.
    const inserted = await deps.store.addUtterances(conversationId, utterances);
    const base = { accepted: inserted.length, duplicates: utterances.length - inserted.length };
    if (inserted.length === 0) return { ...base, extraction: 'skipped', claims: [] };

    let extracted: ExtractedClaim[];
    let timeline: StoredUtterance[];
    try {
      // The extra needs a few more earlier turns; extraction still gets exactly `contextSize` of them.
      const fetchSize = deps.assessRelevance ? Math.max(deps.contextSize, CONTEXT_TURNS) : deps.contextSize;
      const context = await deps.store.contextBefore(conversationId, inserted.map(({ id }) => id), fetchSize);
      timeline = [...context, ...inserted];
      extracted = await deps.extract(inserted, deps.contextSize > 0 ? context.slice(-deps.contextSize) : []);
    } catch (error) {
      deps.onError?.('extract', error);
      return { ...base, extraction: 'failed', claims: [] };
    }
    if (extracted.length === 0) return { ...base, extraction: 'ok', claims: [] };

    const records = await mapLimited(extracted, deps.checkConcurrency, processClaim(timeline));
    const claims = await deps.store.saveClaims(conversationId, records);
    return { ...base, extraction: 'ok', claims };
  };
}

export type Ingest = ReturnType<typeof createIngest>;
