import { CLAIM_MAX_LENGTH } from '@growth-factcheking/shared';
import type { FactCheckResult } from '@growth-factcheking/shared';
import type { FactCheckMessage, FactCheckResponse, FaviconRequest, FaviconResponse } from './messages.js';
import styles from './inline-feed.css';
import scannerStyles from './inline-scanner.css';

const articleSelector = 'article[data-testid="tweet"]';
const textSelector = '[data-testid="tweetText"]';
const concurrentChecks = 2;
const cacheLimit = 200;
const verdictLabels: Record<FactCheckResult['verdict'], string> = {
  yes: 'Supported',
  probably_yes: 'Likely supported',
  neutral: 'Inconclusive',
  probably_no: 'Likely contradicted',
  no: 'Contradicted',
};
type Tone = 'ok' | 'warn' | 'bad' | 'none';
const tones: Record<FactCheckResult['verdict'], { tone: Tone; label: string }> = {
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

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return url;
  }
}

// Tailwind CSS v4 palette: a 500 tint behind the text, underlined in the 600 shade.
const highlightStyles = `
::highlight(growth-factchecking-ok) { background-color: oklch(72.3% 0.219 149.579 / 18%); text-decoration: underline 2px oklch(62.7% 0.194 149.214); }
::highlight(growth-factchecking-warn) { background-color: oklch(76.9% 0.188 70.08 / 20%); text-decoration: underline 2px oklch(66.6% 0.179 58.318); }
::highlight(growth-factchecking-bad) { background-color: oklch(63.7% 0.237 25.331 / 16%); text-decoration: underline 2px oklch(57.7% 0.245 27.325); }
`;
const tagPattern = /[#@$]\S+/gu;

function claimNumbers(text: string) {
  return new Set(text.replace(tagPattern, ' ').match(/\d+(?:[.,]\d+)*/gu)?.map((value) => value.replace(/[.,]/gu, '')) ?? []);
}

function claimWords(text: string) {
  const plain = text.replace(tagPattern, ' ').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  return new Set(plain.match(/\p{L}{5,}/gu)?.map((word) => word.slice(0, 5)) ?? []);
}

/**
 * The checker does not say which part of a post it checked, so this picks the sentence that best
 * matches the evidence: shared numbers and dates first, then shared word stems. Hashtags and
 * mentions are ignored. Returns nothing when no sentence clearly matches.
 */
export function findCheckedRange(root: HTMLElement, evidence: string) {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    nodes.push(node);
    starts.push(text.length);
    text += node.data;
  }
  const numbers = claimNumbers(evidence);
  const words = claimWords(evidence);
  let best: { score: number; start: number; end: number } | undefined;
  for (const match of text.matchAll(/[^\n]+?(?:[.!?…]+(?=\s|$)|(?=\n)|$)/gu)) {
    const sharedNumbers = [...claimNumbers(match[0])].filter((value) => numbers.has(value)).length;
    const sharedWords = [...claimWords(match[0])].filter((value) => words.has(value)).length;
    const score = sharedNumbers * 3 + sharedWords;
    if ((sharedNumbers > 0 || sharedWords >= 2) && (!best || score > best.score)) {
      best = { score, start: match.index, end: match.index + match[0].length };
    }
  }
  if (!best) return;
  while (best.start < best.end && /\s/u.test(text[best.start])) best.start++;
  while (best.end > best.start && /\s/u.test(text[best.end - 1])) best.end--;
  const locate = (offset: number, isEnd: boolean) => {
    for (let index = 0; index < nodes.length; index++) {
      const length = nodes[index].data.length;
      if (offset < starts[index] + length || (isEnd && offset === starts[index] + length)) return { node: nodes[index], offset: offset - starts[index] };
    }
  };
  const start = locate(best.start, false);
  const end = locate(best.end, true);
  if (!start || !end) return;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
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

type Post = {
  text: HTMLElement;
  claim: string;
  visible: boolean;
  state: 'idle' | 'checking' | 'checked' | 'failed';
  card?: HTMLElement;
  scanner?: HTMLElement;
  open?: boolean;
  allSources?: boolean;
  result?: FactCheckResult;
  highlight?: { range: Range; tone: Tone };
};

declare global {
  interface Window {
    growthFactCheckingFeed?: () => void;
  }
}

export function isXHome() {
  return location.hostname === 'x.com' && /^\/home\/?$/.test(location.pathname);
}

function xStatusId(path: string) {
  return /^\/(?:[a-z0-9_]+|i\/web)\/status\/(\d+)\/?$/iu.exec(path)?.[1];
}

export function isXPost() {
  return location.hostname === 'x.com' && Boolean(xStatusId(location.pathname));
}

export function isXBookmarks() {
  if (location.hostname !== 'x.com') return false;
  if (/^\/i\/(?:bookmarks|history\/bookmarks)(?:\/|$)/.test(location.pathname)) return true;
  return /^\/i\/history\/?$/.test(location.pathname)
    && Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')).some(
      (tab) => /^(bookmarks|marcadores|guardados)$/iu.test(tab.textContent?.trim() ?? ''),
    );
}

