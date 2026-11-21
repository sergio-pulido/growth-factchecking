// Offline simulation of The Wild Project interview (Jordi Wild with Pedro Sánchez).
// Runs entirely in the extension: no API, no network. Claims are paraphrased from press
// coverage of the interview (El Diario de Madrid and Infobae, 13 Nov 2026); timestamps are
// approximate and verdicts are sample results for the demo, not real fact-checks.
import type { Verdict } from '@growth-factcheking/shared';

type Source = { statement: string; sourceUrl: string };
type Check = { claim: string; verdict: Verdict | 'opinion'; note: string; sources: Source[] };
type Turn = { at: string; speaker: 'host' | 'guest'; text: string; checks?: Check[] };

const speakers: Record<Turn['speaker'], string> = {
  host: 'Jordi Wild · Host',
  guest: 'Pedro Sánchez · Guest',
};

export const interviewLabels: Record<Check['verdict'], string> = {
  yes: 'True',
  probably_yes: 'Likely true',
  neutral: 'Neutral',
  probably_no: 'Likely false',
  no: 'False',
  opinion: 'Opinion',
};

const elDiario = 'https://www.eldiariodemadrid.es/politica/pedro-sanchez-jordi-wild-entrevista-trenes-corrupcion-vivienda/20261113141905146845.html';
const infobae = 'https://www.infobae.com/espana/2026/11/13/entrevista-de-jordi-wild-pedro-sanchez-defiende-su-gestion-en-ceuta-y-mantiene-que-no-puede-responsabilizar-a-marruecos-nos-enfrentamos-a-un-dilema-nos-liamos-a-tiros/';

const TRANSCRIPT: Turn[] = [
  { at: '12:31', speaker: 'host', text: 'Let\'s start with Ceuta. What exactly happened at the end of July?' },
  {
    at: '12:40', speaker: 'guest',
    text: 'More than 80,000 people arrived on 30 and 31 July. We have been the government that has invested the most resources in Ceuta and Melilla.',
    checks: [
      {
        claim: 'More than 80,000 people arrived in Ceuta on 30 and 31 July.',
        verdict: 'neutral',
        note: 'Official count not yet published; the interviewer questioned how it was measured.',
        sources: [
          { statement: 'Ministry of the Interior: irregular arrivals reports', sourceUrl: 'https://www.interior.gob.es' },
          { statement: 'El Diario de Madrid: Jordi Wild questions the 80,000 count', sourceUrl: elDiario },
        ],
      },
      {
        claim: 'Our government has invested the most resources in Ceuta and Melilla.',
        verdict: 'neutral',
        note: 'Needs budget data by year to compare governments.',
        sources: [
          { statement: 'Ministry of Finance: General State Budget by territory', sourceUrl: 'https://www.sepg.pap.hacienda.gob.es' },
        ],
      },
    ],
  },
  { at: '40:58', speaker: 'host', text: 'People worry about immigration. What does it really bring to the economy?' },
  {
    at: '41:05', speaker: 'guest',
    text: 'Immigration accounts for 25% of our economic growth.',
    checks: [{
      claim: 'Immigration accounts for 25% of Spain\'s economic growth.',
      verdict: 'probably_yes',
      note: 'In line with Bank of Spain estimates, but the share depends on the period measured.',
      sources: [
        { statement: 'Bank of Spain: annual report on growth and the labour market', sourceUrl: 'https://www.bde.es' },
        { statement: 'INE: Labour Force Survey (EPA) by nationality', sourceUrl: 'https://www.ine.es' },
      ],
    }],
  },
  { at: '56:12', speaker: 'host', text: 'You promised 184,000 public homes. How many are actually delivered?' },
  {
    at: '56:30', speaker: 'guest',
    text: 'We will deliver 184,000 public and affordable rental homes.',
    checks: [{
      claim: 'We will deliver 184,000 public and affordable rental homes.',
      verdict: 'probably_no',
      note: 'No figure for homes delivered and occupied was given; delivered and in-progress homes were mixed.',
      sources: [
        { statement: 'El Diario de Madrid: no delivered figure given in the interview', sourceUrl: elDiario },
        { statement: 'Ministry of Housing: public housing programme', sourceUrl: 'https://www.mivau.gob.es' },
      ],
    }],
  },
  { at: '1:11:50', speaker: 'host', text: 'And Zapatero, with the Plus Ultra investigation?' },
  {
    at: '1:12:08', speaker: 'guest',
    text: 'I put my hand in the fire for José Luis. I believe in his innocence.',
    checks: [{
      claim: 'I put my hand in the fire for José Luis. I believe in his innocence.',
      verdict: 'opinion',
      note: 'A personal opinion, not a checkable fact.',
      sources: [{ statement: 'Infobae: interview coverage', sourceUrl: infobae }],
    }],
  },
];

