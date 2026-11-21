// Background side of the call overlay: relays its calls to the local API (content scripts cannot reach it)
// and validates every message before it leaves the extension.
import {
  CAPTURE_METHODS, CLAIM_MAX_LENGTH, CLIENT_ID_PATTERN, PLATFORM_PATTERN, SPEAKER_KINDS, SPEAKER_MAX,
  UTTERANCE_BATCH_MAX, UTTERANCE_TEXT_MAX,
} from '@growth-factcheking/shared';
import { pauseAudio, resumeAudio, startAudio, stopAudio } from './audio-capture.js';
import { createHttpTransport } from './call/http-transport.js';
import { CallTransportError } from './call/types.js';
import type { CallReply, CallRequest } from './messages.js';

export const api = createHttpTransport('http://127.0.0.1:3000');

const isId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/u.test(value);
const clientId = new RegExp(CLIENT_ID_PATTERN, 'u');
const platform = new RegExp(PLATFORM_PATTERN, 'u');
const optionalText = (value: unknown, max: number) => value === undefined || (typeof value === 'string' && value.length <= max);

function isUtterance(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const u = value as Record<string, unknown>;
  return typeof u.clientId === 'string' && clientId.test(u.clientId)
    && typeof u.speaker === 'string' && u.speaker.length > 0 && u.speaker.length <= SPEAKER_MAX
    && SPEAKER_KINDS.some((kind) => kind === u.speakerKind)
    && typeof u.text === 'string' && u.text.length > 0 && u.text.length <= UTTERANCE_TEXT_MAX
    && typeof u.spokenAt === 'string' && !Number.isNaN(Date.parse(u.spokenAt));
}

/**
 * The page URL sent with a conversation must belong to the site the message came from. Only the origin is
 * compared: single-page apps (YouTube, Meet, Teams) change the path without a page load, and the sender URL
 * Chrome reports can lag behind it.
 */
function sameSite(pageUrl: unknown, senderUrl: string | undefined) {
  if (pageUrl === undefined) return true;
  if (typeof pageUrl !== 'string' || !senderUrl || !URL.canParse(pageUrl) || !URL.canParse(senderUrl)) return false;
  return new URL(pageUrl).origin === new URL(senderUrl).origin;
}

/** A message meant for the call overlay relay, valid or not. */
export function looksLikeCallRequest(message: unknown): boolean {
  return typeof message === 'object' && message !== null && 'kind' in message && typeof message.kind === 'string'
    && /^(call|audio)-/u.test(message.kind);
}

export function isCallRequest(message: unknown, senderUrl: string | undefined): message is CallRequest {
  if (typeof message !== 'object' || message === null || !('kind' in message)) return false;
  const m = message as Record<string, unknown>;
  switch (m.kind) {
    case 'call-start':
      return typeof m.platform === 'string' && platform.test(m.platform)
        && CAPTURE_METHODS.some((method) => method === m.capture)
        && optionalText(m.title, 300) && optionalText(m.pageUrl, 2048) && sameSite(m.pageUrl, senderUrl);
    case 'call-send':
      return isId(m.id) && Array.isArray(m.utterances) && m.utterances.length > 0
        && m.utterances.length <= UTTERANCE_BATCH_MAX && m.utterances.every(isUtterance);
    case 'call-end':
    case 'call-remove':
    case 'call-claims':
      return isId(m.id);
    case 'call-recheck':
      return typeof m.claim === 'string' && m.claim.trim().length > 0 && m.claim.length <= CLAIM_MAX_LENGTH;
    case 'call-badge':
      return typeof m.count === 'number' && Number.isInteger(m.count) && m.count >= 0;
    case 'audio-start':
      return m.language === undefined || (typeof m.language === 'string' && /^[a-z]{2}$/u.test(m.language));
    case 'audio-pause':
    case 'audio-resume':
    case 'audio-stop':
      return true;
    default:
      return false;
  }
}

async function run(request: CallRequest, tabId: number): Promise<unknown> {
  switch (request.kind) {
    case 'call-start': return api.start(request);
    case 'call-send': return api.send(request.id, request.utterances);
    case 'call-end': return api.end(request.id);
    case 'call-remove': return api.remove(request.id);
    case 'call-recheck': return api.recheck(request.claim);
    case 'call-claims': return api.claims(request.id);
    case 'call-badge':
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#D6453D' });
      await chrome.action.setBadgeText({ tabId, text: request.count ? String(request.count) : '' });
      return null;
    case 'audio-start': return startAudio(tabId, request.language);
    case 'audio-pause': return pauseAudio(tabId);
    case 'audio-resume': return resumeAudio(tabId);
    case 'audio-stop': return stopAudio(tabId);
  }
}

export async function relayCallRequest(request: CallRequest, tabId: number): Promise<CallReply> {
  try {
    return { ok: true, result: (await run(request, tabId)) ?? null };
  } catch (error) {
    if (error instanceof CallTransportError) return { ok: false, message: error.message, code: error.code };
    console.warn('A FactCheck overlay request failed.', error);
    const message = error instanceof Error && error.message ? error.message : 'Could not complete the request.';
    return { ok: false, message, code: 'unavailable' };
  }
}
