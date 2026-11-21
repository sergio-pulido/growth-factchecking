import type { Verdict } from '@growth-factcheking/shared';

export const verdictLabels: Record<Verdict, string> = {
  yes: 'True',
  probably_yes: 'Likely true',
  neutral: 'Neutral',
  probably_no: 'Likely false',
  no: 'False',
};
