// One fact-checked call: reads its source (captions or tab audio) after the user presses Start, sends final
// utterances to the local API in batches and keeps the claims it returns. Spec: docs/specs/call-overlay.md
import { CLAIM_MAX_LENGTH, SPEAKER_MAX, UTTERANCE_BATCH_MAX, UTTERANCE_TEXT_MAX } from '@growth-factcheking/shared';
import type { ClaimCheck, UtteranceBatchResult, UtteranceInput } from '@growth-factcheking/shared';
import { speakerKindOf } from './platforms.js';
import { normalizeTerms } from './terms.js';
import { CallTransportError } from './types.js';
import type {
  CallTransport, CaptureSource, ClaimItem, Segment, SessionSnapshot, SessionState, TranscriptLine,
} from './types.js';

export type SessionEvents = {
  onChange(snapshot: SessionSnapshot): void;
  /** A claim got a verdict (first check or retry). */
  onVerdict(item: ClaimItem): void;
};

export type SessionOptions = {
  title?: () => string | undefined;
  pageUrl?: () => string | undefined;
};

const FLUSH_DELAY_MS = 250;
const FLUSH_NOW_AT = 4;
const RETRY_MS = 4000;

function message(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Could not reach the local API.';
}

export function createCallSession(
  source: CaptureSource, transport: CallTransport, events: SessionEvents, options: SessionOptions = {},
) {
  let state: SessionState = 'idle';
  let conversationId: string | null = null;
  let startedAt: number | null = null;
  let claims: ClaimItem[] = [];
  let transcript: TranscriptLine[] = [];
  let draft = '';
  let queue: UtteranceInput[] = [];
  let analyzing = 0;
  let inflight: Promise<boolean> | null = null;
  let disposed = false;
  let failedWhileStarting: string | null = null;
  let found = false;
  let voice = false;
  let notice: string | null = null;
  let seq = 0;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let flushAt = Infinity;
  let retryAt = 0;

  const elapsed = () => (startedAt === null ? 0 : Math.max(0, (Date.now() - startedAt) / 1000));

  function snapshot(): SessionSnapshot {
    return {
      state, startedAt, claims, transcript, draft: state === 'live' ? draft : '', analyzing, found,
      voice: state === 'live' && voice, notice,
    };
  }
  const changed = () => events.onChange(snapshot());

  const sink = {
    segments(list: readonly Segment[]) {
      if (state !== 'live' || list.length === 0) return;
      list.forEach(enqueue);
      changed();
    },
    draft(text: string) {
      if (state !== 'live' || text === draft) return;
      draft = text;
      changed();
    },
    activity(next: { found: boolean; voice: boolean }) {
      if (next.found === found && next.voice === voice) return;
      found = next.found;
      voice = next.voice;
      changed();
    },
    failed(reason: string) {
      if (state === 'starting') {
        failedWhileStarting = reason;
        return;
      }
      notice = reason;
      void stop();
    },
  };

  function enqueue({ speaker, text: raw, kind }: Segment) {
    const text = normalizeTerms(raw);
    // Call apps sometimes re-render a caption block as a new node with the same words: send them once.
    const name = (speaker || 'Participant').slice(0, SPEAKER_MAX);
    if (transcript.slice(-5).some((line) => line.speaker === name && line.text === text)) return;
    const clientId = `u${++seq}`;
    const at = elapsed();
    transcript = [...transcript, { clientId, speaker: name, text, at }];
    queue = [...queue, {
      clientId, speaker: name, speakerKind: kind ?? speakerKindOf(speaker), text: text.slice(0, UTTERANCE_TEXT_MAX),
      spokenAt: new Date().toISOString(),
    }];
    if (!inflight) scheduleFlush(queue.length >= FLUSH_NOW_AT ? 0 : FLUSH_DELAY_MS);
  }

  function cancelFlush() {
    clearTimeout(flushTimer);
    flushTimer = undefined;
    flushAt = Infinity;
  }

  function scheduleFlush(delay: number) {
    const now = Date.now();
    const due = Math.max(now + delay, retryAt);
    if (due >= flushAt) return;
    cancelFlush();
    flushAt = due;
    flushTimer = setTimeout(() => {
      cancelFlush();
      void flush();
    }, due - now);
  }

  function toItem(check: ClaimCheck): ClaimItem {
    const line = transcript.find(({ clientId }) => clientId === check.utteranceClientId);
    return {
      id: check.id, claim: check.claim, speaker: check.speaker, at: line?.at ?? elapsed(),
      state: check.status === 'checked' && check.verdict ? 'checked' : 'failed',
      verdict: check.verdict, sources: check.sources, open: false, basis: check.basis ?? 'corpus',
    };
  }

  /**
   * A retried batch the API had already stored comes back as duplicates without its claims (the first response
   * was lost, e.g. on a timeout). Fetch the conversation's claims so they still reach the overlay.
   */
  async function withRecoveredClaims(id: string, result: UtteranceBatchResult): Promise<ClaimCheck[]> {
    if (!(result.duplicates > 0)) return result.claims;
    const known = new Set([...claims.map((item) => item.id), ...result.claims.map((check) => check.id)]);
    try {
      const stored = await transport.claims(id);
      return [...result.claims, ...stored.filter((check) => !known.has(check.id))];
    } catch {
      return result.claims;
    }
  }

  /** Sends the next batch. While one is in flight, returns that one instead of starting another. */
  function flush(): Promise<boolean> {
    if (inflight) return inflight;
    if (queue.length === 0 || !conversationId) return Promise.resolve(queue.length === 0);
    inflight = sendBatch(conversationId).finally(() => {
      inflight = null;
      if (queue.length && (state === 'live' || state === 'paused')) scheduleFlush(0);
    });
    return inflight;
  }

  async function sendBatch(conversationId: string): Promise<boolean> {
    const batch = queue.slice(0, UTTERANCE_BATCH_MAX);
    analyzing = batch.length;
    changed();
    try {
      const result = await transport.send(conversationId, batch);
      retryAt = 0;
      queue = queue.slice(batch.length);
      const fresh = (await withRecoveredClaims(conversationId, result)).map(toItem);
      claims = [...claims, ...fresh];
      notice = result.extraction === 'failed' ? 'Could not extract claims from what was just said. The transcript was saved.' : null;
      fresh.filter((item) => item.state === 'checked').forEach(events.onVerdict);
      return true;
    } catch (error) {
      notice = message(error);
      if (error instanceof CallTransportError && error.code !== 'unavailable') {
        queue = [];
        draft = '';
        source.stop();
        cancelFlush();
        state = 'ended';
      } else {
        retryAt = Date.now() + RETRY_MS;
      }
      return false;
    } finally {
      analyzing = 0;
      changed();
    }
  }

  async function start() {
    if (state !== 'idle' && state !== 'ended') return;
    state = 'starting';
    notice = null;
    claims = [];
    transcript = [];
    draft = '';
    queue = [];
    retryAt = 0;
    found = false;
    voice = false;
    changed();
    try {
      ({ id: conversationId } = await transport.start({
        platform: source.platform, capture: source.capture, title: options.title?.(), pageUrl: options.pageUrl?.(),
      }));
    } catch (error) {
      state = 'idle';
      notice = message(error);
      changed();
      return;
    }
    if (disposed) {
      // The panel went away while the conversation was being created.
      void transport.end(conversationId!).catch(() => undefined);
      return;
    }
    startedAt = Date.now();
    failedWhileStarting = null;
    try {
      await source.start(sink);
      if (disposed) throw new Error('closed');
      if (failedWhileStarting) throw new Error(failedWhileStarting);
    } catch (error) {
      if (disposed || failedWhileStarting) source.stop();
      notice = message(error);
      const id = conversationId!;
      conversationId = null;
      state = 'idle';
      // Nothing was captured: remove the empty conversation instead of leaving it behind.
      void transport.remove(id).catch(() => undefined);
      changed();
      return;
    }
    state = 'live';
    changed();
  }

  function pause() {
    if (state !== 'live') return;
    // Finished sentences said before the pause are kept; a half-said sentence is not checked.
    source.pause().forEach(enqueue);
    draft = '';
    voice = false;
    state = 'paused';
    changed();
  }

  function resume() {
    if (state !== 'paused') return;
    // Whatever was said while paused stays out of the transcript.
    source.resume();
    state = 'live';
    changed();
  }

  async function stop() {
    if (state !== 'live' && state !== 'paused') return;
    const wasLive = state === 'live';
    const rest = source.stop();
    if (wasLive) rest.forEach(enqueue);
    draft = '';
    state = 'ending';
    cancelFlush();
    changed();
    // Wait for a batch already in flight, then send what is left before ending the conversation.
    if (inflight) await inflight;
    for (let attempt = 0; attempt < 3 && queue.length; attempt++) {
      if (!(await flush())) break;
    }
    if (conversationId) {
      try {
        await transport.end(conversationId);
      } catch (error) {
        notice = message(error);
      }
    }
    if (queue.length) notice = `${queue.length} sentences could not be saved.`;
    queue = [];
    state = 'ended';
    changed();
  }

  async function remove() {
    if (state !== 'ended' || !conversationId) return;
    try {
      await transport.remove(conversationId);
    } catch (error) {
      notice = message(error);
      changed();
      return;
    }
    conversationId = null;
    startedAt = null;
    claims = [];
    transcript = [];
    transport.badge?.(0);
    state = 'idle';
    notice = 'Conversation deleted from the local database.';
    changed();
  }

  function patchClaim(id: string, patch: Partial<ClaimItem>) {
    claims = claims.map((item) => (item.id === id ? { ...item, ...patch } : item));
    changed();
    return claims.find((item) => item.id === id);
  }

  /** Re-checks a claim; with `text`, replaces the claim's wording first (fixes a caption mistake). */
  async function retry(id: string, text?: string) {
    const item = claims.find((claim) => claim.id === id);
    if (!item || item.state === 'retrying') return;
    const claim = text?.trim() ? text.trim().slice(0, CLAIM_MAX_LENGTH) : item.claim;
    patchClaim(id, { state: 'retrying', claim, edited: item.edited || claim !== item.claim });
    try {
      const result = await transport.recheck(claim);
      const done = patchClaim(id, {
        state: 'checked', verdict: result.verdict, sources: result.sources, basis: result.basis ?? 'corpus',
      });
      if (done) events.onVerdict(done);
    } catch (error) {
      notice = message(error);
      patchClaim(id, { state: 'failed' });
    }
  }

  function toggleSources(id: string) {
    const item = claims.find((claim) => claim.id === id);
    if (item) patchClaim(id, { open: !item.open });
  }

  function endOnLeave() {
    if (state !== 'live' && state !== 'paused') return;
    source.stop();
    draft = '';
    cancelFlush();
    state = 'ended';
    if (conversationId) void transport.end(conversationId).catch(() => undefined);
  }
  globalThis.addEventListener?.('pagehide', endOnLeave);

  return {
    start, pause, resume, stop, remove, retry, toggleSources, snapshot,
    dispose() {
      disposed = true;
      // Leaving a call inside a single-page app does not fire pagehide.
      endOnLeave();
      globalThis.removeEventListener?.('pagehide', endOnLeave);
    },
  };
}

export type CallSession = ReturnType<typeof createCallSession>;
