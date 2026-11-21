// One capture session: create the conversation, send final utterances in batches, retry with the same
// clientIds, drain on stop and end the conversation. Network and timers are injected for testing.
import type {
  ClaimCheck,
  ConversationCreateRequest,
  ConversationCreateResult,
  UtteranceBatchResult,
  UtteranceInput,
} from '@growth-factcheking/shared';

/** status 0 means the API could not be reached. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

export type ConversationApi = {
  create(body: ConversationCreateRequest): Promise<ApiResult<ConversationCreateResult>>;
  sendUtterances(conversationId: string, utterances: readonly UtteranceInput[]): Promise<ApiResult<UtteranceBatchResult>>;
  end(conversationId: string): Promise<ApiResult<null>>;
};

export type Scheduler = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type CaptureStatus = 'idle' | 'starting' | 'capturing' | 'stopping' | 'stopped' | 'error';

export type CaptureErrorKind =
  /** The local API is down or unreachable. */
  | 'api_unreachable'
  /** The API answered 503: OpenAI or Postgres is missing or failing. Batches are retried. */
  | 'service_unavailable'
  /** The conversation was ended or deleted elsewhere (409/404). Capture stops. */
  | 'conversation_closed'
  /** The API rejected a batch as invalid (400). The batch is dropped. */
  | 'rejected';

export type CaptureError = { kind: CaptureErrorKind; message: string; at: string };

export type CaptureState = {
  status: CaptureStatus;
  conversationId: string | null;
  startedAt: string | null;
  /** Utterances stored by the API (first time). */
  sent: number;
  /** Utterances the API already had (retries). */
  duplicates: number;
  /** Final utterances waiting to be sent. */
  pending: number;
  /** Batches whose claim extraction failed on the API; their transcript is stored. */
  extractionFailures: number;
  claims: ClaimCheck[];
  /** Latest problem; cleared by the next successful request. */
  error: CaptureError | null;
};

export type SessionOptions = {
  api: ConversationApi;
  scheduler: Scheduler;
  now?: () => number;
  flushIntervalMs?: number;
  maxBatch?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  /** Attempts per batch while stopping before giving up and ending the conversation. */
  stopAttempts?: number;
  onState?: (state: CaptureState) => void;
};

export const INITIAL_CAPTURE_STATE: CaptureState = {
  status: 'idle',
  conversationId: null,
  startedAt: null,
  sent: 0,
  duplicates: 0,
  pending: 0,
  extractionFailures: 0,
  claims: [],
  error: null,
};

const MESSAGES: Record<CaptureErrorKind, string> = {
  api_unreachable: 'Cannot reach the local API. Sending will be retried.',
  service_unavailable: 'Fact-checking is unavailable right now. Sending will be retried.',
  conversation_closed: 'This conversation no longer accepts utterances. Capture has stopped.',
  rejected: 'The API rejected a batch of utterances.',
};

function errorKind(status: number): CaptureErrorKind {
  if (status === 0) return 'api_unreachable';
  if (status === 404 || status === 409) return 'conversation_closed';
  if (status >= 400 && status < 500) return 'rejected';
  return 'service_unavailable';
}

export type CaptureSession = {
  start(meta: Omit<ConversationCreateRequest, 'platform' | 'capture'>): Promise<CaptureState>;
  enqueue(utterances: readonly UtteranceInput[]): void;
  /** Sends what is pending now. Resolves when the in-flight batch settles. */
  flush(): Promise<void>;
  /** Sends `final` and everything pending, then ends the conversation. */
  stop(final?: readonly UtteranceInput[]): Promise<CaptureState>;
  state(): CaptureState;
};