export function isXFactCheckPage() {
  return isXHome() || isXPost() || isXBookmarks();
}

export function articleStatusId(article: HTMLElement) {
  for (const time of Array.from(article.querySelectorAll('time'))) {
    const permalink = time.closest('a');
    if (!permalink || permalink.parentElement?.closest('[role="link"]')) continue;
    const id = xStatusId(permalink.pathname);
    if (id) return id;
  }
}

function readPost(article: HTMLElement) {
  if (isXPost() && articleStatusId(article) !== xStatusId(location.pathname)) return;
  const text = Array.from(article.querySelectorAll<HTMLElement>(textSelector)).find((candidate) =>
    candidate.closest(articleSelector) === article && !candidate.closest('[role="link"]'),
  );
  if (!text || article.querySelector('[data-testid="tweet-text-show-more-link"]:not([role="link"] *)')) return;
  const claim = text.innerText.trim().replace(/\s+/gu, ' ');
  if (!claim || claim.length > CLAIM_MAX_LENGTH || !/\p{L}/u.test(claim)) return;
  return { text, claim };
}

async function faviconInExtension(host: string) {
  const response = await chrome.runtime.sendMessage<FaviconRequest, FaviconResponse>({ kind: 'favicon', host });
  return response?.dataUrl;
}

async function requestInExtension(claim: string) {
  const response = await chrome.runtime.sendMessage<FactCheckMessage, FactCheckResponse>({ mode: 'live', claim });
  if (response.ok && response.result.mode === 'live') return response.result.check;
}

type FeedOptions = {
  available?: () => boolean;
  accepts?: (article: HTMLElement) => boolean;
  request?: (claim: string) => Promise<FactCheckResult | undefined>;
  favicon?: (host: string) => Promise<string | undefined>;
};

