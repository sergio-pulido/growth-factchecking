// Feed cards for the call panel: claim verdicts, sources and transcript lines.
import { VERDICTS } from '@growth-factcheking/shared';
import type { Verdict } from '@growth-factcheking/shared';
import { verdictLabels } from '../verdict-labels.js';
import { clock, h, icon } from './dom.js';
import type { ClaimItem, TranscriptLine } from './types.js';

type Tone = { color: string; bg: string; step: number; why: string };

export const TONES: Record<Verdict, Tone> = {
  yes: { color: '--v-yes', bg: '--v-yes-bg', step: 5, why: 'The sources confirm it.' },
  probably_yes: { color: '--v-pyes', bg: '--v-pyes-bg', step: 4, why: 'The sources suggest it is true.' },
  neutral: { color: '--v-neutral', bg: '--v-neutral-bg', step: 3, why: 'The sources neither confirm nor rule it out.' },
  probably_no: { color: '--v-pno', bg: '--v-pno-bg', step: 2, why: 'The sources suggest it is not true.' },
  no: { color: '--v-no', bg: '--v-no-bg', step: 1, why: 'The sources contradict it.' },
};
export const ORDER: readonly Verdict[] = VERDICTS;
export const NO_EVIDENCE = 'There is no evidence about this claim in the available sources.';
export const GENERAL_KNOWLEDGE = 'Not in our sources. Rated from well-established general knowledge, with no document cited.';

const cssVar = (name: string) => `var(${name})`;

export function verdictPill(verdict: Verdict | null, label?: string): HTMLSpanElement {
  const pill = h('span', { class: 'pill' }, h('i'), label ?? (verdict ? verdictLabels[verdict] : 'Not checked'));
  pill.style.background = cssVar(verdict ? TONES[verdict].bg : '--surface-2');
  pill.style.color = cssVar(verdict ? TONES[verdict].color : '--t2');
  return pill;
}

function scale(verdict: Verdict) {
  const bar = h('span', { class: 'scale', 'aria-hidden': 'true' });
  for (let step = 1; step <= 5; step++) {
    const mark = h('span');
    if (step === TONES[verdict].step) mark.style.background = cssVar(TONES[verdict].color);
    bar.append(mark);
  }
  return bar;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return url;
  }
}

function hue(text: string) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

function favicon(host: string) {
  const fav = h('span', { class: 'fav' }, (host[0] ?? '?').toUpperCase());
  fav.style.background = `hsl(${hue(host)} 55% 42%)`;
  return fav;
}

function sourcesSection(item: ClaimItem, onToggle: (id: string) => void) {
  const count = item.sources.length;
  const hosts = [...new Set(item.sources.map(({ sourceUrl }) => hostOf(sourceUrl)))];
  const favs = h('span', { class: 'favs' });
  if (count) hosts.slice(0, 4).forEach((host) => favs.append(favicon(host)));
  else favs.append(h('span', { class: 'fav fav-none' }, icon('search')));

  const general = item.basis === 'general_knowledge';
  const label = h('span', { class: 'src-label' },
    count ? `Checked against ${count} source${count > 1 ? 's' : ''}` : general ? 'General knowledge · no source cited' : 'No sources found',
    h('span', { class: 'src-sub' }, count ? ` · ${hosts.slice(0, 2).join(', ')}` : ''));
  const chevron = icon('chevron');
  chevron.classList.add('chev');
  const toggle = h('button', { class: 'src-toggle', type: 'button', 'aria-expanded': String(item.open) }, favs, label, chevron);
  toggle.addEventListener('click', () => onToggle(item.id));

  const section = h('div', { class: `sources${item.open ? ' open' : ''}` }, toggle);
  if (item.open) {
    const body = h('div', { class: 'src-body' });
    if (!count) {
      body.append(h('div', { class: 'src-fail' }, general
        ? 'No document in the corpus mentions this claim. The verdict comes from the model\'s general knowledge of long-settled facts, not from a cited source.'
        : 'No document in the corpus mentions this claim.'));
    }
    for (const source of item.sources) {
      const host = hostOf(source.sourceUrl);
      body.append(h('div', { class: 'src-item' },
        h('a', { class: 'chip', href: source.sourceUrl, target: '_blank', rel: 'noopener noreferrer', title: source.sourceUrl },
          favicon(host), h('span', {}, host)),
        h('p', { class: 'src-statement' }, `“${source.statementEn ?? source.statement}”`)));
    }
    section.append(body);
  }
  return section;
}

