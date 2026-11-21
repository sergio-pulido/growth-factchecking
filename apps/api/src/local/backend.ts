import { createHash } from 'node:crypto';
import type { FactCheckResult } from '@growth-factcheking/shared';

export type FactInput = { id: string; statement: string; sourceUrl: string };
export type StoredFact = FactInput & { embedding: number[] };

// Deterministic bag-of-words vectors for wiring tests, not semantic embeddings.
export function embed(text: string): number[] {
  const vector = Array<number>(256).fill(0);
  const tokens = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const token of tokens) {
    const bucket = createHash('sha256').update(token).digest().readUInt16BE(0) % vector.length;
    vector[bucket] += 1;
  }
  const norm = Math.hypot(...vector);
  return norm ? vector.map((value) => value / norm) : vector;
}

const seedFacts: FactInput[] = [
  { id: 'library-hours', statement: 'La biblioteca de Puerto Aurora abre los sábados.', sourceUrl: 'https://example.com/biblioteca' },
  { id: 'museum-entry', statement: 'El museo de Puerto Aurora es gratuito los domingos.', sourceUrl: 'https://example.org/museo' },
];

export class MockFactsBackend {
  private readonly facts = new Map<string, StoredFact>();

  constructor(seed = true) {
    if (seed) this.ingest(seedFacts);
  }

  ingest(facts: FactInput[]) {
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    for (const fact of facts) {
      const previous = this.facts.get(fact.id);
      if (previous?.statement === fact.statement && previous.sourceUrl === fact.sourceUrl) {
        skipped++;
        continue;
      }
      this.facts.set(fact.id, { ...fact, embedding: previous?.statement === fact.statement ? previous.embedding : embed(fact.statement) });
      if (previous) updated++;
      else inserted++;
    }
    return { inserted, updated, skipped, total: this.facts.size, mode: 'mock' as const };
  }

  list(): FactInput[] {
    return [...this.facts.values()].map(({ id, statement, sourceUrl }) => ({ id, statement, sourceUrl }));
  }

  search(claim: string) {
    const query = embed(claim);
    return [...this.facts.values()]
      .map(({ embedding, ...fact }) => ({ ...fact, score: embedding.reduce((sum, value, index) => sum + value * query[index], 0) }))
      .filter(({ score }) => score >= 0.6)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, 5);
  }

  check(claim: string): FactCheckResult {
    const matches = this.search(claim);
    // Only an exact statement gets a mock "yes". Similarity cannot decide truth.
    const exact = matches.some(({ statement }) => statement.trim().toLowerCase() === claim.trim().toLowerCase());
    return {
      verdict: exact ? 'yes' : 'neutral',
      sources: matches.map(({ statement, sourceUrl }) => ({ statement, sourceUrl })),
    };
  }
}
