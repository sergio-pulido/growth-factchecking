// Inline fact-check pill shared by the X feed and news articles. Styles: inline-feed.css.
import type { FactCheckResult } from '@growth-factcheking/shared';
import type { FactCheckMessage, FactCheckResponse, FaviconRequest, FaviconResponse } from './messages.js';
import styles from './inline-feed.css';

const verdictLabels: Record<FactCheckResult['verdict'], string> = {
  yes: 'Supported',
  probably_yes: 'Likely supported',
  neutral: 'Inconclusive',
  probably_no: 'Likely contradicted',
  no: 'Contradicted',
};
export type Tone = 'ok' | 'warn' | 'bad' | 'none';
export const tones: Record<FactCheckResult['verdict'], { tone: Tone; label: string }> = {
  yes: { tone: 'ok', label: 'Verified' },
  probably_yes: { tone: 'ok', label: 'Verified' },
  neutral: { tone: 'warn', label: 'Doubtful' },
  probably_no: { tone: 'warn', label: 'Doubtful' },
  no: { tone: 'bad', label: 'False' },
};
const icons: Record<Tone | 'retry' | 'chevron', string> = {
  ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  warn: '<path d="M9.5 9a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5M12 17.5v.01"/>',
  bad: '<path d="M7 7l10 10M17 7L7 17"/>',
  none: '<path d="M6 12h12"/>',
  retry: '<path d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
};

function svg(name: keyof typeof icons, className?: string) {
  const template = document.createElement('template');
  template.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  const element = template.content.firstElementChild as SVGElement;
  if (className) element.classList.add(className);
  return element;
}

export function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return url;
  }
}

/** A readable label for a source link: the page's slug when it has one, otherwise the site. */
export function sourceLabel(url: string) {
  try {
    const { pathname } = new URL(url);
    const slug = decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) ?? '')
      .replace(/\.(?:aspx?|html?|php|pdf|xlsx?)$/iu, '')
      .replace(/[-_+]+|%20/gu, ' ')
      .trim();
    if (/\p{L}{3}/u.test(slug) && slug.length > 3 && !/^(?:index|default|inicio|home)$/iu.test(slug)) {
      const words = slug === slug.toUpperCase() ? slug.toLowerCase() : slug;
      return words.charAt(0).toUpperCase() + words.slice(1);
    }
  } catch {
    // Fall back to the site name.
  }
  return hostname(url);
}

// Tailwind CSS v4 600 shades for sites without a favicon: orange, emerald, teal, sky, blue, indigo, violet, fuchsia, rose.
const avatarColors = [
  'oklch(64.6% 0.222 41.116)', 'oklch(59.6% 0.145 163.225)', 'oklch(60% 0.118 184.704)',
  'oklch(58.8% 0.158 241.966)', 'oklch(54.6% 0.245 262.881)', 'oklch(51.1% 0.262 276.966)',
  'oklch(54.1% 0.281 293.009)', 'oklch(59.1% 0.293 322.896)', 'oklch(58.6% 0.253 17.585)',
];

function avatarColor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return avatarColors[hash % avatarColors.length];
}

export type CardState = 'checking' | 'checked' | 'failed';

export type CardView = {
  state: CardState;
  result?: FactCheckResult;
  /** Round trip of the check, shown on the pill. */
  elapsedMs?: number;
  onRetry?: () => void;
};

type HostState = { view: CardView; open?: boolean; allSources?: boolean };

let sheet: CSSStyleSheet | undefined;
const hostStates = new WeakMap<HTMLElement, HostState>();
const favicons = new Map<string, string | null>();

async function faviconInExtension(host: string) {
  const response = await chrome.runtime.sendMessage<FaviconRequest, FaviconResponse>({ kind: 'favicon', host });
  return response?.dataUrl;
}

let loadFavicon: (host: string) => Promise<string | undefined> = faviconInExtension;

/** Pages outside the extension, like the local X demo, load favicons their own way. */
export function setFaviconLoader(loader: (host: string) => Promise<string | undefined>) {
  loadFavicon = loader;
}

function englishStatement(source: FactCheckResult['sources'][number]) {
  return source.statementEn ?? source.statement;
}

/** The favicon as a data URL once loaded. The first call starts loading it and redraws the pills that use it. */
function faviconFor(name: string) {
  if (favicons.has(name)) return favicons.get(name) ?? undefined;
  favicons.set(name, null);
  void loadFavicon(name).catch(() => undefined).then((url) => {
    if (!url) return;
    favicons.set(name, url);
    for (const host of Array.from(document.querySelectorAll<HTMLElement>('[data-growth-factchecking]'))) {
      if (hostStates.get(host)?.view.result?.sources.some((source) => hostname(source.sourceUrl) === name)) draw(host);
    }
  });
}

function pillIcon(tone: Tone) {
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.dataset.tone = tone;
  icon.append(svg(tone));
  return icon;
}

