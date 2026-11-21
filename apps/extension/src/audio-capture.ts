// Tab audio capture, background side. One tab at a time: Chrome gives the extension a stream id for the tab
// the user invoked it on, and an offscreen document turns it into audio sent to OpenAI live transcription.
import { createHttpTransport } from './call/http-transport.js';
import { CallTransportError } from './call/types.js';
import type { OffscreenCommand, OffscreenEvent, TabEvent } from './messages.js';

const api = createHttpTransport('http://127.0.0.1:3000');
const OFFSCREEN_URL = 'offscreen.html';

const CAPTURED_KEY = 'capturedTab';
type Captured = { tabId: number; language?: string };

// In memory for speed and ordering; in session storage because the service worker can be suspended mid-call.
let cache: Captured | null | undefined;

async function captured(): Promise<Captured | null> {
  if (cache === undefined) {
    const stored = (await chrome.storage.session.get(CAPTURED_KEY))[CAPTURED_KEY] as Captured | undefined;
    cache = typeof stored?.tabId === 'number' ? stored : null;
  }
  return cache;
}

async function setCaptured(value: Captured | null) {
  cache = value;
  if (value === null) await chrome.storage.session.remove(CAPTURED_KEY);
  else await chrome.storage.session.set({ [CAPTURED_KEY]: value });
}

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Transcribe the audio of the tab the user asked FactCheck to verify.',
  });
}

function command(message: OffscreenCommand) {
  return chrome.runtime.sendMessage<OffscreenCommand, { ok: boolean; message?: string }>(message);
}

async function release() {
  await setCaptured(null);
  await command({ target: 'offscreen', kind: 'stop' }).catch(() => undefined);
  await chrome.offscreen.closeDocument().catch(() => undefined);
}

export async function startAudio(tabId: number, language?: string): Promise<null> {
  const current = await captured();
  if (current && current.tabId !== tabId) {
    // A record without an offscreen document is left over from a crash: it must not block other tabs.
    if (await hasOffscreen()) {
      throw new CallTransportError('FactCheck is already listening to another tab. Stop that check first.');
    }
    await setCaptured(null);
  }
  // Record the tab first so a stop or a tab close during start can still release it.
  await setCaptured({ tabId, ...(language ? { language } : {}) });
  try {
    // Slow steps first: Chrome tab stream ids expire a few seconds after they are issued.
    const token = await api.transcriptionToken(language);
    await ensureOffscreen();
    let streamId: string;
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    } catch {
      throw new CallTransportError('Chrome did not allow capturing the audio. Click the extension icon on this tab and start again.');
    }
    if ((await captured())?.tabId !== tabId) throw new CallTransportError('Listening stopped before it started.');
    const reply = await command({ target: 'offscreen', kind: 'start', streamId, token: token.value });
    if (!reply?.ok) throw new CallTransportError(reply?.message ?? 'Could not capture the tab audio.');
  } catch (error) {
    if ((await captured())?.tabId === tabId) await release();
    throw error;
  }
  return null;
}

async function forCapturedTab(tabId: number, kind: 'pause' | 'resume' | 'stop') {
  if ((await captured())?.tabId !== tabId) return null;
  if (kind === 'stop') await release();
  else await command({ target: 'offscreen', kind }).catch(() => undefined);
  return null;
}

export const pauseAudio = (tabId: number) => forCapturedTab(tabId, 'pause');
export const resumeAudio = (tabId: number) => forCapturedTab(tabId, 'resume');
export const stopAudio = (tabId: number) => forCapturedTab(tabId, 'stop');

export function isOffscreenEvent(message: unknown, sender: chrome.runtime.MessageSender): message is OffscreenEvent {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL(OFFSCREEN_URL)
    && typeof message === 'object' && message !== null && 'source' in message && message.source === 'offscreen';
}

// One chain for every event, so deltas reach the tab in the order OpenAI sent them.
let forwarding: Promise<unknown> = Promise.resolve();

/** Forwards transcripts and errors from the offscreen document to the captured tab. */
export function handleOffscreenEvent(event: OffscreenEvent, respond: (reply: unknown) => void): boolean {
  if (event.kind === 'token-needed') {
    captured().then((current) => api.transcriptionToken(current?.language)).then(
      ({ value }) => respond({ ok: true, token: value }),
      () => respond({ ok: false }),
    );
    return true;
  }
  const tabEvent: TabEvent = event.kind === 'delta' ? { kind: 'audio-delta', itemId: event.itemId, text: event.text }
    : event.kind === 'segment' ? { kind: 'audio-segment', itemId: event.itemId, text: event.text }
      : { kind: 'audio-error', message: event.message };
  forwarding = forwarding.then(async () => {
    const current = await captured();
    if (!current) return;
    try {
      await chrome.tabs.sendMessage(current.tabId, tabEvent);
    } catch {
      // Nobody is listening in that tab any more (reloaded or closed): stop sending its audio to OpenAI.
      await stopAudio(current.tabId);
    }
  });
  return false;
}

/** The captured tab was closed or reloaded: release the capture. */
export function releaseTab(tabId: number) {
  void stopAudio(tabId);
}
