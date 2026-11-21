// Capture controller for one tab: the single object UI code needs (start, stop, state, subscribe).
// Reading only happens between an explicit start() and stop().
import type { ConversationCreateRequest } from '@growth-factcheking/shared';
import { createCaptionConsolidator, DEFAULT_CONSOLIDATOR_OPTIONS } from './caption-consolidator.js';
import type { CaptionRow, ConsolidatorOptions } from './caption-consolidator.js';
import { createCaptureSession, INITIAL_CAPTURE_STATE } from './capture-session.js';
import type { CaptureState, ConversationApi, Scheduler, SessionOptions } from './capture-session.js';

export type CaptionReader = {
  /** Rows visible now, oldest first, or null when no caption area is on screen. */
  read(): CaptionRow[] | null;
};

export type MeetCaptureState = CaptureState & {
  /** True while capturing: the UI must show a visible "Transcribing" indicator. */
  active: boolean;
  /** Whether the last read found Meet's caption area. False usually means captions (CC) are off. */
  captionsDetected: boolean;
  /** Captions seen but not final yet. */
  openTurns: number;
};

export type MeetCaptureController = {
  start(): Promise<MeetCaptureState>;
  stop(): Promise<MeetCaptureState>;
  getState(): MeetCaptureState;
  subscribe(listener: (state: MeetCaptureState) => void): () => void;
};

export type ControllerOptions = {
  reader: CaptionReader;
  api: ConversationApi;
  scheduler: Scheduler;
  now?: () => number;
  pollMs?: number;
  newIdPrefix: () => string;
  meta: () => Omit<ConversationCreateRequest, 'platform' | 'capture'>;
  consolidator?: Partial<Omit<ConsolidatorOptions, 'idPrefix'>>;
  session?: Pick<SessionOptions, 'flushIntervalMs' | 'maxBatch' | 'retryBaseMs' | 'retryMaxMs' | 'stopAttempts'>;
};

export function createMeetCaptureController(options: ControllerOptions): MeetCaptureController {
  const now = options.now ?? Date.now;
  const pollMs = options.pollMs ?? 300;
  const listeners = new Set<(state: MeetCaptureState) => void>();

  let captionsDetected = false;
  let pollTimer: unknown = null;
  let reading = false;
  let consolidator = createCaptionConsolidator({ ...DEFAULT_CONSOLIDATOR_OPTIONS, idPrefix: 'unused' });
  let sessionState: CaptureState = INITIAL_CAPTURE_STATE;

  const snapshot = (): MeetCaptureState => ({
    ...sessionState,
    active: sessionState.status === 'starting' || sessionState.status === 'capturing' || sessionState.status === 'stopping',
    captionsDetected,
    openTurns: consolidator.openTurns(),
  });
  const emit = (): void => {
    const state = snapshot();
    for (const listener of listeners) listener(state);
  };

  const session = createCaptureSession({
    ...options.session,
    api: options.api,
    scheduler: options.scheduler,
    now,
    onState: (state) => {
      sessionState = state;
      if (state.status === 'error' && reading) stopReading();
      emit();
    },
  });

  const stopReading = (): void => {
    reading = false;
    if (pollTimer !== null) options.scheduler.clearTimeout(pollTimer);
    pollTimer = null;
  };

  const poll = (): void => {
    pollTimer = null;
    if (!reading) return;
    const rows = options.reader.read();
    const changed = captionsDetected !== (rows !== null);
    captionsDetected = rows !== null;
    const final = consolidator.observe(rows ?? [], now());
    if (final.length > 0) session.enqueue(final);
    else if (changed) emit();
    pollTimer = options.scheduler.setTimeout(poll, pollMs);
  };

  return {
    async start() {
      const status = session.state().status;
      if (status === 'starting' || status === 'capturing' || status === 'stopping') return snapshot();
      consolidator = createCaptionConsolidator({
        ...DEFAULT_CONSOLIDATOR_OPTIONS,
        ...options.consolidator,
        idPrefix: options.newIdPrefix(),
      });
      captionsDetected = false;
      await session.start(options.meta());
      if (session.state().status === 'capturing') {
        reading = true;
        poll();
      }
      return snapshot();
    },

    async stop() {
      // Stop reading first: nothing on screen is captured after this point.
      stopReading();
      await session.stop(consolidator.flush());
      emit();
      return snapshot();
    },

    getState: snapshot,

    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
  };
}
