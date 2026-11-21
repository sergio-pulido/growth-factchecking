// Inline fact checks on approved news articles. The local API lists the articles and the sentences
// to check (data/demo/news-articles.json); each sentence gets a card right below the text that
// contains it. Every load checks again: nothing is cached.
import { CLAIM_MAX_LENGTH } from '@growth-factcheking/shared';
import { createCardHost, renderCard, requestInExtension } from './card.js';
import type { CardView } from './card.js';
import type { NewsArticle, NewsArticlesRequest, NewsArticlesResponse } from './messages.js';

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
};

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

  function show(claim: Claim, view: CardView) {
    claim.view = view;
    if (claim.card) renderCard(claim.card, view);
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
      renderCard(claim.card!, claim.view ?? { state: 'checking' });
      if (!claim.view) {
        claim.view = { state: 'checking' };
        queue.push(claim);
      }
    }
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
