import type { Verdict } from '@growth-factcheking/shared';

export const verdictLabels: Record<Verdict, string> = {
  yes: 'Sí',
  probably_yes: 'Probablemente sí',
  neutral: 'Neutral',
  probably_no: 'Probablemente no',
  no: 'No',
};
