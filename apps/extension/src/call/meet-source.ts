// Google Meet captions as a capture source, built on the GF-03 engine: `readCaptionRows` reads the caption DOM
// and the consolidator turns Meet's self-rewriting captions into one utterance per intervention.
// Spec: docs/specs/meet-captions-capture.md (engine) and docs/specs/call-overlay.md (overlay).
import { createCaptionConsolidator, DEFAULT_CONSOLIDATOR_OPTIONS } from '../meet/caption-consolidator.js';
import type { CaptionConsolidator, CaptionRow } from '../meet/caption-consolidator.js';
import { readCaptionRows } from '../meet/meet-captions-dom.js';
import { turnOnCaptions } from './platforms.js';
import type { CaptureSource, Segment, SourceSink } from './types.js';
import type { UtteranceInput } from '@growth-factcheking/shared';

export const MEET_UNKNOWN_SPEAKER = 'Participant';
const POLL_MS = 300;
const VOICE_MS = 1200;

type MeetWindow = Window & {
  documentPictureInPicture?: EventTarget & { readonly window: Window | null };
};

export type MeetSourceOptions = {
  /** Visible caption rows, or null when captions are off. Defaults to reading the page. */
  read?: () => CaptionRow[] | null;
  now?: () => number;
  pollMs?: number;
  hostWindow?: MeetWindow;
  /** Clicks Meet's captions button when they are off. Defaults to the page's button. */
  enableCaptions?: () => void;
};

const toSegment = ({ speaker, text, speakerKind }: UtteranceInput): Segment => ({ speaker, text, kind: speakerKind });

export function createMeetSource(options: MeetSourceOptions = {}): CaptureSource {
  const host = options.hostWindow ?? (typeof window === 'undefined' ? undefined : window as MeetWindow);
  const pictureInPicture = host?.documentPictureInPicture;
  const readMain = options.read ?? (() => host ? readCaptionRows(host.document) : null);
  const now = options.now ?? Date.now;
  const pollMs = options.pollMs ?? POLL_MS;
  let consolidator: CaptionConsolidator | null = null;
  let sink: SourceSink | null = null;
  let cancelPoll: (() => void) | undefined;
  let floating: Window | null = null;
  let observer: MutationObserver | undefined;
  let signature = '';
  let voiceUntil = 0;
  let session = 0;

  const readFloating = () => floating && !floating.closed ? readCaptionRows(floating.document, true) : null;

  /**
   * A fresh consolidator that already knows what is on screen, so those captions are never sent: they were
   * said before Start, or while paused.
   */
  function baseline() {
    consolidator = createCaptionConsolidator({
      ...DEFAULT_CONSOLIDATOR_OPTIONS,
      unknownSpeaker: MEET_UNKNOWN_SPEAKER,
      idPrefix: `meet-${++session}`,
    });
    const rows = [...(readMain() ?? []), ...(readFloating() ?? [])];
    if (rows.length) {
      consolidator.observe(rows, now());
      consolidator.flush();
    }
  }

  function poll() {
    if (!consolidator || !sink) return;
    const rows = readFloating() ?? readMain();
    const at = now();
    const out = rows ? consolidator.observe(rows, at) : consolidator.tick(at);
    const next = (rows ?? []).map(({ speaker, text }) => `${speaker}:${text}`).join('|');
    if (next && next !== signature) voiceUntil = at + VOICE_MS;
    signature = next;
    sink.segments(out.map(toSegment));
    sink.activity({ found: rows !== null, voice: at < voiceUntil });
  }

  function useWindow(next: Window | null) {
    cancelPoll?.();
    observer?.disconnect();
    observer = undefined;
    floating?.removeEventListener('pagehide', leaveFloating);
    floating = next;
    if (next) {
      next.addEventListener('pagehide', leaveFloating);
      const Observer = next.document.defaultView?.MutationObserver ?? MutationObserver;
      observer = new Observer(poll);
      observer.observe(next.document, { childList: true, subtree: true, characterData: true });
      // Settle the last caption on the visible window's clock when Chrome throttles the opener.
      const timer = next.setInterval(poll, pollMs);
      cancelPoll = () => next.clearInterval(timer);
    } else {
      const timer = setInterval(poll, pollMs);
      cancelPoll = () => clearInterval(timer);
    }
  }

  function enterFloating() {
    const next = pictureInPicture?.window ?? null;
    if (!next || next.closed || next === floating) return;
    useWindow(next);
    poll();
  }

  function leaveFloating() {
    useWindow(null);
    poll();
  }

  return {
    capture: 'captions',
    platform: 'meet',
    label: 'Google Meet',
    hint: 'Turn on Meet captions (CC): FactCheck reads what they show.',
    anchorBottom: 96,
    async start(next) {
      (options.enableCaptions ?? (() => { if (host) turnOnCaptions(host.document); }))();
      pictureInPicture?.addEventListener('enter', enterFloating);
      enterFloating();
      baseline();
      sink = next;
      if (!floating) useWindow(null);
    },
    pause() {
      // Turns that already settled are kept; one still being spoken is dropped (rebuilt from scratch on resume).
      return consolidator ? consolidator.tick(now()).map(toSegment) : [];
    },
    resume() {
      baseline();
    },
    stop() {
      pictureInPicture?.removeEventListener('enter', enterFloating);
      floating?.removeEventListener('pagehide', leaveFloating);
      observer?.disconnect();
      observer = undefined;
      floating = null;
      cancelPoll?.();
      cancelPoll = undefined;
      sink = null;
      const rest = consolidator?.flush() ?? [];
      consolidator = null;
      return rest.map(toSegment);
    },
  };
}
