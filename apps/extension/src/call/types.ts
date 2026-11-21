import type {
  CaptureMethod, ClaimCheck, FactCheckResult, SpeakerKind, UtteranceBatchResult, UtteranceInput, Verdict,
} from '@growth-factcheking/shared';

export type StartInput = { platform: string; capture: CaptureMethod; title?: string; pageUrl?: string };

/** How the call panel talks to the local API (through the background worker). */
export interface CallTransport {
  start(input: StartInput): Promise<{ id: string }>;
  send(conversationId: string, utterances: UtteranceInput[]): Promise<UtteranceBatchResult>;
  end(conversationId: string): Promise<void>;
  remove(conversationId: string): Promise<void>;
  recheck(claim: string): Promise<FactCheckResult>;
  /** Number of claims that need attention, for the toolbar badge. */
  badge?(count: number): void;
}

/** Something said, final and ready to store. */
export type Segment = { speaker: string; text: string; kind?: SpeakerKind };

export type SourceSink = {
  segments(list: readonly Segment[]): void;
  /** `found`: captions (or audio) are reaching the source; `voice`: someone is speaking now. */
  activity(state: { found: boolean; voice: boolean }): void;
  /** The source stopped working on its own (e.g. the audio connection dropped). */
  failed(message: string): void;
};

/** Where the words come from: the call app's captions, or the tab's audio. */
export interface CaptureSource {
  readonly capture: CaptureMethod;
  readonly platform: string;
  /** "Google Meet", "esta pestaña"… */
  readonly label: string;
  /** Shown while the source finds nothing to read. */
  readonly hint: string;
  readonly anchorBottom: number;
  /** Spoken-language choice, for sources that transcribe audio. */
  readonly language?: LanguageChoice;
  start(sink: SourceSink): Promise<void>;
  /** Stops sending; returns the finished speech said before the pause. */
  pause(): Segment[];
  /** Resumes; speech said while paused is skipped. */
  resume(): void;
  /** Stops for good; returns what was still pending. */
  stop(): Segment[];
}

export type LanguageChoice = {
  options: ReadonlyArray<{ value: string; label: string }>;
  value(): string;
  set(value: string): void;
};

export type SessionState = 'idle' | 'starting' | 'live' | 'paused' | 'ending' | 'ended';

export type TranscriptLine = {
  clientId: string;
  speaker: string;
  text: string;
  /** Seconds since capture started. */
  at: number;
};

export type ClaimItem = {
  id: string;
  claim: string;
  speaker: string;
  at: number;
  state: 'checked' | 'failed' | 'retrying';
  verdict: Verdict | null;
  sources: ClaimCheck['sources'];
  /** Sources section expanded in the panel. */
  open: boolean;
};

export type SessionSnapshot = {
  state: SessionState;
  startedAt: number | null;
  claims: readonly ClaimItem[];
  transcript: readonly TranscriptLine[];
  /** Utterances sent and waiting for claim extraction. */
  analyzing: number;
  found: boolean;
  /** Someone is speaking right now. */
  voice: boolean;
  notice: string | null;
};

export const ATTENTION: ReadonlySet<Verdict> = new Set(['no', 'probably_no']);

export type TransportErrorCode = 'ended' | 'missing' | 'unavailable';

export class CallTransportError extends Error {
  constructor(message: string, readonly code: TransportErrorCode = 'unavailable') {
    super(message);
  }
}
