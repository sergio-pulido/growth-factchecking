// Feed cards for the call panel: claim verdicts, sources and transcript lines.
import { VERDICTS } from '@growth-factcheking/shared';
import type { Verdict } from '@growth-factcheking/shared';
import { verdictLabels } from '../verdict-labels.js';
import { clock, h, icon } from './dom.js';
import type { ClaimItem, TranscriptLine } from './types.js';

type Tone = { color: string; bg: string; step: number; why: string };

export const TONES: Record<Verdict, Tone> = {
  yes: { color: '--v-yes', bg: '--v-yes-bg', step: 5, why: 'Las fuentes lo confirman.' },
  probably_yes: { color: '--v-pyes', bg: '--v-pyes-bg', step: 4, why: 'Las fuentes apuntan a que es cierto.' },
  neutral: { color: '--v-neutral', bg: '--v-neutral-bg', step: 3, why: 'Las fuentes no permiten confirmarlo ni descartarlo.' },
  probably_no: { color: '--v-pno', bg: '--v-pno-bg', step: 2, why: 'Las fuentes apuntan a que no es cierto.' },
  no: { color: '--v-no', bg: '--v-no-bg', step: 1, why: 'Las fuentes lo contradicen.' },
};
export const ORDER: readonly Verdict[] = VERDICTS;
export const NO_EVIDENCE = 'No hay evidencia sobre esta afirmación en las fuentes disponibles.';

const cssVar = (name: string) => `var(${name})`;

export function verdictPill(verdict: Verdict | null, label?: string): HTMLSpanElement {
  const pill = h('span', { class: 'pill' }, h('i'), label ?? (verdict ? verdictLabels[verdict] : 'Sin contrastar'));
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

  const label = h('span', { class: 'src-label' },
    count ? `Contrastado con ${count} fuente${count > 1 ? 's' : ''}` : 'Sin fuentes encontradas',
    h('span', { class: 'src-sub' }, count ? ` · ${hosts.slice(0, 2).join(', ')}` : ''));
  const chevron = icon('chevron');
  chevron.classList.add('chev');
  const toggle = h('button', { class: 'src-toggle', type: 'button', 'aria-expanded': String(item.open) }, favs, label, chevron);
  toggle.addEventListener('click', () => onToggle(item.id));

  const section = h('div', { class: `sources${item.open ? ' open' : ''}` }, toggle);
  if (item.open) {
    const body = h('div', { class: 'src-body' });
    if (!count) body.append(h('div', { class: 'src-fail' }, 'Ningún documento del corpus menciona esta afirmación.'));
    for (const source of item.sources) {
      const host = hostOf(source.sourceUrl);
      body.append(h('div', { class: 'src-item' },
        h('a', { class: 'chip', href: source.sourceUrl, target: '_blank', rel: 'noopener noreferrer', title: source.sourceUrl },
          favicon(host), h('span', {}, host)),
        h('p', { class: 'src-statement' }, `“${source.statement}”`)));
    }
    section.append(body);
  }
  return section;
}

export type CardHandlers = { onRetry(id: string): void; onToggle(id: string): void };

function meta(speaker: string, at: number) {
  return h('div', { class: 'meta' }, h('span', { class: 'who' }, speaker), h('span', { class: 'mono' }, clock(at)));
}

export function claimCard(item: ClaimItem, handlers: CardHandlers, extra = ''): HTMLDivElement {
  const quote = h('p', { class: 'quote' }, `“${item.claim}”`);
  if (item.state === 'retrying') {
    return h('div', { class: `card pending ${extra}`, 'data-id': item.id }, meta(item.speaker, item.at), quote,
      h('div', { class: 'meta' }, 'Verificando con las fuentes…'), shimmer());
  }
  if (item.state === 'failed' || !item.verdict) {
    const retry = h('button', { class: 'link', type: 'button' }, 'Reintentar');
    retry.addEventListener('click', () => handlers.onRetry(item.id));
    return h('div', { class: `card error ${extra}`, 'data-id': item.id }, meta(item.speaker, item.at), quote,
      h('div', { class: 'verdict' }, verdictPill(null)),
      h('p', { class: 'why' }, 'No se pudo contrastar. La llamada sigue y puedes reintentarlo.'),
      h('div', { class: 'actions' }, retry));
  }
  const why = item.sources.length ? TONES[item.verdict].why : NO_EVIDENCE;
  return h('div', { class: `card ${extra}`, 'data-id': item.id }, meta(item.speaker, item.at), quote,
    h('div', { class: 'verdict' }, verdictPill(item.verdict), scale(item.verdict)),
    h('p', { class: 'why' }, why),
    sourcesSection(item, handlers.onToggle));
}

function shimmer() {
  const bar = h('div', { class: 'shimmer' });
  bar.style.width = '70%';
  return bar;
}

export function analyzingCard(count: number): HTMLDivElement {
  return h('div', { class: 'card pending' },
    h('div', { class: 'meta' }, `Analizando ${count === 1 ? 'la última frase' : `las últimas ${count} frases`}…`), shimmer());
}

export function transcriptLine(line: TranscriptLine): HTMLDivElement {
  return h('div', { class: 'line' }, meta(line.speaker, line.at), h('p', { class: 'quote' }, line.text));
}
