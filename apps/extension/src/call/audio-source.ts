// Tab audio as a capture source. The background worker captures this tab's audio and an offscreen document
// streams it to OpenAI live transcription. The live model streams text deltas without turn detection, so the
// deltas are cut into sentences here.
import type { CallRequest, TabEvent } from '../messages.js';
import { takeSentences } from './segmenter.js';
import type { CaptureSource, Segment, SourceSink } from './types.js';

export const AUDIO_SPEAKER = 'Tab audio';
// The live model sends text in bursts. Wait longer when a number may still be missing its unit.
const QUIET_FINISHED_MS = 600;
const QUIET_UNFINISHED_MS = 2200;
const QUIET_CONTINUATION_MS = 3200;
const FINISHED = /[.!?…]["»”)]?$/u;
const EXPECTS_MORE = /(?:\p{N}[.,]?|(?:^|\s)(?:and|at|in|of|to|the|a|an|y|en|de|del|con|el|la|los|las))$/iu;
const TICK_MS = 200;
const VOICE_MS = 1200;

export type AudioControl = (request: Extract<CallRequest, { kind: `audio-${string}` }>) => Promise<unknown>;

const LANGUAGES = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: '', label: 'Other' },
] as const;

/** Default spoken language: the browser's, when offered. The hint fixes most misheard words. */
function browserLanguage(): string {
  const language = navigator.language.slice(0, 2).toLowerCase();
  return LANGUAGES.some(({ value }) => value === language) ? language : '';
}

export function createAudioSource(control: AudioControl, platform: 'web' | 'meet' = 'web'): CaptureSource {
  const microphone = platform === 'meet';
  let microphoneOnly = false;
  const segment = (text: string): Segment => microphoneOnly
    ? { speaker: 'You (microphone)', text, kind: 'self' }
    : { speaker: microphone ? 'Call audio' : AUDIO_SPEAKER, text, kind: 'unknown' };
  let sink: SourceSink | null = null;
  let paused = false;
  let buffer = '';
  let lastDelta = -Infinity;
  let lastItemId: string | undefined;
  let tick = 0;
  let language = browserLanguage();
  const streamedItems = new Set<string>();

  function emit(texts: readonly string[]) {
    const list = texts.map((text) => text.trim()).filter((text) => /\p{L}/u.test(text)).map(segment);
    if (list.length) sink?.segments(list);
  }

  function finishBuffer() {
    const text = buffer;
    buffer = '';
    emit([text]);
    sink?.draft?.('');
  }

  function onDelta(itemId: string, text: string) {
    if (paused || !text) return;
    if (lastItemId !== undefined && lastItemId !== itemId && buffer) finishBuffer();
    lastItemId = itemId;
    streamedItems.add(itemId);
    lastDelta = Date.now();
    buffer += text;
    const { done, rest } = takeSentences(buffer);
    buffer = rest;
    emit(done);
    sink?.activity({ found: true, voice: true });
    sink?.draft?.(buffer.trim());
  }

  function onTick() {
    if (paused) return;
    const quiet = Date.now() - lastDelta;
    const tail = buffer.trim();
    const wait = FINISHED.test(tail) ? QUIET_FINISHED_MS
      : EXPECTS_MORE.test(tail) ? QUIET_CONTINUATION_MS : QUIET_UNFINISHED_MS;
    if (tail && quiet >= wait) finishBuffer();
    sink?.activity({ found: true, voice: quiet < VOICE_MS });
  }

  function onEvent(message: unknown) {
    if (!sink || typeof message !== 'object' || message === null || !('kind' in message)) return;
    const event = message as TabEvent;
    if (event.kind === 'audio-delta' && typeof event.text === 'string' && typeof event.itemId === 'string') {
      onDelta(event.itemId, event.text);
    } else if (event.kind === 'audio-segment' && typeof event.text === 'string' && typeof event.itemId === 'string') {
      if (paused) return;
      // A completed item can settle its remaining draft immediately. Its earlier sentences have already been sent.
      if (!streamedItems.has(event.itemId)) emit([event.text]);
      else if (event.itemId === lastItemId && buffer) finishBuffer();
    } else if (event.kind === 'audio-error' && typeof event.message === 'string') {
      sink.failed(event.message);
    }
  }

  function detach() {
    chrome.runtime.onMessage.removeListener(onEvent);
    window.clearInterval(tick);
    sink = null;
  }

  return {
    capture: 'audio',
    platform,
    label: microphone ? 'Google Meet' : 'this tab',
    hint: microphone ? 'Waiting for the microphone and call audio…' : 'Waiting for audio from this tab…',
    get notice() {
      return microphoneOnly ? 'Listening to your microphone only. To include other participants, stop and open FactCheck from the toolbar in Meet before starting again.' : undefined;
    },
    anchorBottom: microphone ? 96 : 24,
    language: {
      options: LANGUAGES,
      value: () => language,
      set(value) {
        if (LANGUAGES.some((option) => option.value === value)) language = value;
      },
    },
    async start(next) {
      chrome.runtime.onMessage.addListener(onEvent);
      sink = next;
      paused = false;
      microphoneOnly = false;
      buffer = '';
      lastDelta = -Infinity;
      lastItemId = undefined;
      streamedItems.clear();
      try {
        microphoneOnly = await control({ kind: 'audio-start', ...(language ? { language } : {}), ...(microphone ? { microphone: true } : {}) }) === 'microphone';
      } catch (error) {
        detach();
        throw error;
      }
      tick = window.setInterval(onTick, TICK_MS);
      next.activity({ found: true, voice: false });
    },
    pause() {
      // Finished sentences are kept; the half-said one is dropped. The audio track is muted, so nothing said
      // while paused reaches OpenAI.
      const { done, rest } = takeSentences(buffer);
      const kept = FINISHED.test(rest.trim()) ? [...done, rest] : done;
      buffer = '';
      paused = true;
      void control({ kind: 'audio-pause' }).catch(() => undefined);
      return kept.map((text) => text.trim()).filter((text) => /\p{L}/u.test(text)).map(segment);
    },
    resume() {
      paused = false;
      buffer = '';
      lastDelta = -Infinity;
      void control({ kind: 'audio-resume' }).catch(() => undefined);
    },
    stop() {
      const rest = buffer.trim();
      buffer = '';
      void control({ kind: 'audio-stop' }).catch(() => undefined);
      detach();
      return /\p{L}/u.test(rest) ? [segment(rest)] : [];
    },
  };
}
