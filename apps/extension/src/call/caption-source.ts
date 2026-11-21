// Reads a call app's live captions and turns them into final segments.
import { speakerKindOf, turnOnCaptions } from './platforms.js';
import type { CaptionPlatform } from './platforms.js';
import { CaptionSegmenter } from './segmenter.js';
import type { FinalSegment } from './segmenter.js';
import type { CaptureSource, Segment, SourceSink } from './types.js';

const SCAN_THROTTLE_MS = 150;
const TICK_MS = 400;
const VOICE_MS = 1200;

const withKind = ({ speaker, text }: FinalSegment): Segment => ({ speaker, text, kind: speakerKindOf(speaker) });

export function createCaptionSource(platform: CaptionPlatform, root: ParentNode & Node = document): CaptureSource {
  const segmenter = new CaptionSegmenter();
  const observer = new MutationObserver(scheduleScan);
  let sink: SourceSink | null = null;
  let region: HTMLElement | null = null;
  let signature = '';
  let voiceUntil = 0;
  let found = false;
  let scanTimer = 0;
  let tickTimer = 0;

  function scheduleScan() {
    if (!scanTimer) scanTimer = window.setTimeout(scan, SCAN_THROTTLE_MS);
  }

  function scan() {
    scanTimer = 0;
    // The captions region stays mounted while captions are on: only search the page again when it goes away.
    if (!region?.isConnected) region = platform.findRegion(root);
    const lines = region ? platform.readLines(region) : [];
    const next = lines.map(({ speaker, text }) => `${speaker}:${text}`).join('|');
    if (next && next !== signature) voiceUntil = Date.now() + VOICE_MS;
    signature = next;
    found = region !== null;
    const finals = segmenter.update(lines, Date.now());
    sink?.segments(finals.map(withKind));
    sink?.activity({ found, voice: Date.now() < voiceUntil });
  }

  function halt() {
    observer.disconnect();
    window.clearInterval(tickTimer);
    window.clearTimeout(scanTimer);
    scanTimer = 0;
    sink = null;
  }

  return {
    capture: 'captions',
    platform: platform.id,
    label: platform.label,
    hint: platform.hint,
    anchorBottom: platform.anchorBottom,
    async start(next) {
      turnOnCaptions(root);
      // Captions already on screen were said before consent: never send them.
      scan();
      segmenter.skipPending();
      sink = next;
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      tickTimer = window.setInterval(scan, TICK_MS);
    },
    pause: () => segmenter.flushSentences().map(withKind),
    resume: () => segmenter.skipPending(),
    stop() {
      halt();
      return segmenter.flush().map(withKind);
    },
  };
}
