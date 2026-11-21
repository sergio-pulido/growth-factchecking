// Offline simulation of The Wild Project interview (Jordi Wild with Pedro Sánchez).
// Runs entirely in the extension: no API, no network. Claims are paraphrased from press
// coverage of the interview (El Diario de Madrid and Infobae, 13 Nov 2026); timestamps are
// approximate and verdicts are sample results for the demo, not real fact-checks.
import type { Verdict } from '@growth-factcheking/shared';

type Source = { statement: string; sourceUrl: string };
type Check = {
  claim: string;
  short: string;
  verdict: Verdict;
  note: string;
  ask?: string;
  failFirst?: boolean;
  match: RegExp;
  sources: Source[];
};
type Skip = { text: string; reason: string };
type Turn = { at: string; speaker: 'host' | 'guest'; text: string; checks?: Check[]; skip?: Skip[] };

const speakers: Record<Turn['speaker'], string> = {
  host: 'Jordi Wild · Host',
  guest: 'Pedro Sánchez · Guest',
};

export const interviewLabels: Record<Verdict, string> = {
  yes: 'True',
  probably_yes: 'Likely true',
  neutral: 'Neutral',
  probably_no: 'Likely false',
  no: 'False',
};

const elDiario = 'https://www.eldiariodemadrid.es/politica/pedro-sanchez-jordi-wild-entrevista-trenes-corrupcion-vivienda/20261113141905146845.html';
const infobae = 'https://www.infobae.com/espana/2026/11/13/entrevista-de-jordi-wild-pedro-sanchez-defiende-su-gestion-en-ceuta-y-mantiene-que-no-puede-responsabilizar-a-marruecos-nos-enfrentamos-a-un-dilema-nos-liamos-a-tiros/';

