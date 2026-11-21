// Inline fact checks on approved news articles, with the same UI as X: a scanning band while a
// sentence is checked, the checked sentence highlighted in its verdict colour, and a pill under it.
// A sticky side rail lists every claim on the page. The local API lists the articles and the
// sentences to check (data/demo/news-articles.json). Every load checks again: nothing is cached.
import { CLAIM_MAX_LENGTH } from '@growth-factcheking/shared';
import { createCardHost, renderCard, requestInExtension, tones } from './card.js';
import type { CardView, Tone } from './card.js';
import { findCheckedRange, highlightStyles } from './inline-feed.js';
import scannerStyles from './inline-scanner.css';
import type { NewsArticle, NewsArticlesRequest, NewsArticlesResponse } from './messages.js';
import { createNewsRail } from './news-rail.js';

const concurrentChecks = 3;
const autoClaimLimit = 6;
// Pages that hydrate or lazy-load can replace their body after load; keep cards in place this long.
const watchMs = 30_000;
const blockSelector = 'h1, h2, h3, h4, p, li, blockquote, figcaption, td, dd, dt';

type Claim = {
  text: string;
  block?: HTMLElement;
  card?: HTMLElement;
  /** What the card shows now, so it can be redrawn if the page re-renders. */
  view?: CardView;
  checked?: boolean;
  scanner?: HTMLElement;
  highlight?: { range: Range; tone: Exclude<Tone, 'none'> };
};

let scannerSheet: CSSStyleSheet | undefined;

/** The soft blue band X shows over a post while it is checked, here over the paragraph. */
function showScanner(claim: Claim) {
  if (claim.scanner?.isConnected || !claim.block?.getClientRects().length) return;
  if (!scannerSheet) {
    scannerSheet = new CSSStyleSheet();
    scannerSheet.replaceSync(scannerStyles);
  }
  const host = document.createElement('div');
  host.dataset.growthFactcheckingScanner = '';
  host.setAttribute('aria-hidden', 'true');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.adoptedStyleSheets = [scannerSheet];
  shadow.append(document.createElement('div'));
  if (getComputedStyle(claim.block).position === 'static') claim.block.style.position = 'relative';
  claim.block.append(host);
  claim.scanner = host;
}

function hideScanner(claim: Claim) {
  claim.scanner?.remove();
  claim.scanner = undefined;
}

function pageKey(href: string) {
  const url = new URL(href);
  return url.hostname.replace(/^www\./u, '') + url.pathname.replace(/\/+$/u, '');
}

function normalize(text: string) {
  return text.replace(/[‘’]/gu, "'").replace(/[“”«»]/gu, '"')
    .replace(/\s+/gu, ' ').trim().toLowerCase();
}

/** The smallest block on the page whose text contains the sentence. */
function locate(sentence: string) {
  const wanted = normalize(sentence);
  let best: HTMLElement | undefined;
  let bestLength = Infinity;
  for (const block of Array.from(document.querySelectorAll<HTMLElement>(blockSelector))) {
    if (block.closest('[data-growth-factchecking]')) continue;
    const text = normalize(block.textContent ?? '');
    if (text.length < bestLength && text.includes(wanted)) {
      best = block;
      bestLength = text.length;
    }
  }
  return best;
}

/** Without curated sentences: the headline and the first paragraphs that state a figure. */
function autoClaims(): Claim[] {
  const scope = document.querySelector('article') ?? document.querySelector('main') ?? document.body;
  const headline = scope.querySelector<HTMLElement>('h1') ?? document.querySelector<HTMLElement>('h1');
  const paragraphs = Array.from(scope.querySelectorAll<HTMLElement>('p'))
    .filter((p) => /\d/u.test(p.innerText) && p.innerText.trim().length >= 40);
  return [headline, ...paragraphs].filter((block): block is HTMLElement => Boolean(block))
    .slice(0, autoClaimLimit)
    .map((block) => ({ text: block.innerText.trim().replace(/\s+/gu, ' '), block }))
    .filter(({ text }) => text.length <= CLAIM_MAX_LENGTH);
}

