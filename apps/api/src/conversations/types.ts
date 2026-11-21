// Ports for conversation capture. Each one is injectable so the service is testable without network or database.
import type {
  ClaimCheck,
  ConversationCreateRequest,
  ConversationView,
  UtteranceInput,
} from '@growth-factcheking/shared';
import type { LiveFactCheck } from '../live/types.js';

/** An utterance as stored, with its database id. */
export type StoredUtterance = UtteranceInput & { id: string };

export type ConversationState = 'open' | 'ended' | 'missing';

/** A claim ready to be stored: the check outcome, or null when the check failed. */
export type ClaimRecord = {
  utteranceId: string;
  claim: string;
  check: LiveFactCheck | null;
};

export type ConversationStore = {
  create(input: ConversationCreateRequest): Promise<string>;
  state(id: string): Promise<ConversationState>;
  /** Inserts new utterances, skipping client ids already stored. Returns only the inserted ones. */
  addUtterances(conversationId: string, utterances: readonly UtteranceInput[]): Promise<StoredUtterance[]>;
  /** The latest utterances before the given ones, oldest first, for extraction context. */
  contextBefore(conversationId: string, excludeIds: readonly string[], limit: number): Promise<StoredUtterance[]>;
  saveClaims(conversationId: string, claims: readonly ClaimRecord[]): Promise<ClaimCheck[]>;
  end(id: string): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  view(id: string): Promise<ConversationView | null>;
};

/** A claim found in one of the new utterances, referenced by its stored id. */
export type ExtractedClaim = { utteranceId: string; claim: string };

export type ClaimExtractor = (
  utterances: readonly StoredUtterance[],
  context: readonly StoredUtterance[],
) => Promise<ExtractedClaim[]>;

export type ClaimChecker = (claim: string) => Promise<LiveFactCheck>;
