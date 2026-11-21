export const FACT_CHECK_PATH = '/api/fact-check';
export const CLAIM_MAX_LENGTH = 1000;

export const VERDICTS = ['yes', 'probably_yes', 'neutral', 'probably_no', 'no'] as const;
export const DEMO_SCENARIOS = [...VERDICTS, 'no_evidence', 'error'] as const;

export type FactCheckRequest = {
  claim: string;
};

export type Verdict = (typeof VERDICTS)[number];
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];

export type FactCheckResult = {
  verdict: Verdict;
  sources: Array<{
    statement: string;
    /** English rendering of `statement`, when the fact is not already in English. */
    statementEn?: string;
    sourceUrl: string;
  }>;
};

export * from './conversations.js';