/** Puts the card under its sentence, or under the nearest visible container when the sentence sits in a collapsed panel. */
function place(claim: Claim) {
  const block = claim.block!;
  claim.card = createCardHost();
  claim.card.dataset.claim = claim.text;
  let anchor = block;
  while (anchor.parentElement && anchor.parentElement !== document.body && !anchor.parentElement.getClientRects().length) {
    anchor = anchor.parentElement;
  }
  if (anchor === block && block.getClientRects().length && block.matches('li, td, dd, dt')) {
    // List items and table cells keep the card inside them so the markup stays valid.
    block.append(claim.card);
  } else {
    anchor.after(claim.card);
  }
}

function start(article: NewsArticle) {
  const claims: Claim[] = article.claims.length ? article.claims.map((text) => ({ text })) : autoClaims();
  const queue: Claim[] = [];
  let running = 0;
  const rail = createNewsRail();
  const highlights = typeof Highlight === 'function' && 'highlights' in CSS
    ? { ok: new Highlight(), warn: new Highlight(), bad: new Highlight() }
    : undefined;
  if (highlights) {
    for (const [tone, highlight] of Object.entries(highlights)) CSS.highlights.set(`growth-factchecking-${tone}`, highlight);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(highlightStyles);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }

  function highlight(claim: Claim) {
    if (claim.highlight && highlights) highlights[claim.highlight.tone].delete(claim.highlight.range);
    claim.highlight = undefined;
    const result = claim.view?.result;
    if (!highlights || !claim.block || !result?.sources.length) return;
    const { tone } = tones[result.verdict];
    if (tone === 'none') return;
    const range = findCheckedRange(claim.block, claim.text);
    if (!range) return;
    highlights[tone].add(range);
    claim.highlight = { range, tone };
  }

  function reveal(claim: Claim) {
    const target = claim.block?.getClientRects().length ? claim.block : claim.card;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!claim.block) return;
    showScanner(claim);
    setTimeout(() => {
      if (claim.view?.state !== 'checking') hideScanner(claim);
    }, 1400);
  }

  function updateRail() {
    rail.update(claims.filter((claim) => claim.card).map((claim) => ({
      text: claim.text,
      state: claim.view?.state ?? 'checking',
      result: claim.view?.result,
      elapsedMs: claim.view?.elapsedMs,
      reveal: () => reveal(claim),
    })));
  }

  function show(claim: Claim, view: CardView) {
    claim.view = view;
    if (claim.card) renderCard(claim.card, view);
    if (view.state === 'checking') showScanner(claim);
    else hideScanner(claim);
    highlight(claim);
    updateRail();
  }

  async function check(claim: Claim) {
    running++;
    show(claim, { state: 'checking' });
    const started = performance.now();
    let result;
    try {
      result = await requestInExtension(claim.text);
    } catch {
      // The extension or local API may have restarted.
    }
    claim.checked = true;
    show(claim, {
      state: result ? 'checked' : 'failed',
      result,
      elapsedMs: performance.now() - started,
      onRetry: () => {
        queue.push(claim);
        drain();
      },
    });
    running--;
    drain();
  }

  function drain() {
    while (running < concurrentChecks && queue.length) void check(queue.shift()!);
  }

  function attach() {
    for (const claim of claims) {
      if (claim.card?.isConnected) continue;
      // First sighting, or the page replaced the markup the card was attached to.
      if (!claim.block?.isConnected) claim.block = locate(claim.text);
      if (!claim.block) continue;
      place(claim);
      if (claim.view) {
        show(claim, claim.view);
      } else {
        show(claim, { state: 'checking' });
        queue.push(claim);
      }
    }
    updateRail();
    drain();
  }

  attach();
  let frame = 0;
  const observer = new MutationObserver(() => {
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      attach();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), watchMs);
}

void chrome.runtime.sendMessage<NewsArticlesRequest, NewsArticlesResponse>({ kind: 'news-demo-articles' })
  .then((response) => {
    const here = pageKey(location.href);
    const article = response?.articles.find(({ url }) => pageKey(url) === here);
    if (article) start(article);
  })
  .catch(() => {
    // No extension background or API: leave the page untouched.
  });
