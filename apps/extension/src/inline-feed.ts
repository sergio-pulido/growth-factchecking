import { CLAIM_MAX_LENGTH } from '@growth-factcheking/shared';
import type { FactCheckResult } from '@growth-factcheking/shared';
import { createCardHost, renderCard, requestInExtension } from './card.js';

const articleSelector = 'article[data-testid="tweet"]';
const textSelector = '[data-testid="tweetText"]';
const concurrentChecks = 2;

type Post = {
  text: HTMLElement;
  claim: string;
  visible: boolean;
  state: 'idle' | 'checking' | 'checked' | 'failed';
  /** Round trip of the last check, shown on the card. */
  elapsedMs?: number;
  card?: HTMLElement;
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

type FeedOptions = {
  available?: () => boolean;
  accepts?: (article: HTMLElement) => boolean;
  request?: (claim: string) => Promise<FactCheckResult | undefined>;
};

export function startInlineFeed({
  available = isXFactCheckPage,
  accepts = () => true,
  request = requestInExtension,
}: FeedOptions = {}) {
  if (!available() || window.growthFactCheckingFeed) return;
  const posts = new Map<HTMLElement, Post>();
  const waiting = new Set<HTMLElement>();
  const running = new Set<string>();
  let frame = 0;
  let stopped = false;

  function render(post: Post, result?: FactCheckResult) {
    if (!post.card) {
      post.card = createCardHost();
      post.text.after(post.card);
    }
    renderCard(post.card, {
      state: post.state === 'idle' ? 'checking' : post.state,
      result,
      elapsedMs: post.elapsedMs,
      onRetry: () => {
        post.state = 'idle';
        for (const [article, entry] of posts) {
          if (entry === post && entry.visible) waiting.add(article);
        }
        drain();
      },
    });
  }

  function complete(post: Post, result?: FactCheckResult) {
    post.state = result ? 'checked' : 'failed';
    render(post, result);
  }

  async function check(article: HTMLElement, post: Post) {
    const { claim } = post;
    running.add(claim);
    post.state = 'checking';
    render(post);
    let result: FactCheckResult | undefined;
    const started = performance.now();
    try {
      result = await request(claim);
    } catch {
      // The extension or local API may have restarted.
    } finally {
      running.delete(claim);
      post.elapsedMs = performance.now() - started;
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
      // No result cache: each post that comes into view is checked again, so the demo shows live latency.
      if (running.size < concurrentChecks && !running.has(post.claim)) {
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
    window.growthFactCheckingFeed = undefined;
  };
  scan();
}
