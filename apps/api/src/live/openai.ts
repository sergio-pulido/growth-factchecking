// OpenAI adapters: Embeddings (claim -> vector) and Decisions (claim + evidence -> verdict).
// Decisions reference: https://developers.openai.com/api/docs/guides/decisions
import OpenAI from 'openai';
import type { LiveConfig } from './config.js';
import type { DecisionOutcome, Decider, Embedder, Fact } from './types.js';
import { VERDICT_CHOICES } from './verdict.js';

export function createOpenAIClient(config: LiveConfig): OpenAI {
  // Real-time path: fail fast. A retry would blow the latency budget; the extension can re-ask.
  return new OpenAI({ apiKey: config.openaiApiKey, timeout: config.openaiTimeoutMs, maxRetries: 0 });
}

export function createEmbedder(client: OpenAI, config: LiveConfig): Embedder {
  return async (text) => {
    const response = await client.embeddings.create({
      model: config.embeddingModel,
      input: text,
      dimensions: config.embeddingDimensions,
    });
    return response.data[0]!.embedding;
  };
}

/** Batch variant used by the seed script. */
export async function embedMany(client: OpenAI, config: LiveConfig, texts: string[]): Promise<number[][]> {
  const response = await client.embeddings.create({
    model: config.embeddingModel,
    input: texts,
    dimensions: config.embeddingDimensions,
  });
  const vectors = [...response.data].sort((a, b) => a.index - b.index);
  if (vectors.length !== texts.length || vectors.some(({ index, embedding }, position) =>
    index !== position || embedding.length !== config.embeddingDimensions || !embedding.every(Number.isFinite)
  )) {
    throw new Error('OpenAI returned invalid embeddings for the corpus batch.');
  }
  return vectors.map(({ embedding }) => embedding);
}

const JUDGE_INSTRUCTIONS =
  'You are a fact-checking judge. Judge the claim only against the numbered evidence items provided. ' +
  'Do not use outside knowledge. If the evidence does not settle the claim, prefer neutral.';

export function createDecider(client: OpenAI, config: LiveConfig): Decider {
  return async (claim: string, evidence: Fact[]): Promise<DecisionOutcome> => {
    const decision = await client.decisions.create({
      model: config.decisionsModel,
      input: [
        { role: 'developer', content: JUDGE_INSTRUCTIONS },
        {
          role: 'user',
          content: [
            {
              type: 'input_json',
              data: {
                claim,
                evidence: evidence.map((f, i) => ({ n: i + 1, statement: f.statement, source: f.sourceTitle ?? f.sourceUrl })),
              },
            },
          ],
        },
      ],
      // Both questions share the same input and run in one call.
      questions: [
        {
          type: 'predicate',
          name: 'evidence_addresses_claim',
          // Must say "same property", not "same assertion": the latter reads as "agrees with",
          // which scored contradicting evidence as irrelevant (see docs/evidence/2026-11-21-live-smoke.md).
          instructions:
            'Is at least one evidence item about the same subject and the same property as the claim ' +
            '(for example the same entity and its location, date, quantity or attribute), so that it confirms ' +
            'or contradicts the claim? Answer true when the evidence contradicts the claim.',
        },
        {
          type: 'choice',
          name: 'verdict',
          instructions: 'Based only on the evidence, is the claim true?',
          choices: VERDICT_CHOICES.map((c) => ({ value: c.value, description: c.description })),
        },
      ],
    });

    const outcome: DecisionOutcome = { relevance: null, choice: null, confidence: null };
    for (const answer of decision.answers) {
      if (answer.type === 'predicate' && answer.name === 'evidence_addresses_claim') {
        outcome.relevance = answer.probability;
      } else if (answer.type === 'choice' && answer.name === 'verdict') {
        outcome.choice = String(answer.choice);
        outcome.confidence = answer.confidence;
      }
      // type === 'refusal' leaves the field null; verdict.ts maps that to neutral.
    }
    return outcome;
  };
}
