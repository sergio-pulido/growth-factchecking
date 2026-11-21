import { CLAIM_MAX_LENGTH, DEMO_SCENARIOS, FACT_CHECK_PATH } from '@growth-factcheking/shared';
import { isFactCheckResult } from './call/http-transport.js';
import { handleOffscreenEvent, isOffscreenEvent, releaseTab } from './audio-capture.js';
import { isCallRequest, relayCallRequest } from './call-relay.js';
import type { DemoPostsResponse, FactCheckMessage, FactCheckResponse, TabEvent } from './messages.js';

// The toolbar icon opens the FactCheck call overlay on the current tab: captions mode on Meet, Zoom web and
// Teams web, tab-audio mode anywhere else. Clicking it also grants the tab capture permission audio mode needs.
chrome.action.onClicked.addListener(async ({ id }) => {
  if (id === undefined) return;
  const toggle: TabEvent = { kind: 'call-toggle' };
  try {
    await chrome.tabs.sendMessage(id, toggle);
    return;
  } catch {
    // No overlay in this tab yet.
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['call-content.js'] });
    await chrome.tabs.sendMessage(id, toggle);
    await chrome.action.setBadgeText({ tabId: id, text: '' });
  } catch (error) {
    console.warn('Could not open FactCheck on this tab.', error);
    await chrome.action.setBadgeText({ tabId: id, text: '×' });
  }
});

chrome.tabs.onRemoved.addListener(releaseTab);
// A page load in the captured tab (navigation or reload, which carries no url change) ends the overlay:
// stop listening to it too. In-page navigation does not fire 'loading'.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') releaseTab(tabId);
});

function isFactCheckMessage(message: unknown): message is FactCheckMessage {
  if (typeof message !== 'object' || message === null || !('mode' in message)
    || !('claim' in message) || typeof message.claim !== 'string'
    || !message.claim.trim() || message.claim.length > CLAIM_MAX_LENGTH) {
    return false;
  }
  return message.mode === 'live' || (message.mode === 'mock'
    && 'scenario' in message && DEMO_SCENARIOS.some((scenario) => scenario === message.scenario));
}

const apiOrigin = 'http://127.0.0.1:3000';

function postJson(url: URL, body: object, timeoutMs: number) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function checkClaim(request: FactCheckMessage): Promise<FactCheckResponse> {
  const url = new URL(request.mode === 'live' ? `${FACT_CHECK_PATH}/live` : FACT_CHECK_PATH, apiOrigin);
  if (request.mode === 'mock') url.searchParams.set('scenario', request.scenario);

  const response = await postJson(url, { claim: request.claim }, request.mode === 'live' ? 10_000 : 5000);
  const mode = response.headers.get('X-Fact-Check-Mode');

  if (!response.ok) {
    if (response.status === 503 && mode === 'mock') {
      return { ok: false, message: 'Simulated error. Pick another scenario or try again.' };
    }
    if (response.status === 503 && request.mode === 'live') {
      return { ok: false, message: 'Live checking is not available. Check the local API connection to OpenAI and PostgreSQL.' };
    }
    if (response.status === 404 && request.mode === 'live') {
      return { ok: false, message: 'Restart the local API with npm start to load live checking.' };
    }
    return { ok: false, message: 'The local API returned an error.' };
  }

  if (mode !== request.mode) {
    return { ok: false, message: 'The local API answered in a different mode than the one selected.' };
  }
  const data: unknown = await response.json();
  if (!isFactCheckResult(data)) {
    return { ok: false, message: 'The local API returned an invalid result.' };
  }
  return { ok: true, result: { check: data, mode } };
}

async function getDemoPosts(): Promise<DemoPostsResponse> {
  try {
    const response = await fetch(new URL('/api/x-demo/posts', apiOrigin), { signal: AbortSignal.timeout(3000), redirect: 'error' });
    if (response.ok) {
      const result = await response.json() as Partial<DemoPostsResponse>;
      if (Array.isArray(result.postIds)) return { postIds: result.postIds.filter((value) => typeof value === 'string' && /^\d+$/.test(value)) };
    }
  } catch (error) {
    console.warn('Could not load the X demo collection.', error);
  }
  return { postIds: [] };
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (isOffscreenEvent(message, sender)) return handleOffscreenEvent(message, respond);
  if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined) return;
  const tabId = sender.tab.id;
  if (sender.url?.startsWith('https://x.com/') && typeof message === 'object' && message !== null
    && 'kind' in message && message.kind === 'x-demo-posts') {
    void getDemoPosts().then(respond);
    return true;
  }

  if (isCallRequest(message, sender.url)) {
    void relayCallRequest(message, tabId).then(respond);
    return true;
  }
  if (!isFactCheckMessage(message)) return;

  checkClaim(message).then(respond, (error: unknown) => {
    console.warn('Request to the local API failed.', error);
    respond({ ok: false, message: 'Could not complete the request. Check that the local API is running (npm start).' } satisfies FactCheckResponse);
  });
  return true;
});