function text<Tag extends keyof HTMLElementTagNameMap>(tag: Tag, content: string) {
  const node = document.createElement(tag);
  node.textContent = content;
  return node;
}

function renderTurn(turn: Turn) {
  const row = document.createElement('li');
  row.className = 'meet-turn';
  row.dataset.speaker = turn.speaker === 'guest' ? 'founder' : 'investor';
  const caption = document.createElement('div');
  caption.className = 'meet-turn-meta';
  caption.append(text('strong', speakers[turn.speaker]), text('span', turn.at));
  row.append(caption, text('p', turn.text));
  return row;
}

function renderCheck(check: Check) {
  const item = document.createElement('li');
  item.className = 'meet-check';
  item.dataset.verdict = check.verdict;
  const pill = text('span', interviewLabels[check.verdict]);
  pill.className = 'verdict-pill';
  pill.dataset.verdict = check.verdict;
  const note = text('p', check.note);
  note.className = 'check-note';
  item.append(pill, text('p', check.claim), note);
  if (check.sources.length) {
    const heading = text('p', 'Sources');
    heading.className = 'check-sources-title';
    const list = document.createElement('ol');
    list.className = 'check-sources';
    for (const { statement, sourceUrl } of check.sources) {
      const source = document.createElement('li');
      const link = text('a', statement);
      link.href = sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      source.append(link);
      list.append(source);
    }
    item.append(heading, list);
  }
  return item;
}

export function createInterviewDemo(onBusy: (busy: boolean) => void = () => {}) {
  const view = document.createElement('div');
  view.className = 'meet-demo';
  const caption = text('p', 'The Wild Project · Pedro Sánchez interview. Offline simulation, sample verdicts.');
  caption.className = 'demo-label';
  const controls = document.createElement('form');
  const play = text('button', 'Play interview');
  play.type = 'submit';
  controls.append(play);

  const status = text('p', '');
  status.setAttribute('role', 'status');
  const transcript = document.createElement('ol');
  transcript.className = 'meet-transcript';
  transcript.setAttribute('role', 'list');
  view.append(caption, controls, status, transcript);

  let active: AbortController | undefined;
  const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });

  controls.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (active) return;
    active = new AbortController();
    const { signal } = active;
    play.disabled = true;
    transcript.replaceChildren();
    onBusy(true);

    let checked = 0;
    try {
      for (const turn of TRANSCRIPT) {
        if (signal.aborted) return;
        const row = renderTurn(turn);
        transcript.append(row);
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        status.textContent = 'Listening…';
        if (turn.checks) {
          status.textContent = 'Checking claims against trusted sources…';
          await wait(1100, signal);
          if (signal.aborted) return;
          const checks = document.createElement('ul');
          checks.className = 'meet-checks';
          checks.setAttribute('role', 'list');
          checks.append(...turn.checks.map(renderCheck));
          row.append(checks);
          checks.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          checked += turn.checks.length;
        }
        await wait(900, signal);
      }
      if (!signal.aborted) status.textContent = `${checked} claims checked · sample verdicts`;
    } finally {
      active = undefined;
      onBusy(false);
      play.disabled = false;
      if (!signal.aborted) play.textContent = 'Play again';
    }
  });

  return { view, stop: () => active?.abort() };
}