export function startInlineFeed({
  available = isXFactCheckPage,
  accepts = () => true,
  request = requestInExtension,
  favicon = faviconInExtension,
}: FeedOptions = {}) {
  if (!available() || window.growthFactCheckingFeed) return;
  const posts = new Map<HTMLElement, Post>();
  const waiting = new Set<HTMLElement>();
  const running = new Set<string>();
  const cache = new Map<string, FactCheckResult>();
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(styles);
  const scannerSheet = new CSSStyleSheet();
  scannerSheet.replaceSync(scannerStyles);
  let frame = 0;
  let stopped = false;
  const favicons = new Map<string, string | null>();
  const highlights = typeof Highlight === 'function' && 'highlights' in CSS
    ? { ok: new Highlight(), warn: new Highlight(), bad: new Highlight() }
    : undefined;
  const highlightSheet = new CSSStyleSheet();
  highlightSheet.replaceSync(highlightStyles);
  if (highlights) {
    for (const [tone, highlight] of Object.entries(highlights)) CSS.highlights.set(`growth-factchecking-${tone}`, highlight);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, highlightSheet];
  }

  function faviconFor(name: string) {
    if (favicons.has(name)) return favicons.get(name) ?? undefined;
    favicons.set(name, null);
    void favicon(name).catch(() => undefined).then((url) => {
      if (!url || stopped) return;
      favicons.set(name, url);
      for (const post of posts.values()) {
        if (post.result?.sources.some((source) => hostname(source.sourceUrl) === name)) render(post, post.result);
      }
    });
  }

  function clearHighlight(post: Post) {
    if (post.highlight && highlights && post.highlight.tone !== 'none') highlights[post.highlight.tone].delete(post.highlight.range);
    post.highlight = undefined;
  }

  function highlightClaim(post: Post, result: FactCheckResult) {
    clearHighlight(post);
    if (!highlights || !result.sources.length) return;
    const { tone } = tones[result.verdict];
    const range = findCheckedRange(post.text, result.sources[0].statement);
    if (!range || tone === 'none') return;
    highlights[tone].add(range);
    post.highlight = { range, tone };
  }

  function retry(post: Post) {
    post.state = 'idle';
    for (const [article, entry] of posts) {
      if (entry === post && entry.visible) waiting.add(article);
    }
    drain();
  }

  function pillIcon(tone: Tone) {
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.dataset.tone = tone;
    icon.append(svg(tone));
    return icon;
  }

  function render(post: Post, result?: FactCheckResult) {
    const host = post.card ?? document.createElement('div');
    if (!post.card) {
      post.card = host;
      host.dataset.growthFactchecking = '';
      host.attachShadow({ mode: 'open' }).adoptedStyleSheets = [sheet];
      host.addEventListener('click', (event) => event.stopPropagation());
      post.text.after(host);
    }
    host.style.setProperty('--ring', getComputedStyle(document.body).backgroundColor);

    const card = document.createElement('section');
    if (post.state === 'checking' || (!result && post.state !== 'failed')) {
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
      pill.addEventListener('click', () => retry(post));
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
      pill.append(svg('chevron', 'chevron'));
      pill.addEventListener('click', () => {
        post.open = !post.open;
        render(post, result);
      });
      card.append(pill);

      if (post.open) {
        const details = document.createElement('div');
        details.className = 'details';
        const evidence = document.createElement('p');
        evidence.className = 'evidence';
        evidence.textContent = sources.length
          ? `${verdictLabels[result.verdict]}. ${sources[0].statement}`
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
            link.title = `${source.sourceUrl}\n${source.statement}`;
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
              render(post, result);
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

  function showScanner(article: HTMLElement, post: Post) {
    if (post.scanner) return;
    const host = document.createElement('div');
    host.dataset.growthFactcheckingScanner = '';
    host.setAttribute('aria-hidden', 'true');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.adoptedStyleSheets = [scannerSheet];
    shadow.append(document.createElement('div'));
    if (getComputedStyle(article).position === 'static') article.style.position = 'relative';
    article.append(host);
    post.scanner = host;
  }

  function hideScanner(post: Post) {
    post.scanner?.remove();
    post.scanner = undefined;
  }

  function complete(post: Post, result?: FactCheckResult) {
    post.state = result ? 'checked' : 'failed';
    post.result = result;
    render(post, result);
    if (result) highlightClaim(post, result);
    else clearHighlight(post);
  }

  async function check(article: HTMLElement, post: Post) {
    const { claim } = post;
    running.add(claim);
    post.state = 'checking';
    render(post);
    showScanner(article, post);
    let result: FactCheckResult | undefined;
    try {
      result = await request(claim);
      if (result) {
        if (cache.size === cacheLimit) cache.delete(cache.keys().next().value!);
        cache.set(claim, result);
      }
    } catch {
      // The extension or local API may have restarted.
    } finally {
      running.delete(claim);
      hideScanner(post);
    }
    if (!stopped && available() && article.isConnected && posts.get(article) === post && accepts(article) && readPost(article)?.claim === claim) {
      complete(post, result);
    }
    drain();
  }

  function drain() {
    if (stopped || !available()) return;
    for (const article of waiting) {
      const post = posts.get(article);
      if (!post?.visible || !article.isConnected || post.state !== 'idle') {
        waiting.delete(article);
        continue;
      }
      const current = accepts(article) ? readPost(article) : undefined;
      if (current?.claim !== post.claim || current.text !== post.text) {
        waiting.delete(article);
        scheduleScan();
        continue;
      }
      const hit = cache.get(post.claim);
      if (hit) {
        waiting.delete(article);
        complete(post, hit);
      } else if (running.size < concurrentChecks && !running.has(post.claim)) {
        waiting.delete(article);
        void check(article, post);
      }
    }
  }

  const visibility = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const article = entry.target as HTMLElement;
      const post = posts.get(article);
      if (!post) continue;
      post.visible = entry.isIntersecting;
      if (post.visible && post.state === 'idle') waiting.add(article);
      else waiting.delete(article);
    }
    drain();
  });

  function forget(article: HTMLElement, post: Post) {
    visibility.unobserve(article);
    waiting.delete(article);
    hideScanner(post);
    clearHighlight(post);
    post.card?.remove();
    posts.delete(article);
  }

  function scan() {
    frame = 0;
    if (!available()) {
      for (const [article, post] of posts) forget(article, post);
      return;
    }
    for (const [article, post] of posts) {
      const current = article.isConnected && accepts(article) ? readPost(article) : undefined;
      if (!current || current.text !== post.text || current.claim !== post.claim
        || (post.card && post.card.previousElementSibling !== post.text)) {
        forget(article, post);
      }
    }
    for (const article of Array.from(document.querySelectorAll<HTMLElement>(articleSelector))) {
      if (posts.has(article) || !accepts(article)) continue;
      const current = readPost(article);
      if (!current) continue;
      posts.set(article, { ...current, visible: false, state: 'idle' });
      visibility.observe(article);
    }
  }

  function scheduleScan() {
    if (!stopped && !frame) frame = requestAnimationFrame(scan);
  }

  const mutations = new MutationObserver(scheduleScan);
  mutations.observe(document.body, {
    attributes: true,
    attributeFilter: ['aria-selected'],
    childList: true,
    characterData: true,
    subtree: true,
  });
  window.growthFactCheckingFeed = () => {
    stopped = true;
    mutations.disconnect();
    if (frame) cancelAnimationFrame(frame);
    for (const [article, post] of posts) forget(article, post);
    visibility.disconnect();
    cache.clear();
    if (highlights) {
      for (const tone of Object.keys(highlights)) CSS.highlights.delete(`growth-factchecking-${tone}`);
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== highlightSheet);
    }
    window.growthFactCheckingFeed = undefined;
  };
  scan();
}
