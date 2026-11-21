import { CLAIM_MAX_LENGTH } from '@growth-factcheking/shared';
import type { FactCheckResult } from '@growth-factcheking/shared';
import type { FactCheckMessage, FactCheckResponse } from './messages.js';
import { verdictLabels } from './verdict-labels.js';
import styles from './inline-feed.css';

const articleSelector = 'article[data-testid="tweet"]';
const textSelector = '[data-testid="tweetText"]';
const concurrentChecks = 2;
const cacheLimit = 200;

type Post = {
  text: HTMLElement;
  claim: string;
  visible: boolean;
  state: 'idle' | 'checking' | 'checked' | 'failed';
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

function readPost(article: HTMLElement) {
  const text = Array.from(article.querySelectorAll<HTMLElement>(textSelector)).find((candidate) =>
    candidate.closest(articleSelector) === article && !candidate.closest('[role="link"]'),
  );
  if (!text || article.querySelector('[data-testid="tweet-text-show-more-link"]:not([role="link"] *)')) return;
  const claim = text.innerText.trim().replace(/\s+/gu, ' ');
  if (!claim || claim.length > CLAIM_MAX_LENGTH || !/\p{L}/u.test(claim)) return;
  return { text, claim };
}

async function requestInExtension(claim: string) {
  const response = await chrome.runtime.sendMessage<FactCheckMessage, FactCheckResponse>({ mode: 'live', claim });
  if (response.ok && response.result.mode === 'live') return response.result.check;
}

type FeedOptions = {
  available?: () => boolean;
  request?: (claim: string) => Promise<FactCheckResult | undefined>;
};

export function startInlineFeed({ available = isXHome, request = requestInExtension }: FeedOptions = {}) {
  if (!available() || window.growthFactCheckingFeed) return;
  const posts = new Map<HTMLElement, Post>();
  const waiting = new Set<HTMLElement>();
  const running = new Set<string>();
  const cache = new Map<string, FactCheckResult>();
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(styles);
  let frame = 0;
  let stopped = false;

  function render(post: Post, result?: FactCheckResult) {
    const host = post.card ?? document.createElement('div');
    if (!post.card) {
      post.card = host;
      host.dataset.growthFactchecking = '';
      host.attachShadow({ mode: 'open' }).adoptedStyleSheets = [sheet];
      host.addEventListener('click', (event) => event.stopPropagation());
      post.text.after(host);
    }

    const row = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = 'FactChecking';
    const label = document.createElement('span');
    if (result) {
      const hasSources = result.sources.length > 0;
      label.textContent = hasSources ? verdictLabels[result.verdict] : 'Información insuficiente';
      label.dataset.verdict = hasSources ? result.verdict : 'neutral';
    } else {
      label.textContent = post.state === 'failed' ? 'No se pudo verificar' : 'Comprobando…';
    }
    row.append(title, label);

    if (result?.sources.length) {
      const source = result.sources[0];
      const link = document.createElement('a');
      link.href = source.sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = new URL(source.sourceUrl).hostname;
      link.title = source.statement;
      row.append(link);
    }
    if (post.state === 'failed') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Reintentar';
      retry.addEventListener('click', () => {
        post.state = 'idle';
        for (const [article, entry] of posts) {
          if (entry === post && entry.visible) waiting.add(article);
        }
        drain();
      });
      row.append(retry);
    }
    host.shadowRoot?.replaceChildren(row);
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
    }
    if (!stopped && available() && article.isConnected && posts.get(article) === post && readPost(article)?.claim === claim) {
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
      const current = readPost(article);
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
      const current = article.isConnected ? readPost(article) : undefined;
      if (!current || current.text !== post.text || current.claim !== post.claim
        || (post.card && post.card.previousElementSibling !== post.text)) {
        forget(article, post);
      }
    }
    for (const article of Array.from(document.querySelectorAll<HTMLElement>(articleSelector))) {
      if (posts.has(article)) continue;
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
    window.growthFactCheckingFeed = undefined;
  };
  scan();
}
