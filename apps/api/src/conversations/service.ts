// utterances -> store -> extract claims -> fact-check each -> store claims
import type { UtteranceBatchResult, UtteranceInput } from '@growth-factcheking/shared';
import type { ClaimChecker, ClaimExtractor, ClaimRecord, ConversationStore, ExtractedClaim } from './types.js';

export type IngestDeps = {
  store: ConversationStore;
  extract: ClaimExtractor;
  check: ClaimChecker;
  contextSize: number;
  /** Max fact-checks running at once for one batch. */
  checkConcurrency: number;
  onError?: (stage: 'extract' | 'check', error: unknown) => void;
};

export class ConversationClosedError extends Error {
  constructor(readonly state: 'ended' | 'missing') {
    super(`Conversation is ${state}.`);
  }
}

/** Runs fn over items with at most `limit` in flight; results keep the input order. */
async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
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
  const checkOne = async ({ utteranceId, claim }: ExtractedClaim): Promise<ClaimRecord> => {
    try {
      return { utteranceId, claim, check: await deps.check(claim) };
    } catch (error) {
      deps.onError?.('check', error);
      return { utteranceId, claim, check: null };
    }
  };

  return async (conversationId: string, utterances: readonly UtteranceInput[]): Promise<UtteranceBatchResult> => {
    const state = await deps.store.state(conversationId);
    if (state !== 'open') throw new ConversationClosedError(state);

    // Store first: the transcript is kept even if extraction or checking fails.
    const inserted = await deps.store.addUtterances(conversationId, utterances);
    const base = { accepted: inserted.length, duplicates: utterances.length - inserted.length };
    if (inserted.length === 0) return { ...base, extraction: 'skipped', claims: [] };

    let extracted: ExtractedClaim[];
    try {
      const context = await deps.store.contextBefore(conversationId, inserted.map(({ id }) => id), deps.contextSize);
      extracted = await deps.extract(inserted, context);
    } catch (error) {
      deps.onError?.('extract', error);
      return { ...base, extraction: 'failed', claims: [] };
    }
    if (extracted.length === 0) return { ...base, extraction: 'ok', claims: [] };

    const records = await mapLimited(extracted, deps.checkConcurrency, checkOne);
    const claims = await deps.store.saveClaims(conversationId, records);
    return { ...base, extraction: 'ok', claims };
  };
}

export type Ingest = ReturnType<typeof createIngest>;
