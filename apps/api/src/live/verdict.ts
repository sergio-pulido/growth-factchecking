import { VERDICTS } from '@growth-factcheking/shared';
import type { Verdict } from '@growth-factcheking/shared';
import type { DecisionOutcome } from './types.js';

/** Choice options sent to Decisions. Values are the shared verdict ids, so no translation table is needed. */
export const VERDICT_CHOICES: ReadonlyArray<{ value: Verdict; description: string }> = [
  { value: 'yes', description: 'The evidence explicitly confirms the claim.' },
  { value: 'probably_yes', description: 'The evidence mostly supports the claim, with minor gaps or imprecision.' },
  { value: 'neutral', description: 'The evidence is insufficient, unrelated, or mixed.' },
  { value: 'probably_no', description: 'The evidence mostly contradicts the claim or makes it unlikely.' },
  { value: 'no', description: 'The evidence explicitly contradicts the claim.' },
];

export type VerdictThresholds = { minRelevance: number; minConfidence: number };

export type MappedVerdict = {
  verdict: Verdict;
  reason: 'off_topic' | 'refused' | 'decided';
};

function isVerdict(value: unknown): value is Verdict {
  return typeof value === 'string' && (VERDICTS as readonly string[]).includes(value);
}

/**
 * Turns a raw Decisions outcome into a verdict. Conservative by design:
 * anything uncertain collapses towards neutral, never towards a confident yes/no.
 */
export function mapVerdict(outcome: DecisionOutcome, t: VerdictThresholds): MappedVerdict {
  if (outcome.relevance === null || outcome.choice === null || outcome.confidence === null) {
    return { verdict: 'neutral', reason: 'refused' };
  }
  if (outcome.relevance < t.minRelevance) {
    return { verdict: 'neutral', reason: 'off_topic' };
  }
  if (!isVerdict(outcome.choice)) {
    return { verdict: 'neutral', reason: 'refused' };
  }
  if (outcome.confidence < t.minConfidence) {
    if (outcome.choice === 'yes') return { verdict: 'probably_yes', reason: 'decided' };
    if (outcome.choice === 'no') return { verdict: 'probably_no', reason: 'decided' };
  }
  return { verdict: outcome.choice, reason: 'decided' };
}
