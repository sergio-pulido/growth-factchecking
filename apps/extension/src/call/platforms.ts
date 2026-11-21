// Web call apps the overlay knows. Meet captions are read by the GF-03 engine (meet-source.ts); Zoom and Teams
// use the generic readers below. Each app's markup changes without notice, so every reader has a structural
// fallback. Selectors are best-effort: check them first if capture stops.
import type { SpeakerKind } from '@growth-factcheking/shared';
import type { CaptionLine } from './segmenter.js';

export type CallPlatform = {
  id: 'meet' | 'zoom' | 'teams';
  label: string;
  /** True when the page is a call (not a lobby, chat or landing page). */
  isCall(location: Location, root: ParentNode): boolean;
};

/** A call app read by the generic caption reader. */
export type CaptionPlatform = CallPlatform & {
  id: 'zoom' | 'teams';
  findRegion(root: ParentNode): HTMLElement | null;
  readLines(region: HTMLElement): CaptionLine[];
  /** Hint shown when captions are not on screen. */
  hint: string;
  /** Distance from the bottom of the window to the pill, clear of the app's own call controls. */
  anchorBottom: number;
};

const CAPTIONS_BUTTON = /(turn on captions|show captions|activar subtítulos|mostrar subtítulos)/iu;
const SELF_NAMES = /^(you|tú|tu|vous|du|você|yo)$/iu;

function clean(text: string | null | undefined) {
  return (text ?? '').replace(/\s+/gu, ' ').trim();
}

function first(root: ParentNode, selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    const found = root.querySelector<HTMLElement>(selector);
    if (found) return found;
  }
  return null;
}

type BlockSelectors = { block: string; speaker: string; text: string };

/** One line per caption block; falls back to "first line is the speaker, the rest is the text". */
function readBlocks(region: HTMLElement, selectors: BlockSelectors): CaptionLine[] {
  const marked = Array.from(region.querySelectorAll<HTMLElement>(selectors.block));
  const blocks = marked.length > 0
    ? marked
    : Array.from(region.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
  const lines: CaptionLine[] = [];
  for (const block of blocks) {
    const speaker = clean(block.querySelector(selectors.speaker)?.textContent);
    const textNode = block.querySelector(selectors.text);
    if (textNode) {
      const text = clean(textNode.textContent);
      if (text) lines.push({ key: block, speaker, text });
      continue;
    }
    const parts = (block.innerText || '').split('\n').map(clean).filter(Boolean);
    if (parts.length === 1) lines.push({ key: block, speaker, text: parts[0]! });
    else if (parts.length > 1) lines.push({ key: block, speaker: speaker || parts[0]!, text: parts.slice(1).join(' ') });
  }
  return lines;
}

export function speakerKindOf(speaker: string): SpeakerKind {
  if (!speaker) return 'unknown';
  return SELF_NAMES.test(speaker) ? 'self' : 'named';
}

/** Clicks the app's own captions button when captions are off. Returns false when it cannot find it. */
export function turnOnCaptions(root: ParentNode): boolean {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button[aria-label]'))
    .find((candidate) => CAPTIONS_BUTTON.test(candidate.getAttribute('aria-label') ?? ''));
  if (!button || button.getAttribute('aria-pressed') === 'true') return false;
  button.click();
  return true;
}

export const MEET: CallPlatform = {
  id: 'meet',
  label: 'Google Meet',
  isCall: ({ hostname, pathname }) => hostname === 'meet.google.com' && /^\/[a-z]{3,4}-[a-z]{4}-[a-z]{3,4}(?:\/|$)/u.test(pathname),
};

// Zoom web client (app.zoom.us/wc/...). Its captions do not always name the speaker.
export const ZOOM: CaptionPlatform = {
  id: 'zoom',
  label: 'Zoom',
  isCall: ({ hostname, pathname }) => /(^|\.)zoom\.us$/u.test(hostname) && pathname.startsWith('/wc/'),
  findRegion: (root) => first(root, [
    '#live-transcription-subtitle',
    '.live-transcription-subtitle__box',
    '[class*="live-transcription-subtitle"]',
    '[aria-label*="caption" i][aria-live]',
  ]),
  readLines: (region) => readBlocks(region, {
    block: '.live-transcription-subtitle__item',
    speaker: '[class*="subtitle__name"], [class*="speaker-name"]',
    text: '[class*="subtitle__text"], .live-transcription-subtitle__item-text',
  }),
  hint: 'Turn on Zoom captions (Captions › Show Captions): FactCheck reads what they show.',
  anchorBottom: 90,
};

// Microsoft Teams on the web (work and personal).
export const TEAMS: CaptionPlatform = {
  id: 'teams',
  label: 'Microsoft Teams',
  isCall: ({ hostname }, root) => /^teams\.(microsoft\.com|live\.com|cloud\.microsoft)$/u.test(hostname)
    && root.querySelector('[data-tid="hangup-main-btn"], [data-tid="call-hangup"], #hangup-button') !== null,
  findRegion: (root) => first(root, [
    '[data-tid="closed-caption-v2-window-wrapper"]',
    '[data-tid="closed-captions-renderer"]',
    '[data-tid="closed-caption-renderer-wrapper"]',
  ]),
  readLines: (region) => readBlocks(region, {
    block: '.fui-ChatMessageCompact, [data-tid="closed-caption-message"]',
    speaker: '[data-tid="author"]',
    text: '[data-tid="closed-caption-text"]',
  }),
  hint: 'Turn on Teams live captions (More › Language and speech › Show live captions).',
  anchorBottom: 24,
};

/** The call app this page belongs to, whether or not a call is running. */
export function platformOf({ hostname }: Location): CallPlatform | CaptionPlatform | null {
  if (hostname === 'meet.google.com') return MEET;
  if (/(^|\.)zoom\.us$/u.test(hostname)) return ZOOM;
  if (/^teams\.(microsoft\.com|live\.com|cloud\.microsoft)$/u.test(hostname)) return TEAMS;
  return null;
}
