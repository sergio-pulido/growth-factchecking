// Tab audio as a capture source. The background worker captures this tab's audio and an offscreen document
// streams it to OpenAI live transcription. The live model streams text deltas without turn detection, so the
// deltas are cut into sentences here.
import type { CallRequest, TabEvent } from '../messages.js';
import { takeSentences } from './segmenter.js';
import type { CaptureSource, Segment, SourceSink } from './types.js';

export const AUDIO_SPEAKER = 'Tab audio';
// The live model sends text in bursts and trickles out the last words of a turn seconds apart: a finished
// sentence is cut after a short silence, an unfinished one only after a long one.
const QUIET_FINISHED_MS = 1500;
const QUIET_UNFINISHED_MS = 8000;
const FINISHED = /[.!?…]["»”)]?$/u;
const TICK_MS = 400;
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
  const segment = (text: string): Segment => ({ speaker: microphone ? 'Call audio' : AUDIO_SPEAKER, text, kind: 'unknown' });
  let sink: SourceSink | null = null;
  let paused = false;
  let buffer = '';
  let lastDelta = 0;
  let tick = 0;
  let language = browserLanguage();
  const streamedItems = new Set<string>();

  function emit(texts: readonly string[]) {
    const list = texts.map((text) => text.trim()).filter((text) => /\p{L}/u.test(text)).map(segment);
    if (list.length) sink?.segments(list);
  }

  function onDelta(itemId: string, text: string) {
    if (paused) return;
    streamedItems.add(itemId);
    lastDelta = Date.now();
    buffer += text;
    const { done, rest } = takeSentences(buffer);
    buffer = rest;
    emit(done);
    sink?.activity({ found: true, voice: true });
  }

  function onTick() {
    const voice = Date.now() - lastDelta < VOICE_MS;
    const wait = FINISHED.test(buffer.trim()) ? QUIET_FINISHED_MS : QUIET_UNFINISHED_MS;
    if (buffer && Date.now() - lastDelta >= wait) {
      emit([buffer]);
      buffer = '';
    }
    sink?.activity({ found: true, voice: voice && !paused });
  }

  function onEvent(message: unknown) {
    if (!sink || typeof message !== 'object' || message === null || !('kind' in message)) return;
    const event = message as TabEvent;
    if (event.kind === 'audio-delta' && typeof event.text === 'string' && typeof event.itemId === 'string') {
      onDelta(event.itemId, event.text);
    } else if (event.kind === 'audio-segment' && typeof event.text === 'string' && typeof event.itemId === 'string') {
      // Models with turn detection also send the whole item at the end: use it only if no deltas came for it.
      if (!paused && !streamedItems.has(event.itemId)) emit([event.text]);
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
      buffer = '';
      streamedItems.clear();
      try {
        await control({ kind: 'audio-start', ...(language ? { language } : {}), ...(microphone ? { microphone: true } : {}) });
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
      const kept = FINISHED.test(rest) ? [...done, rest] : done;
      buffer = '';
      paused = true;
      void control({ kind: 'audio-pause' }).catch(() => undefined);
      return kept.map((text) => text.trim()).filter((text) => /\p{L}/u.test(text)).map(segment);
    },
    resume() {
      paused = false;
      buffer = '';
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
