export const FACT_CHECK_PATH = '/api/fact-check';
export const CLAIM_MAX_LENGTH = 1000;

export type FactCheckRequest = {
  claim: string;
};

export type Verdict =
  | 'yes'
  | 'probably_yes'
  | 'neutral'
  | 'probably_no'
  | 'no';

export type FactCheckResult = {
  verdict: Verdict;
  sources: Array<{
    statement: string;
    sourceUrl: string;
  }>;
};
