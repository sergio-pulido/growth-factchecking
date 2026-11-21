// Calls the local conversation API (docs/specs/conversation-capture.md) from the background worker.
import { CONVERSATIONS_PATH, FACT_CHECK_PATH, TRANSCRIPTION_TOKEN_PATH, VERDICTS } from '@growth-factcheking/shared';
import type {
  ClaimCheck, FactCheckResult, TranscriptionTokenResult, UtteranceBatchResult, UtteranceInput,
} from '@growth-factcheking/shared';
import { CallTransportError } from './types.js';
import type { CallTransport } from './types.js';

const UNAVAILABLE = 'Live checking is unavailable. Check that the local API has OpenAI and PostgreSQL configured.';
const OFFLINE = 'Could not reach the local API. Check that it is running (npm start).';

function isSource(value: unknown): value is FactCheckResult['sources'][number] {
  return typeof value === 'object' && value !== null
    && 'statement' in value && typeof value.statement === 'string'
    && 'sourceUrl' in value && typeof value.sourceUrl === 'string'
    && /^https?:\/\//iu.test(value.sourceUrl) && URL.canParse(value.sourceUrl);
}

const isVerdict = (value: unknown) => VERDICTS.some((verdict) => verdict === value);

export function isFactCheckResult(value: unknown): value is FactCheckResult {
  return typeof value === 'object' && value !== null
    && 'verdict' in value && isVerdict(value.verdict)
    && 'sources' in value && Array.isArray(value.sources) && value.sources.every(isSource);
}

export function isClaimCheck(value: unknown): value is ClaimCheck {
  return typeof value === 'object' && value !== null
    && 'id' in value && typeof value.id === 'string'
    && 'claim' in value && typeof value.claim === 'string'
    && 'speaker' in value && typeof value.speaker === 'string'
    && 'utteranceClientId' in value && typeof value.utteranceClientId === 'string'
    && 'status' in value && (value.status === 'checked' || value.status === 'failed')
    && 'verdict' in value && (value.verdict === null || isVerdict(value.verdict))
    && 'sources' in value && Array.isArray(value.sources) && value.sources.every(isSource);
}

export function isBatchResult(value: unknown): value is UtteranceBatchResult {
  return typeof value === 'object' && value !== null
    && 'extraction' in value && (value.extraction === 'ok' || value.extraction === 'skipped' || value.extraction === 'failed')
    && 'claims' in value && Array.isArray(value.claims) && value.claims.every(isClaimCheck);
}

async function call(url: URL, method: 'GET' | 'POST' | 'DELETE', body: object | undefined, timeoutMs: number): Promise<Response> {
  let response: Response;
  try {
    const payload: RequestInit = body
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {};
    response = await fetch(url, { method, ...payload, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new CallTransportError(OFFLINE);
  }
  if (response.ok) return response;
  if (response.status === 404) throw new CallTransportError('The conversation no longer exists in the local API.', 'missing');
  if (response.status === 409) throw new CallTransportError('The conversation had already ended.', 'ended');
  if (response.status === 503) throw new CallTransportError(UNAVAILABLE);
  throw new CallTransportError(`The local API returned an error (${response.status}).`);
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new CallTransportError('The local API returned an unreadable response.');
  }
}

export type HttpTransport = Omit<CallTransport, 'badge'> & {
  transcriptionToken(language?: string): Promise<TranscriptionTokenResult>;
};

export function createHttpTransport(origin: string): HttpTransport {
  const conversation = (id: string, suffix = '') => new URL(`${CONVERSATIONS_PATH}/${encodeURIComponent(id)}${suffix}`, origin);
  return {
    async start({ platform, capture, title, pageUrl }) {
      const body = {
        platform,
        capture,
        ...(title ? { title: title.slice(0, 300) } : {}),
        ...(pageUrl ? { pageUrl } : {}),
      };
      const data = await json(await call(new URL(CONVERSATIONS_PATH, origin), 'POST', body, 10_000));
      if (typeof data !== 'object' || data === null || !('id' in data) || typeof data.id !== 'string') {
        throw new CallTransportError('The local API did not return a conversation id.');
      }
      return { id: data.id };
    },
    async send(id: string, utterances: UtteranceInput[]) {
      // Extraction plus several live fact-checks can take a while.
      const data = await json(await call(conversation(id, '/utterances'), 'POST', { utterances }, 45_000));
      if (!isBatchResult(data)) throw new CallTransportError('The local API returned invalid claims.');
      return data;
    },
    async claims(id: string) {
      const data = await json(await call(conversation(id), 'GET', undefined, 10_000));
      const claims = typeof data === 'object' && data !== null && 'claims' in data ? data.claims : undefined;
      if (!Array.isArray(claims) || !claims.every(isClaimCheck)) {
        throw new CallTransportError('The local API returned invalid claims.');
      }
      return claims;
    },
    async end(id: string) {
      await call(conversation(id, '/end'), 'POST', undefined, 5000);
    },
    async remove(id: string) {
      await call(conversation(id), 'DELETE', undefined, 5000);
    },
    async recheck(claim: string) {
      const response = await call(new URL(`${FACT_CHECK_PATH}/live`, origin), 'POST', { claim }, 15_000);
      const data = await json(response);
      if (response.headers.get('X-Fact-Check-Mode') !== 'live' || !isFactCheckResult(data)) {
        throw new CallTransportError('The local API returned an invalid result.');
      }
      return data;
    },
    async transcriptionToken(language) {
      const body = language ? { language } : {};
      const data = await json(await call(new URL(TRANSCRIPTION_TOKEN_PATH, origin), 'POST', body, 10_000));
      if (typeof data !== 'object' || data === null || !('value' in data) || typeof data.value !== 'string') {
        throw new CallTransportError('The local API did not return a transcription token.');
      }
      return data as TranscriptionTokenResult;
    },
  };
}
