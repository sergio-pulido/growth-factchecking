import { CLAIM_MAX_LENGTH } from '@growth-factcheking/shared';
import type { FactCheckResult } from '@growth-factcheking/shared';
import { createCardHost, renderCard, requestInExtension, setFaviconLoader, tones } from './card.js';
import type { Tone } from './card.js';
import scannerStyles from './inline-scanner.css';

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
  scanner?: HTMLElement;
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
  favicon,
}: FeedOptions = {}) {
  if (!available() || window.growthFactCheckingFeed) return;
  if (favicon) setFaviconLoader(favicon);
  const posts = new Map<HTMLElement, Post>();
  const waiting = new Set<HTMLElement>();
  const running = new Set<string>();
  let frame = 0;
  let stopped = false;
  const scannerSheet = new CSSStyleSheet();
  scannerSheet.replaceSync(scannerStyles);
  const highlights = typeof Highlight === 'function' && 'highlights' in CSS
    ? { ok: new Highlight(), warn: new Highlight(), bad: new Highlight() }
    : undefined;
  const highlightSheet = new CSSStyleSheet();
  highlightSheet.replaceSync(highlightStyles);
  if (highlights) {
    for (const [tone, highlight] of Object.entries(highlights)) CSS.highlights.set(`growth-factchecking-${tone}`, highlight);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, highlightSheet];
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

  function clearHighlight(post: Post) {
    if (post.highlight && highlights && post.highlight.tone !== 'none') highlights[post.highlight.tone].delete(post.highlight.range);
    post.highlight = undefined;
  }

  /** Highlights the sentence the evidence matches, in the original language of the source. */
  function highlightClaim(post: Post, result: FactCheckResult) {
    clearHighlight(post);
    if (!highlights || !result.sources.length) return;
    const { tone } = tones[result.verdict];
    const range = findCheckedRange(post.text, result.sources[0].statement);
    if (!range || tone === 'none') return;
    highlights[tone].add(range);
    post.highlight = { range, tone };
  }

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
    post.result = result;
    render(post, result);
    if (result) highlightClaim(post, result);
    else clearHighlight(post);
  }

  async function check(article: HTMLElement, post: Post) {
    const { claim } = post;
    running.add(claim);
    post.state = 'checking';
    clearHighlight(post);
    render(post);
    showScanner(article, post);
    let result: FactCheckResult | undefined;
    const started = performance.now();
    try {
      result = await request(claim);
    } catch {
      // The extension or local API may have restarted.
    } finally {
      running.delete(claim);
      post.elapsedMs = performance.now() - started;
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
    if (highlights) {
      for (const tone of Object.keys(highlights)) CSS.highlights.delete(`growth-factchecking-${tone}`);
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== highlightSheet);
    }
    window.growthFactCheckingFeed = undefined;
  };
  scan();
}
