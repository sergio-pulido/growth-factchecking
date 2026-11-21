// One fact-checked call: reads its source (captions or tab audio) after the user presses Start, sends final
// utterances to the local API in batches and keeps the claims it returns. Spec: docs/specs/call-overlay.md
import { SPEAKER_MAX, UTTERANCE_BATCH_MAX, UTTERANCE_TEXT_MAX } from '@growth-factcheking/shared';
import type { ClaimCheck, UtteranceInput } from '@growth-factcheking/shared';
import { speakerKindOf } from './platforms.js';
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

const FLUSH_DELAY_MS = 1200;
const FLUSH_NOW_AT = 4;
const RETRY_MS = 4000;

function message(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'No se pudo contactar con la API local.';
}

export function createCallSession(
  source: CaptureSource, transport: CallTransport, events: SessionEvents, options: SessionOptions = {},
) {
  let state: SessionState = 'idle';
  let conversationId: string | null = null;
  let startedAt: number | null = null;
  let claims: ClaimItem[] = [];
  let transcript: TranscriptLine[] = [];
  let queue: UtteranceInput[] = [];
  let analyzing = 0;
  let inflight: Promise<boolean> | null = null;
  let disposed = false;
  let failedWhileStarting: string | null = null;
  let found = false;
  let voice = false;
  let notice: string | null = null;
  let seq = 0;
  let flushTimer = 0;

  const elapsed = () => (startedAt === null ? 0 : Math.max(0, (Date.now() - startedAt) / 1000));

  function snapshot(): SessionSnapshot {
    return {
      state, startedAt, claims, transcript, analyzing, found, voice: state === 'live' && voice, notice,
    };
  }
  const changed = () => events.onChange(snapshot());

  const sink = {
    segments(list: readonly Segment[]) {
      if (state !== 'live' || list.length === 0) return;
      list.forEach(enqueue);
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

  function enqueue({ speaker, text, kind }: Segment) {
    // Call apps sometimes re-render a caption block as a new node with the same words: send them once.
    const name = (speaker || 'Participante').slice(0, SPEAKER_MAX);
    if (transcript.slice(-5).some((line) => line.speaker === name && line.text === text)) return;
    const clientId = `u${++seq}`;
    const at = elapsed();
    transcript = [...transcript, { clientId, speaker: name, text, at }];
    queue = [...queue, {
      clientId, speaker: name, speakerKind: kind ?? speakerKindOf(speaker), text: text.slice(0, UTTERANCE_TEXT_MAX),
      spokenAt: new Date().toISOString(),
    }];
    scheduleFlush(queue.length >= FLUSH_NOW_AT ? 0 : FLUSH_DELAY_MS);
  }

  function scheduleFlush(delay: number) {
    window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => void flush(), delay);
  }

  function toItem(check: ClaimCheck): ClaimItem {
    const line = transcript.find(({ clientId }) => clientId === check.utteranceClientId);
    return {
      id: check.id, claim: check.claim, speaker: check.speaker, at: line?.at ?? elapsed(),
      state: check.status === 'checked' && check.verdict ? 'checked' : 'failed',
      verdict: check.verdict, sources: check.sources, open: false,
    };
  }

  /** Sends the next batch. While one is in flight, returns that one instead of starting another. */
  function flush(): Promise<boolean> {
    if (inflight) return inflight;
    if (queue.length === 0 || !conversationId) return Promise.resolve(queue.length === 0);
    inflight = sendBatch(conversationId).finally(() => {
      inflight = null;
    });
    return inflight;
  }

  async function sendBatch(conversationId: string): Promise<boolean> {
    const batch = queue.slice(0, UTTERANCE_BATCH_MAX);
    let retryIn = FLUSH_DELAY_MS;
    analyzing = batch.length;
    changed();
    try {
      const result = await transport.send(conversationId, batch);
      queue = queue.slice(batch.length);
      const fresh = result.claims.map(toItem);
      claims = [...claims, ...fresh];
      notice = result.extraction === 'failed' ? 'No se pudieron extraer afirmaciones de lo último que se dijo. La transcripción se ha guardado.' : null;
      fresh.filter((item) => item.state === 'checked').forEach(events.onVerdict);
      return true;
    } catch (error) {
      notice = message(error);
      if (error instanceof CallTransportError && error.code !== 'unavailable') {
        queue = [];
        source.stop();
        window.clearTimeout(flushTimer);
        state = 'ended';
      } else {
        retryIn = RETRY_MS;
      }
      return false;
    } finally {
      analyzing = 0;
      changed();
      if (queue.length && (state === 'live' || state === 'paused')) scheduleFlush(retryIn);
    }
  }

  async function start() {
    if (state !== 'idle' && state !== 'ended') return;
    state = 'starting';
    notice = null;
    claims = [];
    transcript = [];
    queue = [];
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
    state = 'ending';
    window.clearTimeout(flushTimer);
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
    if (queue.length) notice = `${queue.length} frases no se pudieron guardar.`;
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
    notice = 'Conversación borrada de la base de datos local.';
    changed();
  }

  function patchClaim(id: string, patch: Partial<ClaimItem>) {
    claims = claims.map((item) => (item.id === id ? { ...item, ...patch } : item));
    changed();
    return claims.find((item) => item.id === id);
  }

  async function retry(id: string) {
    const item = claims.find((claim) => claim.id === id);
    if (!item || item.state === 'retrying') return;
    patchClaim(id, { state: 'retrying' });
    try {
      const result = await transport.recheck(item.claim);
      const done = patchClaim(id, { state: 'checked', verdict: result.verdict, sources: result.sources });
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
    window.clearTimeout(flushTimer);
    state = 'ended';
    if (conversationId) void transport.end(conversationId).catch(() => undefined);
  }
  window.addEventListener('pagehide', endOnLeave);

  return {
    start, pause, resume, stop, remove, retry, toggleSources, snapshot,
    dispose() {
      disposed = true;
      // Leaving a call inside a single-page app does not fire pagehide.
      endOnLeave();
      window.removeEventListener('pagehide', endOnLeave);
    },
  };
}

export type CallSession = ReturnType<typeof createCallSession>;