const TRANSCRIPT: Turn[] = [
  { at: '12:31', speaker: 'host', text: 'Let\'s start with Ceuta. What exactly happened at the end of July?', skip: [{ text: 'What exactly happened at the end of July?', reason: 'Question from the host' }] },
  {
    at: '12:40', speaker: 'guest',
    text: 'More than 80,000 people arrived on 30 and 31 July. We have been the government that has invested the most resources in Ceuta and Melilla. It was a very difficult moment.',
    skip: [{ text: 'It was a very difficult moment.', reason: 'Opinion' }],
    checks: [
      {
        claim: 'More than 80,000 people arrived in Ceuta on 30 and 31 July.',
        short: '80,000 arrivals in Ceuta',
        match: /80[.,]?000|ceuta/i,
        ask: 'Where does the 80,000 figure come from, and who counted it?',
        verdict: 'neutral',
        note: 'Official count not yet published; the interviewer questioned how it was measured.',
        sources: [
          { statement: 'Ministry of the Interior: irregular arrivals reports', sourceUrl: 'https://www.interior.gob.es' },
          { statement: 'El Diario de Madrid: Jordi Wild questions the 80,000 count', sourceUrl: elDiario },
          { statement: 'Infobae: Sánchez defends his handling of Ceuta', sourceUrl: infobae },
        ],
      },
      {
        claim: 'Our government has invested the most resources in Ceuta and Melilla.',
        short: 'Most investment in Ceuta and Melilla',
        match: /invest|melilla/i,
        failFirst: true,
        ask: 'Compared with which governments, and in which budget years?',
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
      short: 'Immigration is 25% of growth',
      match: /25 ?%|immigra|inmigra/i,
      ask: 'Over which period is that 25% measured?',
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
      short: '184,000 public homes',
      match: /184[.,]?000|homes|vivienda/i,
      ask: 'How many of those homes are delivered and occupied today?',
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
    skip: [
      { text: 'I put my hand in the fire for José Luis.', reason: 'Opinion' },
      { text: 'I believe in his innocence.', reason: 'Personal belief' },
    ],
  },
];


const ORDER: Verdict[] = ['yes', 'probably_yes', 'neutral', 'probably_no', 'no'];
const STEP: Record<Verdict, number> = { no: 1, probably_no: 2, neutral: 3, probably_yes: 4, yes: 5 };
const FLASH: Record<Verdict, string> = {
  yes: '#2fd27a', probably_yes: '#2fd27a', neutral: '#f7b63c', probably_no: '#ff5247', no: '#ff5247',
};
const needsAttention = (verdict: Verdict) => verdict === 'no' || verdict === 'probably_no';
const ALL_CHECKS = TRANSCRIPT.flatMap((turn) => turn.checks ?? []);

type Filter = 'all' | 'attention' | 'skipped';
type Item =
  | { kind: 'claim'; check: Check; who: string; at: string; state: 'pending' | 'done' | 'error'; card: HTMLElement; retried?: boolean }
  | { kind: 'skipped'; skip: Skip; who: string; at: string; card: HTMLElement };

function text<Tag extends keyof HTMLElementTagNameMap>(tag: Tag, content: string, className?: string) {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}

function sourceList(sources: Source[]) {
  const wrap = document.createElement('div');
  wrap.append(text('p', `Sources (${sources.length})`, 'check-sources-title'));
  const list = document.createElement('ol');
  list.className = 'check-sources';
  for (const { statement, sourceUrl } of sources) {
    const row = document.createElement('li');
    const link = text('a', statement);
    link.href = sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const domain = text('span', ` · ${new URL(sourceUrl).hostname.replace(/^www\./, '')}`, 'source-domain');
    row.append(link, domain);
    list.append(row);
  }
  wrap.append(list);
  return wrap;
}

function scale(verdict: Verdict) {
  const bar = document.createElement('span');
  bar.className = 'verdict-scale';
  bar.setAttribute('aria-hidden', 'true');
  for (let step = 1; step <= 5; step += 1) {
    const dot = document.createElement('span');
    if (step === STEP[verdict]) dot.dataset.verdict = verdict;
    bar.append(dot);
  }
  return bar;
}

function meta(who: string, at: string, extra?: string) {
  const row = document.createElement('div');
  row.className = 'meet-turn-meta';
  row.append(text('strong', who), text('span', extra ? `${at} · ${extra}` : at));
  return row;
}

function fillClaimCard(card: HTMLElement, item: Extract<Item, { kind: 'claim' }>, onRetry: () => void) {
  const { check } = item;
  card.className = 'meet-check';
  card.dataset.state = item.state;
  card.replaceChildren(meta(item.who, item.at), text('p', `“${check.claim}”`, 'check-quote'));
  if (item.state === 'pending') {
    card.append(text('p', 'Checking against sources…', 'check-note'), text('div', '', 'shimmer'));
    return;
  }
  if (item.state === 'error') {
    const pill = text('span', 'Not checked', 'verdict-pill');
    const note = text('p', 'Could not reach the sources. The interview keeps going and you can retry.', 'check-note');
    const retry = text('button', 'Retry', 'link-button');
    retry.type = 'button';
    retry.addEventListener('click', onRetry);
    card.append(pill, note, retry);
    return;
  }
  card.dataset.verdict = check.verdict;
  const row = document.createElement('div');
  row.className = 'verdict-row';
  const pill = text('span', interviewLabels[check.verdict], 'verdict-pill');
  pill.dataset.verdict = check.verdict;
  row.append(pill, scale(check.verdict));
  card.append(row, text('p', check.note, 'check-note'));
  if (check.ask) {
    const ask = document.createElement('div');
    ask.className = 'check-ask';
    const copy = text('button', 'Copy', 'link-button');
    copy.type = 'button';
    copy.addEventListener('click', () => {
      navigator.clipboard?.writeText(check.ask ?? '').then(
        () => { copy.textContent = 'Copied'; },
        () => { copy.textContent = 'Copy not available'; },
      );
    });
    const body = document.createElement('p');
    body.append(text('small', 'Suggested question'), document.createTextNode(check.ask));
    ask.append(body, copy);
    card.append(ask);
  }
  if (check.sources.length) card.append(sourceList(check.sources));
}

function flashScreen(verdict: Verdict) {
  const edge = document.createElement('div');
  edge.setAttribute('aria-hidden', 'true');
  Object.assign(edge.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483646',
    boxShadow: `inset 0 0 0 3px ${FLASH[verdict]}, inset 0 0 120px 10px ${FLASH[verdict]}88`, opacity: '0',
  });
  document.documentElement.append(edge);
  const peak = verdict === 'yes' || verdict === 'no' ? 1 : 0.7;
  edge.animate([{ opacity: 0 }, { opacity: peak, offset: 0.25 }, { opacity: peak, offset: 0.42 }, { opacity: 0 }], {
    duration: 1300, easing: 'ease-out',
  }).finished.finally(() => edge.remove());
}

export type InterviewDemoOptions = {
  isMinimised?: () => boolean;
  expand?: () => void;
};

export function createInterviewDemo(onBusy: (busy: boolean) => void = () => {}, options: InterviewDemoOptions = {}) {
  const view = document.createElement('div');
  view.className = 'meet-demo';
  const label = text('p', 'The Wild Project · Pedro Sánchez interview. Offline simulation, sample verdicts.', 'demo-label');
  const controls = document.createElement('form');
  const play = text('button', 'Play interview');
  play.type = 'submit';
  controls.append(play);

  const status = text('p', '');
  status.setAttribute('role', 'status');
  const caption = document.createElement('div');
  caption.className = 'live-caption';
  caption.hidden = true;

  const summary = document.createElement('div');
  summary.className = 'check-summary';
  const summaryText = text('p', '0 checked');
  const summaryAttention = text('p', '', 'summary-attention');
  const distribution = document.createElement('div');
  distribution.className = 'distribution';
  summary.append(summaryText, summaryAttention, distribution);

  const tabs = document.createElement('div');
  tabs.className = 'feed-tabs';
  tabs.setAttribute('role', 'tablist');
  const counts: Record<Filter, HTMLElement> = { all: text('span', '0'), attention: text('span', '0'), skipped: text('span', '0') };
  const tabLabels: Record<Filter, string> = { all: 'All', attention: 'Needs attention', skipped: 'Skipped' };
  let filter: Filter = 'all';
  for (const key of Object.keys(tabLabels) as Filter[]) {
    const tab = text('button', `${tabLabels[key]} `);
    tab.type = 'button';
    tab.dataset.filter = key;
    tab.setAttribute('aria-pressed', String(key === filter));
    tab.append(counts[key]);
    tab.addEventListener('click', () => {
      filter = key;
      for (const other of Array.from(tabs.querySelectorAll('button'))) other.setAttribute('aria-pressed', String(other === tab));
      render();
    });
    tabs.append(tab);
  }

  const feed = document.createElement('ul');
  feed.className = 'meet-checks';
  feed.setAttribute('role', 'list');
  const empty = text('p', '', 'feed-empty');
  view.append(label, controls, status, caption, summary, tabs, feed, empty);

  // Toasts shown on top of the minimised panel when a verdict arrives.
  const toasts = document.createElement('div');
  toasts.className = 'toast-stack';
  toasts.setAttribute('aria-live', 'polite');

  const items: Item[] = [];

  function render() {
    const claims = items.filter((item): item is Extract<Item, { kind: 'claim' }> => item.kind === 'claim');
    const done = claims.filter((item) => item.state === 'done');
    const pending = claims.filter((item) => item.state === 'pending').length;
    const attention = done.filter((item) => needsAttention(item.check.verdict));
    const skipped = items.filter((item) => item.kind === 'skipped');
    summaryText.textContent = `${done.length} checked${pending ? ` · ${pending} in progress` : ''}`;
    summaryAttention.textContent = attention.length ? `${attention.length} need${attention.length === 1 ? 's' : ''} attention` : '';
    distribution.replaceChildren(...ORDER.flatMap((verdict) => {
      const n = done.filter((item) => item.check.verdict === verdict).length;
      if (!n) return [];
      const part = document.createElement('span');
      part.dataset.verdict = verdict;
      part.style.flexGrow = String(n);
      part.title = `${interviewLabels[verdict]}: ${n}`;
      return [part];
    }));
    counts.all.textContent = String(claims.length);
    counts.attention.textContent = String(attention.length);
    counts.skipped.textContent = String(skipped.length);
    const visible = items.filter((item) => filter === 'skipped'
      ? item.kind === 'skipped'
      : filter === 'attention'
        ? item.kind === 'claim' && item.state === 'done' && needsAttention(item.check.verdict)
        : item.kind === 'claim');
    feed.replaceChildren(...visible.slice().reverse().map((item) => {
      const row = document.createElement('li');
      row.append(item.card);
      return row;
    }));
    empty.textContent = visible.length ? '' : {
      all: 'No claims yet. When Pedro Sánchez says something checkable, it appears here with its verdict.',
      attention: 'Nothing doubtful yet. Claims rated False or Likely false appear here.',
      skipped: 'No skipped sentences. Questions, opinions and projections that are not checked appear here.',
    }[filter];
  }

  function toast(check: Check) {
    if (!options.isMinimised?.()) return;
    const bubble = document.createElement('button');
    bubble.type = 'button';
    bubble.className = 'toast';
    const pill = text('span', interviewLabels[check.verdict], 'verdict-pill');
    pill.dataset.verdict = check.verdict;
    bubble.append(pill, text('strong', check.short), text('span', check.note, 'check-note'));
    bubble.addEventListener('click', () => { toasts.replaceChildren(); options.expand?.(); });
    toasts.prepend(bubble);
    while (toasts.children.length > 3) toasts.lastElementChild?.remove();
    setTimeout(() => bubble.remove(), 6500);
  }

  function addSkip(skip: Skip, who: string, at: string) {
    const card = document.createElement('div');
    card.className = 'meet-check is-skipped';
    card.append(meta(who, at, `Skipped: ${skip.reason}`), text('p', `“${skip.text}”`, 'check-quote'));
    items.push({ kind: 'skipped', skip, who, at, card });
  }

  function resolveClaim(item: Extract<Item, { kind: 'claim' }>, signal?: AbortSignal, delay = 1300) {
    onBusy(true);
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (item.check.failFirst && item.state === 'pending' && !item.retried) {
          item.state = 'error';
        } else {
          item.state = 'done';
          flashScreen(item.check.verdict);
          toast(item.check);
        }
        fillClaimCard(item.card, item, () => retry(item));
        render();
        if (!active) onBusy(false);
        resolve();
      }, delay);
      signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }

  function retry(item: Extract<Item, { kind: 'claim' }>) {
    item.retried = true;
    item.state = 'pending';
    fillClaimCard(item.card, item, () => retry(item));
    render();
    void resolveClaim(item, undefined, 1100);
  }

  function addClaim(check: Check, who: string, at: string) {
    const item: Extract<Item, { kind: 'claim' }> = { kind: 'claim', check, who, at, state: 'pending', card: document.createElement('div') };
    fillClaimCard(item.card, item, () => retry(item));
    items.push(item);
    render();
    return item;
  }

  function showCaption(turn: Turn, checked = false) {
    caption.hidden = false;
    caption.replaceChildren(text('strong', `${speakers[turn.speaker]} · ${turn.at}`));
    const body = document.createElement('p');
    let rest = turn.text;
    for (const check of checked ? turn.checks ?? [] : []) {
      const said = check.claim.replace(/^Our government has/, 'We have been the government that has');
      const index = rest.indexOf(said.slice(0, 24));
      if (index < 0) continue;
      const end = rest.indexOf('.', index) + 1 || rest.length;
      body.append(document.createTextNode(rest.slice(0, index)));
      const mark = text('mark', rest.slice(index, end));
      mark.dataset.verdict = check.verdict;
      body.append(mark);
      rest = rest.slice(end);
    }
    body.append(document.createTextNode(rest));
    caption.append(body);
  }

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
    items.length = 0;
    render();
    onBusy(true);
    try {
      for (const turn of TRANSCRIPT) {
        if (signal.aborted) return;
        status.textContent = 'Listening…';
        showCaption(turn);
        await wait(1400, signal);
        const who = speakers[turn.speaker].split(' · ')[0];
        for (const skip of turn.skip ?? []) addSkip(skip, who, turn.at);
        render();
        if (turn.checks?.length) {
          status.textContent = 'Checking claims against trusted sources…';
          const pending = turn.checks.map((check) => addClaim(check, who, turn.at));
          await Promise.all(pending.map((item, index) => wait(index * 700, signal).then(() => resolveClaim(item, signal))));
          if (signal.aborted) return;
          showCaption(turn, true);
        }
        await wait(900, signal);
      }
      if (!signal.aborted) {
        const done = items.filter((item) => item.kind === 'claim' && item.state === 'done').length;
        status.textContent = `${done} claims checked · sample verdicts`;
      }
    } finally {
      active = undefined;
      onBusy(false);
      play.disabled = false;
      if (!signal.aborted) play.textContent = 'Play again';
    }
  });

  // Select text on the page to check it against the demo claims.
  let selectButton: HTMLElement | undefined;
  function clearSelectButton() { selectButton?.remove(); selectButton = undefined; }
  function onMouseUp(event: MouseEvent) {
    if (view.hidden || event.composedPath().some((node) => node === selectButton)) return;
    setTimeout(() => {
      clearSelectButton();
      const selection = window.getSelection();
      const picked = selection?.toString().trim() ?? '';
      if (picked.length < 12 || !selection?.rangeCount) return;
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '✓ Check';
      Object.assign(button.style, {
        position: 'fixed', zIndex: '2147483647', left: `${Math.max(8, rect.left + rect.width / 2 - 40)}px`,
        top: `${Math.max(8, rect.top - 40)}px`, padding: '6px 12px', border: '0', borderRadius: '999px',
        background: '#2f64e8', color: '#fff', font: '600 13px "Helvetica Neue", Helvetica, Arial, sans-serif',
        boxShadow: '0 6px 18px rgba(0,0,0,.35)', cursor: 'pointer',
      });
      button.addEventListener('mousedown', (down) => down.preventDefault());
      button.addEventListener('click', () => { clearSelectButton(); checkSelection(picked); });
      document.documentElement.append(button);
      selectButton = button;
    }, 0);
  }
  function checkSelection(picked: string) {
    options.expand?.();
    filter = 'all';
    for (const tab of Array.from(tabs.querySelectorAll('button'))) tab.setAttribute('aria-pressed', String(tab.dataset.filter === 'all'));
    const match = ALL_CHECKS.find((check) => check.match.test(picked));
    const check: Check = match ?? {
      claim: picked.slice(0, 160), short: 'Selected text', verdict: 'neutral', match: /$^/,
      note: 'No evidence about this sentence in the demo sources.', sources: [],
    };
    const item = addClaim({ ...check, claim: picked.slice(0, 160), failFirst: false }, 'Selection', 'on this page');
    item.card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    void resolveClaim(item, undefined, 1100);
  }
  document.addEventListener('mouseup', onMouseUp, true);

  render();
  return {
    view,
    toasts,
    stop: () => active?.abort(),
    destroy: () => {
      active?.abort();
      clearSelectButton();
      document.removeEventListener('mouseup', onMouseUp, true);
    },
  };
}
