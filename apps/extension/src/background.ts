import { CLAIM_MAX_LENGTH, DEMO_SCENARIOS, FACT_CHECK_PATH, VERDICTS } from '@growth-factcheking/shared';
import type { FactCheckResult } from '@growth-factcheking/shared';
import type { DemoRequest, DemoResponse } from './messages.js';

chrome.action.onClicked.addListener(async ({ id }) => {
  if (id === undefined) return;

  try {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['overlay.js'] });
    await chrome.action.setBadgeText({ tabId: id, text: '' });
  } catch (error) {
    console.warn('No se pudo abrir FactChecking en esta pestaña.', error);
    await chrome.action.setBadgeText({ tabId: id, text: '×' });
  }
});

function isDemoRequest(message: unknown): message is DemoRequest {
  return typeof message === 'object' && message !== null
    && 'claim' in message && typeof message.claim === 'string'
    && message.claim.trim().length > 0 && message.claim.length <= CLAIM_MAX_LENGTH
    && 'scenario' in message && DEMO_SCENARIOS.some((scenario) => scenario === message.scenario);
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

async function checkDemo({ claim, scenario }: DemoRequest): Promise<DemoResponse> {
  const url = new URL(FACT_CHECK_PATH, 'http://127.0.0.1:3000');
  url.searchParams.set('scenario', scenario);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claim }),
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    return {
      ok: false,
      message: response.status === 503 && response.headers.get('X-Fact-Check-Mode') === 'mock'
        ? 'Error simulado. Elige otro escenario o vuelve a intentarlo.'
        : 'La API local devolvió un error.',
    };
  }

  const data: unknown = await response.json();
  if (!isFactCheckResult(data)) {
    return { ok: false, message: 'La API local devolvió un resultado inválido.' };
  }
  return { ok: true, result: data };
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.tab || !isDemoRequest(message)) return;

  void checkDemo(message).then(respond, (error: unknown) => {
    console.warn('Falló la solicitud de demostración.', error);
    respond({ ok: false, message: 'No se pudo completar la solicitud. Comprueba que la API local esté en marcha.' } satisfies DemoResponse);
  });
  return true;
});