export type CardHandlers = {
  onRetry(id: string): void;
  onToggle(id: string): void;
  /** Opens (id) or closes (null) the editor for a claim's wording. */
  onEdit(id: string | null): void;
  /** Re-checks the claim with the corrected wording. */
  onSubmitEdit(id: string, text: string): void;
  /** Keeps the draft across re-renders. */
  onDraft(id: string, text: string): void;
};

export type EditState = { id: string; draft: string } | null;

function meta(speaker: string, at: number) {
  return h('div', { class: 'meta' }, h('span', { class: 'who' }, speaker), h('span', { class: 'mono' }, clock(at)));
}

function editor(item: ClaimItem, draft: string, handlers: CardHandlers) {
  const input = h('textarea', { class: 'edit-input', rows: '3', maxlength: '1000', 'aria-label': 'Claim text', 'data-edit': item.id });
  input.value = draft;
  input.addEventListener('input', () => handlers.onDraft(item.id, input.value));
  const save = h('button', { class: 'btn primary sm', type: 'button' }, 'Re-check');
  const cancel = h('button', { class: 'link', type: 'button' }, 'Cancel');
  const submit = () => {
    if (input.value.trim()) handlers.onSubmitEdit(item.id, input.value);
  };
  save.addEventListener('click', submit);
  cancel.addEventListener('click', () => handlers.onEdit(null));
  input.addEventListener('keydown', (event) => {
    event.stopPropagation(); // Meet and other call apps bind single-key shortcuts.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      handlers.onEdit(null);
    }
  });
  return h('div', { class: 'edit' }, input, h('div', { class: 'actions' }, save, cancel));
}

function editLink(item: ClaimItem, handlers: CardHandlers) {
  const edit = h('button', { class: 'link', type: 'button', title: 'Fix the wording and check again' }, 'Edit');
  edit.addEventListener('click', () => handlers.onEdit(item.id));
  return edit;
}

export function claimCard(item: ClaimItem, handlers: CardHandlers, extra = '', edit: EditState = null): HTMLDivElement {
  const quote = edit?.id === item.id
    ? editor(item, edit.draft, handlers)
    : h('p', { class: 'quote' }, `“${item.claim}”`, item.edited ? h('span', { class: 'edited' }, ' (edited)') : '');
  if (item.state === 'retrying') {
    return h('div', { class: `card pending ${extra}`, 'data-id': item.id }, meta(item.speaker, item.at), quote,
      h('div', { class: 'meta' }, 'Checking against the sources…'), shimmer());
  }
  if (item.state === 'failed' || !item.verdict) {
    const retry = h('button', { class: 'link', type: 'button' }, 'Retry');
    retry.addEventListener('click', () => handlers.onRetry(item.id));
    return h('div', { class: `card error ${extra}`, 'data-id': item.id }, meta(item.speaker, item.at), quote,
      h('div', { class: 'verdict' }, verdictPill(null)),
      h('p', { class: 'why' }, 'Could not be checked. The call goes on and you can retry.'),
      h('div', { class: 'actions' }, retry, editLink(item, handlers)));
  }
  const why = item.sources.length ? TONES[item.verdict].why
    : item.basis === 'general_knowledge' ? GENERAL_KNOWLEDGE : NO_EVIDENCE;
  const card = h('div', { class: `card ${extra}`, 'data-id': item.id }, meta(item.speaker, item.at), quote,
    h('div', { class: 'verdict' }, verdictPill(item.verdict), scale(item.verdict)),
    h('p', { class: 'why' }, why),
    sourcesSection(item, handlers.onToggle));
  if (edit?.id !== item.id) card.append(h('div', { class: 'actions' }, editLink(item, handlers)));
  return card;
}

function shimmer() {
  const bar = h('div', { class: 'shimmer' });
  bar.style.width = '70%';
  return bar;
}

export function analyzingCard(count: number): HTMLDivElement {
  return h('div', { class: 'card pending' },
    h('div', { class: 'meta' }, `Analysing ${count === 1 ? 'the last sentence' : `the last ${count} sentences`}…`), shimmer());
}

export function transcriptLine(line: TranscriptLine): HTMLDivElement {
  return h('div', { class: 'line' }, meta(line.speaker, line.at), h('p', { class: 'quote' }, line.text));
}
