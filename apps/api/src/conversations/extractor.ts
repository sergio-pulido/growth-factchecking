// Claim extraction with the OpenAI Responses API and a strict JSON schema.
import { CLAIM_MAX_LENGTH } from '@growth-factcheking/shared';
import type OpenAI from 'openai';
import type { ClaimExtractor, ExtractedClaim, StoredUtterance } from './types.js';

export const MAX_CLAIMS_PER_BATCH = 20;

const INSTRUCTIONS = [
  'You extract checkable factual claims from a conversation transcript for a fact-checker.',
  'Only extract from the items in "new". Items in "context" are earlier lines, given only to resolve references.',
  'A checkable claim is a statement about the world that public or company records could confirm or refute:',
  'numbers, quantities, dates, places, events, rankings, attributions, rules.',
  'Skip questions, opinions, feelings, predictions, plans, promises, hypotheticals, jokes and small talk.',
  'Rewrite each claim as one standalone sentence: resolve pronouns and references from the transcript,',
  'keep the speaker\'s language and wording, and never add information that was not said.',
  'When a speaker relays a claim from a source ("the slide says X", "I read that X"), extract X itself.',
  'Reference the item it comes from with its "ref". Return an empty list when there is nothing checkable.',
].join(' ');

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['claims'],
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ref', 'claim'],
        properties: {
          ref: { type: 'string', description: 'The "ref" of the new item the claim comes from, e.g. "u2".' },
          claim: { type: 'string', description: 'The standalone claim.' },
        },
      },
    },
  },
} as const;

type Line = { ref?: string; speaker: string; text: string };

const toLine = (u: StoredUtterance, ref?: string): Line => ({ ...(ref ? { ref } : {}), speaker: u.speaker, text: u.text });

/** Maps the model output back to stored utterance ids, dropping anything malformed or unknown. */
export function parseExtraction(raw: string, refs: ReadonlyMap<string, string>): ExtractedClaim[] {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || !('claims' in parsed) || !Array.isArray(parsed.claims)) {
    throw new Error('Claim extraction returned an unexpected shape.');
  }
  const seen = new Set<string>();
  const claims: ExtractedClaim[] = [];
  for (const item of parsed.claims as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { ref, claim } = item as { ref?: unknown; claim?: unknown };
    if (typeof ref !== 'string' || typeof claim !== 'string') continue;
    const utteranceId = refs.get(ref);
    const text = claim.trim().replace(/\s+/g, ' ');
    if (!utteranceId || !text || text.length > CLAIM_MAX_LENGTH) continue;
    const key = `${utteranceId}\u0000${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push({ utteranceId, claim: text });
    if (claims.length === MAX_CLAIMS_PER_BATCH) break;
  }
  return claims;
}

export type ExtractorConfig = { model: string; reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' };

export function createClaimExtractor(client: OpenAI, config: ExtractorConfig): ClaimExtractor {
  return async (utterances, context) => {
    const refs = new Map(utterances.map((u, i) => [`u${i + 1}`, u.id] as const));
    const transcript = {
      context: context.map((u) => toLine(u)),
      new: utterances.map((u, i) => toLine(u, `u${i + 1}`)),
    };
    const response = await client.responses.create({
      model: config.model,
      instructions: INSTRUCTIONS,
      input: JSON.stringify(transcript),
      text: { format: { type: 'json_schema', name: 'claims', schema: SCHEMA, strict: true } },
      ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort } } : {}),
      // Transcripts are personal data: do not keep them on the provider side.
      store: false,
    });
    return parseExtraction(response.output_text, refs);
  };
}
