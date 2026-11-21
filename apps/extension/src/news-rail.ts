// Sticky side rail for news articles: lists every checked claim with its verdict and jumps to it.
import type { FactCheckResult } from '@growth-factcheking/shared';
import { tones } from './card.js';
import type { Tone } from './card.js';
import styles from './news-rail.css';

export type RailItem = {
  text: string;
  state: 'checking' | 'checked' | 'failed';
  result?: FactCheckResult;
  elapsedMs?: number;
  /** Scrolls the page to the claim. */
  reveal: () => void;
};

const iconPaths: Record<Exclude<Tone, 'none'> | 'none' | 'collapse' | 'expand', string> = {
  ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  warn: '<path d="M9.5 9a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5M12 17.5v.01"/>',
  bad: '<path d="M7 7l10 10M17 7L7 17"/>',
  none: '<path d="M6 12h12"/>',
  collapse: '<path d="M9 6l6 6-6 6"/>',
  expand: '<path d="M15 6l-6 6 6 6"/>',
};

function svg(name: keyof typeof iconPaths) {
  const template = document.createElement('template');
  template.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name]}</svg>`;
  return template.content.firstElementChild as SVGElement;
}

function verdictOf(item: RailItem): { tone: Tone | 'busy'; label: string } {
  if (item.state === 'checking') return { tone: 'busy', label: 'Checking…' };
  if (!item.result) return { tone: 'none', label: 'Could not check' };
  if (!item.result.sources.length) return { tone: 'none', label: 'Not enough info' };
  return tones[item.result.verdict];
}

function icon(tone: Tone | 'busy') {
  const element = document.createElement('span');
  if (tone === 'busy') {
    element.className = 'icon spinner';
    return element;
  }
  element.className = 'icon';
  element.dataset.tone = tone;
  element.append(svg(tone));
  return element;
}

export function createNewsRail() {
  const host = document.createElement('div');
  host.dataset.growthFactcheckingRail = '';
  const shadow = host.attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(styles);
  shadow.adoptedStyleSheets = [sheet];
  let items: RailItem[] = [];
  let open = window.innerWidth > 1100;

  function draw() {
    const rail = document.createElement('aside');
    rail.className = open ? 'rail' : 'rail closed';
    rail.setAttribute('aria-label', 'FactChecking results for this article');

    const busy = items.some((item) => item.state === 'checking');
    const header = document.createElement('header');
    const brand = document.createElement('div');
    brand.className = 'brand';
    const dot = document.createElement('span');
    dot.className = busy ? 'dot busy' : 'dot';
    brand.append(dot, 'FactChecking');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'toggle';
    toggle.title = open ? 'Collapse' : 'Show all claims';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.append(svg(open ? 'collapse' : 'expand'));
    toggle.addEventListener('click', () => {
      open = !open;
      draw();
    });
    header.append(brand, toggle);

    const summary = document.createElement('div');
    summary.className = 'summary';
    const counts = new Map<string, { tone: Tone | 'busy'; label: string; n: number }>();
    for (const item of items) {
      const verdict = verdictOf(item);
      const entry = counts.get(verdict.label) ?? { ...verdict, n: 0 };
      entry.n++;
      counts.set(verdict.label, entry);
    }
    const order = ['Verified', 'False', 'Doubtful', 'Not enough info', 'Checking…', 'Could not check'];
    for (const entry of [...counts.values()].sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))) {
      const chip = document.createElement('span');
      chip.className = 'count';
      chip.append(icon(entry.tone), `${entry.n} ${entry.label}`);
      summary.append(chip);
    }

    const done = items.filter((item) => item.elapsedMs !== undefined);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const average = done.length ? done.reduce((sum, item) => sum + item.elapsedMs!, 0) / done.length / 1000 : undefined;
    meta.textContent = `${items.length} ${items.length === 1 ? 'claim' : 'claims'} on this page`
      + (average === undefined ? '' : ` · ${average.toFixed(1)} s average, checked live`);

    const list = document.createElement('ol');
    for (const item of items) {
      const verdict = verdictOf(item);
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.title = 'Show this claim in the article';
      const body = document.createElement('span');
      const label = document.createElement('span');
      label.className = 'label';
      label.dataset.tone = verdict.tone;
      label.textContent = verdict.label;
      const text = document.createElement('span');
      text.className = 'text';
      text.textContent = item.text;
      body.append(label, text);
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = item.elapsedMs === undefined ? '' : `${(item.elapsedMs / 1000).toFixed(1)} s`;
      button.append(icon(verdict.tone), body, time);
      button.addEventListener('click', item.reveal);
      row.append(button);
      list.append(row);
    }

    rail.append(header, summary, meta, list);
    shadow.replaceChildren(rail);
  }

  return {
    host,
    update(next: RailItem[]) {
      items = next;
      if (!host.isConnected) document.documentElement.append(host);
      draw();
    },
  };
}
