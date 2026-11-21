import type { FactCheckResult, MeetTurn, Verdict } from '@growth-factcheking/shared';

type PitchTopic = {
  pattern: RegExp;
  expectedVerdict: Verdict;
  sources: FactCheckResult['sources'];
};

const topics: readonly PitchTopic[] = [
  {
    pattern: /\bteníamos \d+ clientes de pago\b/i,
    expectedVerdict: 'yes',
    sources: [{
      statement: 'El registro ficticio de suscripciones del 31 de octubre de 2026 recoge 42 cuentas de pago activas.',
      sourceUrl: 'https://example.org/#suscripciones-octubre',
    }],
  },
  {
    pattern: /\bregistramos [\d.]+ euros de ingresos recurrentes mensuales\b/i,
    expectedVerdict: 'no',
    sources: [{
      statement: 'El cierre contable ficticio de octubre de 2026 registra 27.800 euros de ingresos recurrentes mensuales.',
      sourceUrl: 'https://example.org/#cierre-contable-octubre',
    }],
  },
  {
    pattern: /\bretención a \d+ días fue del \d+\s*%/i,
    expectedVerdict: 'probably_yes',
    sources: [{
      statement: 'El informe ficticio de julio y agosto de 2026 recoge un 94 % de retención a 90 días. El informe de septiembre está pendiente.',
      sourceUrl: 'https://example.org/#retencion-julio-agosto',
    }],
  },
  {
    pattern: /\bfirmamos un piloto con el Hospital Mirador\b/i,
    expectedVerdict: 'neutral',
    sources: [],
  },
];

const sentences = new Intl.Segmenter('es', { granularity: 'sentence' });

export type PitchClaim = { claim: string; expectedVerdict: Verdict; sources: FactCheckResult['sources'] };

export function extractPitchClaims(turn: MeetTurn): PitchClaim[] {
  if (turn.speaker !== 'founder') return [];

  const claims: PitchClaim[] = [];
  for (const { segment } of sentences.segment(turn.text)) {
    const topic = topics.find(({ pattern }) => pattern.test(segment));
    if (topic) {
      claims.push({
        claim: segment.trim(),
        expectedVerdict: topic.expectedVerdict,
        sources: topic.sources,
      });
    }
  }
  return claims;
}
