import type { DemoScenario, FactCheckResult } from '@growth-factcheking/shared';

const townSchedule = {
  statement: 'Horario municipal ficticio de Puerto Aurora: la biblioteca abre los sábados de 10:00 a 14:00.',
  sourceUrl: 'https://example.com/',
};

const weekendNotice = {
  statement: 'Aviso ficticio de la biblioteca: se atiende de lunes a viernes y las instalaciones cierran el sábado.',
  sourceUrl: 'https://example.org/',
};

export const mockResults: Record<Exclude<DemoScenario, 'error'>, FactCheckResult> = {
  yes: {
    verdict: 'yes',
    sources: [
      townSchedule,
      {
        statement: 'Agenda ficticia: el club de lectura se reúne en la biblioteca los sábados a las 11:00.',
        sourceUrl: 'https://example.org/',
      },
    ],
  },
  probably_yes: {
    verdict: 'probably_yes',
    sources: [{
      statement: 'Anuncio ficticio: el ayuntamiento prevé abrir la biblioteca los sábados durante el trimestre.',
      sourceUrl: 'https://example.com/',
    }],
  },
  neutral: { verdict: 'neutral', sources: [townSchedule, weekendNotice] },
  probably_no: {
    verdict: 'probably_no',
    sources: [{
      statement: 'Boletín ficticio: la biblioteca podría suspender la atención de los sábados por obras.',
      sourceUrl: 'https://example.org/',
    }],
  },
  no: { verdict: 'no', sources: [weekendNotice] },
  no_evidence: { verdict: 'neutral', sources: [] },
};
