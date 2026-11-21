// Conversation capture contract (spec: docs/specs/conversation-capture.md).
import type { FactCheckResult } from './index.js';

export const CONVERSATIONS_PATH = '/api/conversations';
export const TRANSCRIPTION_TOKEN_PATH = '/api/transcription/token';

export const CAPTURE_METHODS = ['captions', 'page_text', 'audio'] as const;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

export const SPEAKER_KINDS = ['named', 'self', 'others', 'unknown'] as const;
export type SpeakerKind = (typeof SPEAKER_KINDS)[number];

export const PLATFORM_PATTERN = '^[a-z0-9_-]{1,32}$';
export const CLIENT_ID_PATTERN = '^[A-Za-z0-9_.:-]{1,128}$';
export const UTTERANCE_TEXT_MAX = 4000;
export const SPEAKER_MAX = 120;
export const UTTERANCE_BATCH_MAX = 50;

export type ConversationCreateRequest = {
  platform: string;
  capture: CaptureMethod;
  title?: string;
  pageUrl?: string;
  /** ISO-639-1 hint, e.g. "es". */
  language?: string;
};

export type ConversationCreateResult = { id: string };

export type UtteranceInput = {
  /** Stable per utterance; re-sending the same id is a no-op. */
  clientId: string;
  speaker: string;
  speakerKind: SpeakerKind;
  text: string;
  /** ISO 8601 timestamp of when the utterance was said or written. */
  spokenAt: string;
};

export type UtteranceBatchRequest = { utterances: UtteranceInput[] };

export type ClaimStatus = 'checked' | 'failed';

export type ClaimCheck = {
  id: string;
  claim: string;
  speaker: string;
  utteranceClientId: string;
  status: ClaimStatus;
  /** Null when status is "failed". */
  verdict: FactCheckResult['verdict'] | null;
  sources: FactCheckResult['sources'];
};

export type UtteranceBatchResult = {
  accepted: number;
  duplicates: number;
  extraction: 'ok' | 'skipped' | 'failed';
  claims: ClaimCheck[];
};

export type ConversationView = {
  id: string;
  platform: string;
  capture: CaptureMethod;
  title: string | null;
  startedAt: string;
  endedAt: string | null;
  utterances: UtteranceInput[];
  claims: ClaimCheck[];
};

export type TranscriptionTokenRequest = { language?: string };
export type TranscriptionTokenResult = { value: string; expiresAt: number; model: string };