export function createCaptureSession(options: SessionOptions): CaptureSession {
  const now = options.now ?? Date.now;
  const flushIntervalMs = options.flushIntervalMs ?? 3000;
  const maxBatch = Math.min(options.maxBatch ?? 10, 50);
  const retryBaseMs = options.retryBaseMs ?? 1000;
  const retryMaxMs = options.retryMaxMs ?? 15_000;
  const stopAttempts = options.stopAttempts ?? 3;

  let state: CaptureState = INITIAL_CAPTURE_STATE;
  let queue: UtteranceInput[] = [];
  let timer: unknown = null;
  let inFlight: Promise<boolean> | null = null;
  let failures = 0;

  // Read through a function: `set` changes the status inside async flows, which TS cannot narrow across.
  const status = (): CaptureStatus => state.status;
  const set = (patch: Partial<CaptureState>): void => {
    state = { ...state, ...patch, pending: queue.length };
    options.onState?.(state);
  };
  const fail = (kind: CaptureErrorKind, detail?: string): CaptureError => ({
    kind,
    message: detail && kind === 'rejected' ? `${MESSAGES[kind]} ${detail}` : MESSAGES[kind],
    at: new Date(now()).toISOString(),
  });

  const schedule = (ms: number): void => {
    if (timer !== null) options.scheduler.clearTimeout(timer);
    timer = options.scheduler.setTimeout(() => {
      timer = null;
      void flushOnce().then((ok) => {
        if (state.status === 'capturing' && queue.length > 0) schedule(ok ? 0 : backoff());
      });
    }, ms);
  };
  const backoff = (): number => Math.min(retryBaseMs * 2 ** Math.max(failures - 1, 0), retryMaxMs);

  /** Sends one batch. Returns false when it must be retried. */
  const sendBatch = async (): Promise<boolean> => {
    const id = state.conversationId;
    if (!id || queue.length === 0) return true;
    // The batch stays queued until the API confirms it: a retry re-sends the same clientIds.
    const batch = queue.slice(0, maxBatch);
    const result = await options.api.sendUtterances(id, batch);
    if (result.ok) {
      failures = 0;
      queue = queue.slice(batch.length);
      set({
        sent: state.sent + result.data.accepted,
        duplicates: state.duplicates + result.data.duplicates,
        extractionFailures: state.extractionFailures + (result.data.extraction === 'failed' ? 1 : 0),
        claims: [...state.claims, ...result.data.claims],
        error: null,
      });
      return true;
    }
    const kind = errorKind(result.status);
    if (kind === 'rejected') {
      queue = queue.slice(batch.length);
      set({ error: fail(kind, result.message) });
      return true;
    }
    if (kind === 'conversation_closed') {
      queue = [];
      if (timer !== null) options.scheduler.clearTimeout(timer);
      timer = null;
      set({ status: 'error', error: fail(kind) });
      return true;
    }
    failures++;
    set({ error: fail(kind) });
    return false;
  };

  const flushOnce = (): Promise<boolean> => {
    if (inFlight) return inFlight;
    inFlight = sendBatch().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    async start(meta) {
      if (state.status === 'starting' || state.status === 'capturing' || state.status === 'stopping') return state;
      queue = [];
      failures = 0;
      set({ ...INITIAL_CAPTURE_STATE, status: 'starting' });
      const result = await options.api.create({ platform: 'meet', capture: 'captions', ...meta });
      if (!result.ok) {
        set({ status: 'error', error: fail(result.status === 503 ? 'service_unavailable' : errorKind(result.status)) });
        return state;
      }
      set({ status: 'capturing', conversationId: result.data.id, startedAt: new Date(now()).toISOString() });
      return state;
    },

    enqueue(utterances) {
      if (state.status !== 'capturing' && state.status !== 'stopping') return;
      if (utterances.length === 0) return;
      queue = [...queue, ...utterances];
      set({});
      // A timer that fires during an in-flight batch joins it, then reschedules for what is left.
      if (state.status !== 'capturing' || timer !== null) return;
      schedule(queue.length >= maxBatch ? 0 : flushIntervalMs);
    },

    async flush() {
      await flushOnce();
    },

    async stop(final = []) {
      if (state.status !== 'capturing' && !(state.status === 'error' && state.conversationId)) return state;
      if (timer !== null) options.scheduler.clearTimeout(timer);
      timer = null;
      const id = state.conversationId!;
      const closed = state.error?.kind === 'conversation_closed';
      queue = closed ? [] : [...queue, ...final];
      set({ status: 'stopping' });

      let attempts = 0;
      if (inFlight) await inFlight;
      while (queue.length > 0 && attempts < stopAttempts && status() === 'stopping') {
        const ok = await flushOnce();
        attempts = ok ? 0 : attempts + 1;
        if (!ok && attempts < stopAttempts) {
          await new Promise<void>((resolve) => options.scheduler.setTimeout(resolve, backoff()));
        }
      }
      if (status() === 'error') return state;

      const lost = queue.length;
      queue = [];
      const ended = closed ? { ok: true as const, data: null } : await options.api.end(id);
      set({
        status: 'stopped',
        error: !ended.ok
          ? fail(errorKind(ended.status))
          : lost > 0
            ? { ...fail('service_unavailable'), message: `${lost} utterances could not be sent before stopping.` }
            : state.error,
      });
      return state;
    },

    state() {
      return state;
    },
  };
}
