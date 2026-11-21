import type { FactCheckResult, Verdict } from '@growth-factcheking/shared';

/** A fact from the corpus, as returned by vector search. */
export type Fact = {
  id: string;
  statement: string;
  sourceUrl: string;
  sourceTitle: string | null;
  /** Cosine similarity to the claim, 0..1. */
  similarity: number;
};

/** Raw, typed outcome of one Decisions call. Mapping to a verdict lives in verdict.ts. */
export type DecisionOutcome = {
  /** Confidence in the selected source, zero for no direct evidence, null if refused. */
  relevance: number | null;
  sourceId: string | null;
  /** Value chosen by the model. null if refused. */
  choice: string | null;
  /** Choice confidence. null if refused. */
  confidence: number | null;
};

/** Ports: each step is injectable so the pipeline is testable without network or database. */
export type Embedder = (text: string) => Promise<number[]>;
export type FactSearch = (embedding: number[], limit: number) => Promise<Fact[]>;
export type Decider = (claim: string, evidence: Fact[]) => Promise<DecisionOutcome>;

export type Timings = { embedMs: number; searchMs: number; decideMs: number; totalMs: number };

export type LiveFactCheck = {
  result: FactCheckResult;
  meta: {
    verdict: Verdict;
    reason: 'no_evidence' | 'off_topic' | 'refused' | 'decided';
    relevance: number | null;
    confidence: number | null;
    evidenceCount: number;
    cached: boolean;
    timings: Timings;
  };
};
