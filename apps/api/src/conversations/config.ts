// Conversation capture settings. Every value comes from the environment; see .env.example.
import type { ExtractorConfig } from './extractor.js';

const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'] as const;

export type ConversationConfig = {
  extraction: ExtractorConfig;
  /** Timeout for extraction and token calls. Longer than the fact-check timeout: extraction generates text. */
  extractionTimeoutMs: number;
  /** Earlier utterances sent to extraction to resolve references. */
  contextSize: number;
  checkConcurrency: number;
  transcriptionModel: string;
  /** Lifetime of a Realtime client secret handed to the extension. */
  transcriptionTokenTtlSeconds: number;
};

function int(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

function effort(): ExtractorConfig['reasoningEffort'] {
  // "low" measured ~1.1 s vs ~2 s for the model default, same claims (docs/evidence/2026-11-21-conversation-capture.md).
  const raw = process.env.CLAIM_EXTRACTION_EFFORT || 'low';
  const match = EFFORTS.find((e) => e === raw);
  if (!match) throw new Error(`CLAIM_EXTRACTION_EFFORT must be one of ${EFFORTS.join(', ')}, got "${raw}"`);
  return match;
}

export function loadConversationConfig(): ConversationConfig {
  const reasoningEffort = effort();
  return {
    extraction: {
      model: process.env.CLAIM_EXTRACTION_MODEL || 'gpt-6-luna',
      ...(reasoningEffort ? { reasoningEffort } : {}),
    },
    extractionTimeoutMs: int('CLAIM_EXTRACTION_TIMEOUT_MS', 10_000, 1, 120_000),
    contextSize: int('CLAIM_CONTEXT_UTTERANCES', 6, 0, 50),
    checkConcurrency: int('CLAIM_CHECK_CONCURRENCY', 4, 1, 16),
    transcriptionModel: process.env.TRANSCRIPTION_MODEL || 'gpt-live-transcribe',
    transcriptionTokenTtlSeconds: int('TRANSCRIPTION_TOKEN_TTL_SECONDS', 600, 10, 7200),
  };
}
