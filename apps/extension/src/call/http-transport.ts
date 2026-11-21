// Calls the local conversation API (docs/specs/conversation-capture.md) from the background worker.
import { CONVERSATIONS_PATH, FACT_CHECK_PATH, TRANSCRIPTION_TOKEN_PATH, VERDICTS } from '@growth-factcheking/shared';
import type {
  ClaimCheck, FactCheckResult, TranscriptionTokenResult, UtteranceBatchResult, UtteranceInput,
} from '@growth-factcheking/shared';
import { CallTransportError } from './types.js';
import type { CallTransport } from './types.js';

const UNAVAILABLE = 'La verificación en vivo no está disponible. Comprueba que la API local tenga OpenAI y PostgreSQL configurados.';
const OFFLINE = 'No se pudo contactar con la API local. Comprueba que esté en marcha con npm start.';

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

function isClaimCheck(value: unknown): value is ClaimCheck {
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

async function call(url: URL, method: 'POST' | 'DELETE', body: object | undefined, timeoutMs: number): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new CallTransportError(OFFLINE);
  }
  if (response.ok) return response;
  if (response.status === 404) throw new CallTransportError('La conversación ya no existe en la API local.', 'missing');
  if (response.status === 409) throw new CallTransportError('La conversación ya estaba terminada.', 'ended');
  if (response.status === 503) throw new CallTransportError(UNAVAILABLE);
  throw new CallTransportError(`La API local respondió con un error (${response.status}).`);
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new CallTransportError('La API local devolvió una respuesta ilegible.');
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
        throw new CallTransportError('La API local no devolvió un identificador de conversación.');
      }
      return { id: data.id };
    },
    async send(id: string, utterances: UtteranceInput[]) {
      // Extraction plus several live fact-checks can take a while.
      const data = await json(await call(conversation(id, '/utterances'), 'POST', { utterances }, 45_000));
      if (!isBatchResult(data)) throw new CallTransportError('La API local devolvió afirmaciones inválidas.');
      return data;
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
        throw new CallTransportError('La API local devolvió un resultado inválido.');
      }
      return data;
    },
    async transcriptionToken(language) {
      const body = language ? { language } : {};
      const data = await json(await call(new URL(TRANSCRIPTION_TOKEN_PATH, origin), 'POST', body, 10_000));
      if (typeof data !== 'object' || data === null || !('value' in data) || typeof data.value !== 'string') {
        throw new CallTransportError('La API local no devolvió un permiso de transcripción.');
      }
      return data as TranscriptionTokenResult;
    },
  };
}
