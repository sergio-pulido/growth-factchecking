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

export type MeetSourceOptions = {
  /** Visible caption rows, or null when captions are off. Defaults to reading the page. */
  read?: () => CaptionRow[] | null;
  now?: () => number;
  pollMs?: number;
  /** Clicks Meet's captions button when they are off. Defaults to the page's button. */
  enableCaptions?: () => void;
};

const toSegment = ({ speaker, text, speakerKind }: UtteranceInput): Segment => ({ speaker, text, kind: speakerKind });

export function createMeetSource(options: MeetSourceOptions = {}): CaptureSource {
  const read = options.read ?? (() => readCaptionRows(document));
  const now = options.now ?? Date.now;
  const pollMs = options.pollMs ?? POLL_MS;
  let consolidator: CaptionConsolidator | null = null;
  let sink: SourceSink | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let signature = '';
  let voiceUntil = 0;
  let session = 0;

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
    const rows = read();
    if (rows?.length) {
      consolidator.observe(rows, now());
      consolidator.flush();
    }
  }

  function poll() {
    if (!consolidator || !sink) return;
    const rows = read();
    const at = now();
    const out = rows ? consolidator.observe(rows, at) : consolidator.tick(at);
    const next = (rows ?? []).map(({ speaker, text }) => `${speaker}:${text}`).join('|');
    if (next && next !== signature) voiceUntil = at + VOICE_MS;
    signature = next;
    sink.segments(out.map(toSegment));
    sink.activity({ found: rows !== null, voice: at < voiceUntil });
  }

  return {
    capture: 'captions',
    platform: 'meet',
    label: 'Google Meet',
    hint: 'Turn on Meet captions (CC): FactCheck reads what they show.',
    anchorBottom: 96,
    async start(next) {
      (options.enableCaptions ?? (() => turnOnCaptions(document)))();
      baseline();
      sink = next;
      timer = setInterval(poll, pollMs);
    },
    pause() {
      // Turns that already settled are kept; one still being spoken is dropped (rebuilt from scratch on resume).
      return consolidator ? consolidator.tick(now()).map(toSegment) : [];
    },
    resume() {
      baseline();
    },
    stop() {
      clearInterval(timer);
      sink = null;
      const rest = consolidator?.flush() ?? [];
      consolidator = null;
      return rest.map(toSegment);
    },
  };
}
