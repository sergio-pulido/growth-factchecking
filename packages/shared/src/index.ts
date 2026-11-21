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
    sourceUrl: string;
  }>;
};

export { MEET_TRANSCRIPT } from './meet-demo.js';
export type { MeetTurn } from './meet-demo.js';

export const MEET_DEMO_PATH = '/api/meet/demo/check';
export const MEET_JUDGES = ['mock', 'decisions'] as const;
export type MeetJudge = (typeof MEET_JUDGES)[number];

export type MeetCheckRequest = { turnId: string; mode: MeetJudge };

export type MeetCheckResult = {
  checks: Array<FactCheckResult & { claim: string }>;
};
