import { CLAIM_MAX_LENGTH, DEMO_SCENARIOS, FACT_CHECK_PATH, MEET_DEMO_PATH, MEET_JUDGES, MEET_TRANSCRIPT, VERDICTS } from '@growth-factcheking/shared';
import type { FactCheckResult, MeetCheckResult } from '@growth-factcheking/shared';
import type { FactCheckMessage, FactCheckResponse, MeetDemoRequest, MeetDemoResponse } from './messages.js';
import { registerConversationBridge, showMeetPanel } from './meet/conversation-bridge.js';

registerConversationBridge();

chrome.action.onClicked.addListener(async ({ id, url }) => {
  if (id === undefined) return;

  try {
    if (url?.startsWith('https://meet.google.com/')) {
      await showMeetPanel(id);
      return;
    }
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['overlay.js'] });
    await chrome.action.setBadgeText({ tabId: id, text: '' });
  } catch (error) {
    console.warn('No se pudo abrir FactChecking en esta pestaña.', error);
    await chrome.action.setBadgeText({ tabId: id, text: '×' });
  }
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

function isMeetDemoRequest(message: unknown): message is MeetDemoRequest {
  return typeof message === 'object' && message !== null
    && 'kind' in message && message.kind === 'meet-check'
    && 'turnId' in message && MEET_TRANSCRIPT.some(({ id }) => id === message.turnId)
    && 'mode' in message && MEET_JUDGES.some((mode) => mode === message.mode);
}

function isFactCheckResult(value: unknown): value is FactCheckResult {
  return typeof value === 'object' && value !== null
    && 'verdict' in value && VERDICTS.some((verdict) => verdict === value.verdict)
    && 'sources' in value && Array.isArray(value.sources)
    && value.sources.every((source: unknown) =>
      typeof source === 'object' && source !== null
      && 'statement' in source && typeof source.statement === 'string'
      && 'sourceUrl' in source && typeof source.sourceUrl === 'string'
      && /^https?:\/\//i.test(source.sourceUrl) && URL.canParse(source.sourceUrl),
    );
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

async function checkMeetDemo({ turnId, mode }: MeetDemoRequest): Promise<MeetDemoResponse> {
  const response = await postJson(new URL(MEET_DEMO_PATH, apiOrigin), { turnId, mode }, 10_000);
  if (response.status === 404) {
    return { ok: false, message: 'Reinicia la API local con npm start para cargar la demo de Meet.' };
  }
  const data: unknown = await response.json();
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'message' in data
      && typeof data.message === 'string' ? data.message : 'Falló la comprobación de este turno.';
    return { ok: false, message };
  }
  if (!isMeetCheckResult(data)) {
    return { ok: false, message: 'La API local devolvió un turno inválido.' };
  }
  return { ok: true, result: data };
}

function isMeetCheckResult(value: unknown): value is MeetCheckResult {
  return typeof value === 'object' && value !== null && 'checks' in value
    && Array.isArray(value.checks) && value.checks.every((check: unknown) =>
      isFactCheckResult(check) && 'claim' in check && typeof check.claim === 'string',
    );
}

async function checkClaim(request: FactCheckMessage): Promise<FactCheckResponse> {
  const url = new URL(request.mode === 'live' ? `${FACT_CHECK_PATH}/live` : FACT_CHECK_PATH, apiOrigin);
  if (request.mode === 'mock') url.searchParams.set('scenario', request.scenario);

  const response = await postJson(url, { claim: request.claim }, request.mode === 'live' ? 10_000 : 5000);
  const mode = response.headers.get('X-Fact-Check-Mode');

  if (!response.ok) {
    if (response.status === 503 && mode === 'mock') {
      return { ok: false, message: 'Error simulado. Elige otro escenario o vuelve a intentarlo.' };
    }
    if (response.status === 503 && request.mode === 'live') {
      return { ok: false, message: 'La verificación real no está disponible. Comprueba la conexión de la API local con OpenAI y PostgreSQL.' };
    }
    if (response.status === 404 && request.mode === 'live') {
      return { ok: false, message: 'Reinicia la API local con npm start para cargar la verificación real.' };
    }
    return { ok: false, message: 'La API local devolvió un error.' };
  }

  if (mode !== request.mode) {
    return { ok: false, message: 'La API local respondió en un modo distinto del seleccionado.' };
  }
  const data: unknown = await response.json();
  if (!isFactCheckResult(data)) {
    return { ok: false, message: 'La API local devolvió un resultado inválido.' };
  }
  return { ok: true, result: { check: data, mode } };
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.tab) return;

  let request: Promise<FactCheckResponse | MeetDemoResponse>;
  if (isMeetDemoRequest(message)) {
    request = checkMeetDemo(message);
  } else if (isFactCheckMessage(message)) {
    request = checkClaim(message);
  } else {
    return;
  }

  void request.then(respond, (error: unknown) => {
    console.warn('Falló la solicitud a la API local.', error);
    respond({ ok: false, message: 'No se pudo completar la solicitud. Comprueba que la API local esté en marcha.' } satisfies FactCheckResponse);
  });
  return true;
});