/** An empty card host with its own shadow root, so page styles cannot reach the card. */
export function createCardHost() {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(styles);
  }
  const host = document.createElement('div');
  host.dataset.growthFactchecking = '';
  host.attachShadow({ mode: 'open' }).adoptedStyleSheets = [sheet];
  host.addEventListener('click', (event) => event.stopPropagation());
  return host;
}

export function renderCard(host: HTMLElement, view: CardView) {
  const state = hostStates.get(host) ?? { view };
  state.view = view;
  hostStates.set(host, state);
  draw(host);
}

function draw(host: HTMLElement) {
  const post = hostStates.get(host)!;
  const { result, elapsedMs, onRetry } = post.view;
  host.style.setProperty('--ring', getComputedStyle(document.body).backgroundColor);
    const card = document.createElement('section');
    if (post.view.state === 'checking') {
      const pill = document.createElement('span');
      pill.className = 'pill busy';
      pill.setAttribute('role', 'status');
      pill.title = 'FactChecking';
      const spinner = document.createElement('span');
      spinner.className = 'icon spinner';
      pill.append(spinner, 'Checking…');
      card.append(pill);
    } else if (!result) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'pill';
      pill.title = 'FactChecking could not reach the checker. Try again.';
      const icon = pillIcon('none');
      icon.replaceChildren(svg('retry'));
      pill.append(icon, 'Could not check · Retry');
      if (onRetry) pill.addEventListener('click', onRetry);
      card.append(pill);
    } else {
      const { sources } = result;
      const { tone, label } = sources.length ? tones[result.verdict] : { tone: 'none' as const, label: 'Not enough info' };
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'pill';
      pill.setAttribute('aria-expanded', String(Boolean(post.open)));
      pill.setAttribute('aria-label', `FactChecking: ${label}, ${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`);
      pill.append(pillIcon(tone), label);
      if (sources.length) {
        const divider = document.createElement('span');
        divider.className = 'divider';
        const avatars = document.createElement('span');
        avatars.className = 'avatars';
        for (const name of [...new Set(sources.map((source) => hostname(source.sourceUrl)))].slice(0, 3)) {
          const avatar = document.createElement('span');
          avatar.title = name;
          const icon = faviconFor(name);
          if (icon) {
            const image = document.createElement('img');
            image.src = icon;
            image.alt = '';
            avatar.className = 'has-icon';
            avatar.append(image);
          } else {
            avatar.textContent = name.charAt(0);
            avatar.style.background = avatarColor(name);
          }
          avatars.append(avatar);
        }
        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = `${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`;
        pill.append(divider, avatars, count);
      }
      if (elapsedMs !== undefined) {
        const timing = document.createElement('span');
        timing.className = 'count timing';
        timing.textContent = `${(elapsedMs / 1000).toFixed(1)} s`;
        timing.title = 'Time to check this claim against the sources';
        pill.append(timing);
      }
      pill.append(svg('chevron', 'chevron'));
      pill.addEventListener('click', () => {
        post.open = !post.open;
        draw(host);
      });
      card.append(pill);

      if (post.open) {
        const details = document.createElement('div');
        details.className = 'details';
        const evidence = document.createElement('p');
        evidence.className = 'evidence';
        evidence.textContent = sources.length
          ? `${verdictLabels[result.verdict]}. ${englishStatement(sources[0])}`
          : 'There are no sources about this claim in the corpus yet.';
        details.append(evidence);
        if (sources.length) {
          const links = document.createElement('div');
          links.className = 'sources';
          links.setAttribute('aria-label', 'Sources');
          const shown = post.allSources || sources.length <= 5 ? sources : sources.slice(0, 4);
          for (const source of shown) {
            const name = hostname(source.sourceUrl);
            const link = document.createElement('a');
            link.className = 'chip';
            link.href = source.sourceUrl;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.title = `${source.sourceUrl}\n${englishStatement(source)}`;
            const icon = faviconFor(name);
            const mark = document.createElement('span');
            mark.className = 'mark';
            if (icon) {
              const image = document.createElement('img');
              image.src = icon;
              image.alt = '';
              mark.append(image);
            } else {
              mark.textContent = name.charAt(0);
              mark.style.background = avatarColor(name);
            }
            const label = document.createElement('span');
            label.className = 'label';
            label.textContent = sourceLabel(source.sourceUrl);
            link.append(mark, label);
            links.append(link);
          }
          if (shown.length < sources.length) {
            const more = document.createElement('button');
            more.type = 'button';
            more.className = 'chip more';
            more.textContent = `+${sources.length - shown.length} more`;
            more.addEventListener('click', () => {
              post.allSources = true;
              draw(host);
            });
            links.append(more);
          }
          details.append(links);
        }
        card.append(details);
      }
    }
  host.shadowRoot?.replaceChildren(card);
}

/** Live check through the extension's background worker, which calls the local API. */
export async function requestInExtension(claim: string) {
  const response = await chrome.runtime.sendMessage<FactCheckMessage, FactCheckResponse>({ mode: 'live', claim });
  if (response.ok && response.result.mode === 'live') return response.result.check;
}
