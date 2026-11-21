// Inline fact checks on approved news articles. The local API lists the articles and the sentences
// to check (data/demo/news-articles.json); each sentence gets a card right below the text that
// contains it. Every load checks again: nothing is cached.
import { CLAIM_MAX_LENGTH } from '@growth-factcheking/shared';
import { createCardHost, renderCard, requestInExtension } from './card.js';
import type { NewsArticle, NewsArticlesRequest, NewsArticlesResponse } from './messages.js';

const concurrentChecks = 3;
const autoClaimLimit = 6;
const locateTimeoutMs = 20_000;
const blockSelector = 'h1, h2, h3, h4, p, li, blockquote, figcaption, td, dd, dt';

type Claim = { text: string; block?: HTMLElement; card?: HTMLElement };

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
  for (const block of Array.from(document.querySelectorAll<HTMLElement>(blockSelector))) {
    if (block.closest('[data-growth-factchecking]')) continue;
    const text = normalize(block.innerText || block.textContent || '');
    if (text.includes(wanted) && (!best || text.length < normalize(best.innerText).length)) best = block;
  }
  return best;
}

/** Without curated sentences: the headline and the first paragraphs that state a figure. */
function autoClaims() {
  const scope = document.querySelector('article') ?? document.querySelector('main') ?? document.body;
  const headline = scope.querySelector<HTMLElement>('h1') ?? document.querySelector<HTMLElement>('h1');
  const paragraphs = Array.from(scope.querySelectorAll<HTMLElement>('p'))
    .filter((p) => /\d/u.test(p.innerText) && p.innerText.trim().length >= 40);
  return [headline, ...paragraphs].filter((block): block is HTMLElement => Boolean(block))
    .slice(0, autoClaimLimit)
    .map((block) => ({ text: block.innerText.trim().replace(/\s+/gu, ' '), block }))
    .filter(({ text }) => text.length <= CLAIM_MAX_LENGTH);
}

function place(claim: Claim) {
  if (!claim.block || claim.card) return;
  claim.card = createCardHost();
  claim.card.dataset.claim = claim.text;
  // List items and table cells keep the card inside them so the markup stays valid.
  if (claim.block.matches('li, td, dd, dt')) claim.block.append(claim.card);
  else claim.block.after(claim.card);
}

function start(article: NewsArticle) {
  const claims: Claim[] = article.claims.length ? article.claims.map((text) => ({ text })) : autoClaims();
  const queue: Claim[] = [];
  let running = 0;

  async function check(claim: Claim) {
    running++;
    renderCard(claim.card!, { state: 'checking' });
    const started = performance.now();
    let result;
    try {
      result = await requestInExtension(claim.text);
    } catch {
      // The extension or local API may have restarted.
    }
    const elapsedMs = performance.now() - started;
    renderCard(claim.card!, {
      state: result ? 'checked' : 'failed',
      result,
      elapsedMs,
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
      if (claim.card) continue;
      claim.block ??= locate(claim.text);
      if (!claim.block) continue;
      place(claim);
      renderCard(claim.card!, { state: 'checking' });
      queue.push(claim);
    }
    drain();
    return claims.every(({ card }) => card);
  }

  if (attach()) return;
  // Article pages often render their body after load; keep looking for a while.
  const observer = new MutationObserver(() => {
    if (attach()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), locateTimeoutMs);
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
