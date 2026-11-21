// Inline fact-check card shared by the X feed and news articles. Styles: inline-feed.css.
import type { FactCheckResult } from '@growth-factcheking/shared';
import type { FactCheckMessage, FactCheckResponse } from './messages.js';
import styles from './inline-feed.css';

const verdictLabels: Record<FactCheckResult['verdict'], string> = {
  yes: 'Supported',
  probably_yes: 'Likely supported',
  neutral: 'Inconclusive',
  probably_no: 'Likely contradicted',
  no: 'Contradicted',
};

export type CardState = 'checking' | 'checked' | 'failed';

export type CardView = {
  state: CardState;
  result?: FactCheckResult;
  /** Round trip of the check, shown on the card. */
  elapsedMs?: number;
  onRetry?: () => void;
};

let sheet: CSSStyleSheet | undefined;

function englishStatement(source: FactCheckResult['sources'][number]) {
  return source.statementEn ?? source.statement;
}

/** Short link text: the site without "www.", marked when it is a PDF and numbered when a card repeats it. */
function sourceLabel(sourceUrl: string, seen: Map<string, number>) {
  const url = new URL(sourceUrl);
  const label = url.hostname.replace(/^www\./u, '') + (/\.pdf$/iu.test(url.pathname) ? ' (PDF)' : '');
  const count = (seen.get(label) ?? 0) + 1;
  seen.set(label, count);
  return count === 1 ? label : `${label} (${count})`;
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

export function renderCard(host: HTMLElement, { state, result, elapsedMs, onRetry }: CardView) {
  const card = document.createElement('section');
  const row = document.createElement('div');
  row.className = 'summary';
  const title = document.createElement('strong');
  title.textContent = 'FactChecking';
  const label = document.createElement('span');
  if (result) {
    const hasSources = result.sources.length > 0;
    label.textContent = hasSources ? verdictLabels[result.verdict] : 'Insufficient information';
    label.dataset.verdict = hasSources ? result.verdict : 'neutral';
  } else {
    label.textContent = state === 'failed' ? 'Could not check' : 'Checking…';
  }
  row.append(title, label);
  if (result && elapsedMs !== undefined) {
    const timing = document.createElement('span');
    timing.className = 'timing';
    timing.textContent = `${(elapsedMs / 1000).toFixed(1)} s`;
    timing.title = 'Time to check this claim against the sources';
    row.append(timing);
  }
  card.append(row);

  if (result?.sources.length) {
    const evidence = document.createElement('p');
    evidence.className = 'evidence';
    evidence.textContent = englishStatement(result.sources[0]);
    card.append(evidence);
  }
  const sources = document.createElement('div');
  sources.className = 'sources';
  sources.setAttribute('aria-label', 'Sources');
  const labels = new Map<string, number>();
  for (const source of result?.sources ?? []) {
    const link = document.createElement('a');
    link.href = source.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = sourceLabel(source.sourceUrl, labels);
    link.title = englishStatement(source);
    sources.append(link);
  }
  if (sources.childElementCount) card.append(sources);

  if (state === 'failed' && onRetry) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.addEventListener('click', onRetry);
    row.append(retry);
  }
  host.shadowRoot?.replaceChildren(card);
}

/** Live check through the extension's background worker, which calls the local API. */
export async function requestInExtension(claim: string) {
  const response = await chrome.runtime.sendMessage<FactCheckMessage, FactCheckResponse>({ mode: 'live', claim });
  if (response.ok && response.result.mode === 'live') return response.result.check;
}
