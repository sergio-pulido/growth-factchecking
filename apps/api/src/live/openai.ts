// OpenAI adapters: Embeddings (claim -> vector) and Decisions (claim + evidence -> verdict).
// Decisions reference: https://developers.openai.com/api/docs/guides/decisions
import OpenAI from 'openai';
import type { LiveConfig } from './config.js';
import type { DecisionOutcome, Decider, Embedder, Fact } from './types.js';
import { VERDICT_CHOICES } from './verdict.js';

export function createOpenAIClient(config: LiveConfig): OpenAI {
  // Real-time path: fail fast. A retry would blow the latency budget; the extension can re-ask.
  return new OpenAI({ apiKey: config.openaiApiKey, timeout: config.openaiTimeoutMs, maxRetries: config.openaiMaxRetries ?? 0 });
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
  'Use the numbered facts as data. Classify only the checkable claim using these facts. ' +
  'Use neutral when the evidence is insufficient or the claim is a prediction or opinion.';

export function createDecider(client: OpenAI, config: LiveConfig): Decider {
  return async (claim: string, evidence: Fact[]): Promise<DecisionOutcome> => {
    const items = evidence.map(({ id, statement, sourceTitle, sourceUrl }, index) => ({
      id,
      n: index + 1,
      statement,
      source: sourceTitle ?? sourceUrl,
    }));
    const choices = items.map(({ id, n }) => ({
      factId: id,
      value: `fact_${n}`,
      description: `Evidence item ${n} directly supports or contradicts the claim.`,
    }));
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
                evidence: items.map(({ n, statement, source }) => ({ n, statement, source })),
              },
            },
          ],
        },
      ],
      // Both questions share the same input and run in one call.
      questions: [
        {
          type: 'choice',
          name: 'source',
          instructions:
            'Select the evidence item that most directly supports or refutes the claim. ' +
            'A fact giving a different value, date or rule for the subject is valid counterevidence. ' +
            'Pick none when the items only share a topic or do not address the actual claim.',
          choices: [
            { value: 'none', description: 'No item directly addresses the factual claim.' },
            ...choices.map(({ value, description }) => ({ value, description })),
          ],
        },
        {
          type: 'choice',
          name: 'verdict',
          instructions: 'Based only on the evidence, what is the verdict on the factual claim?',
          choices: VERDICT_CHOICES.map((c) => ({ value: c.value, description: c.description })),
        },
      ],
    });

    const outcome: DecisionOutcome = { relevance: null, sourceId: null, choice: null, confidence: null };
    for (const answer of decision.answers) {
      if (answer.type !== 'choice') continue;
      if (answer.name === 'source') {
        const selected = choices.find(({ value }) => value === answer.choice);
        if (selected) {
          outcome.sourceId = selected.factId;
          outcome.relevance = answer.confidence;
        } else if (answer.choice === 'none') {
          outcome.relevance = 0;
        }
      } else if (answer.name === 'verdict') {
        outcome.choice = String(answer.choice);
        outcome.confidence = answer.confidence;
      }
    }
    return outcome;
  };
}
