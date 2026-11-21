// Turns successive snapshots of visible Meet captions into final utterances.
//
// Meet rewrites a caption while someone speaks: it grows, corrects earlier words, sometimes redraws a shorter
// version, and re-renders the DOM node on each revision. So rows are matched to turns by speaker and words,
// never by DOM node, and a turn is only emitted once it stops changing.
import type { SpeakerKind, UtteranceInput } from '@growth-factcheking/shared';

export type CaptionRow = { speaker: string; text: string };

export type ConsolidatorOptions = {
  /** Prefix for clientIds, unique per capture session. */
  idPrefix: string;
  /** A turn counts as settled after this long without changes. */
  settleMs: number;
  /** A settled turn that is still on screen is emitted after this long without changes. */
  idleCommitMs: number;
  /** Label used when Meet shows no speaker for a row. */
  unknownSpeaker: string;
};

export const DEFAULT_CONSOLIDATOR_OPTIONS: Omit<ConsolidatorOptions, 'idPrefix'> = {
  settleMs: 1200,
  idleCommitMs: 4000,
  unknownSpeaker: 'Unknown',
};

type Turn = {
  clientId: string;
  speaker: string;
  /** Whole caption text as last rendered, including words already emitted by an earlier turn. */
  fullText: string;
  fullWords: string[];
  /** Leading words already emitted by the turn this one continues. */
  skipWords: number;
  firstSeenAt: number;
  changedAt: number;
  seenAt: number;
};

const REVISION_PREFIX_WORDS = 3;
const REVISION_WINDOW_WORDS = 16;
const REVISION_MIN_OVERLAP = 0.6;
const COMMITTED_MEMORY = 20;

/** Lowercase words without accents or punctuation, used only for matching. */
export function words(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function startsWith(full: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= full.length && prefix.every((w, i) => full[i] === w);
}

function lcsLength(a: readonly string[], b: readonly string[]): number {
  const row = Array.from({ length: b.length + 1 }, () => 0);
  for (const wa of a) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = wa === b[j - 1] ? diagonal + 1 : Math.max(row[j]!, row[j - 1]!);
      diagonal = above;
    }
  }
  return row[b.length]!;
}

/** True when `next` looks like a rewrite of `prev` (growth, shrink, or corrected words). */
export function isRevision(prev: readonly string[], next: readonly string[]): boolean {
  if (prev.length === 0 || next.length === 0) return false;
  if (startsWith(next, prev) || startsWith(prev, next)) return true;
  const head = Math.min(REVISION_PREFIX_WORDS, prev.length, next.length);
  if (head === REVISION_PREFIX_WORDS && startsWith(next, prev.slice(0, head))) return true;
  const a = prev.slice(0, REVISION_WINDOW_WORDS);
  const b = next.slice(0, REVISION_WINDOW_WORDS);
  return lcsLength(a, b) / Math.min(a.length, b.length) >= REVISION_MIN_OVERLAP && Math.min(a.length, b.length) >= 3;
}

/** Drops the first `count` matchable words from the original text, keeping its casing and punctuation. */
export function dropLeadingWords(text: string, count: number): string {
  if (count <= 0) return text.trim();
  const tokens = text.trim().split(/\s+/);
  let seen = 0;
  let index = 0;
  while (index < tokens.length && seen < count) {
    if (words(tokens[index]!).length > 0) seen += words(tokens[index]!).length;
    index++;
  }
  return tokens.slice(index).join(' ').trim();
}

export function classifySpeaker(label: string): SpeakerKind {
  if (!label.trim()) return 'unknown';
  if (/^(you|tú|tu|usted|vous|du)$/iu.test(label.trim())) return 'self';
  return 'named';
}

export type CaptionConsolidator = {
  /** Feeds the rows visible now. Returns utterances that became final. */
  observe(rows: readonly CaptionRow[], now: number): UtteranceInput[];
  /** Emits turns that settled without a new snapshot. */
  tick(now: number): UtteranceInput[];
  /** Emits every open turn, e.g. when capture stops. */
  flush(): UtteranceInput[];
  openTurns(): number;
};

export function createCaptionConsolidator(options: ConsolidatorOptions): CaptionConsolidator {
  let open: Turn[] = [];
  let committed: Turn[] = [];
  let sequence = 0;
  let lastObservedAt = Number.NEGATIVE_INFINITY;

  const newTurn = (speaker: string, text: string, fullWords: string[], skipWords: number, now: number): Turn => ({
    clientId: `${options.idPrefix}-${++sequence}`,
    speaker,
    fullText: text,
    fullWords,
    skipWords,
    firstSeenAt: now,
    changedAt: now,
    seenAt: now,
  });

  const toUtterance = (turn: Turn): UtteranceInput | null => {
    const text = dropLeadingWords(turn.fullText, turn.skipWords);
    if (!text) return null;
    return {
      clientId: turn.clientId,
      speaker: turn.speaker.trim() || options.unknownSpeaker,
      speakerKind: classifySpeaker(turn.speaker),
      text,
      spokenAt: new Date(turn.firstSeenAt).toISOString(),
    };
  };

  const commit = (turns: readonly Turn[]): UtteranceInput[] => {
    if (turns.length === 0) return [];
    const ids = new Set(turns.map((t) => t.clientId));
    open = open.filter((t) => !ids.has(t.clientId));
    committed = [...committed, ...turns].slice(-COMMITTED_MEMORY);
    return turns
      .slice()
      .sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.clientId.localeCompare(b.clientId, 'en', { numeric: true }))
      .map(toUtterance)
      .filter((u): u is UtteranceInput => u !== null);
  };

  const applyRow = (row: CaptionRow, now: number): void => {
    const rowWords = words(row.text);
    if (rowWords.length === 0) return;
    const speaker = row.speaker.trim();

    const current = [...open].reverse().find((t) => t.speaker === speaker && isRevision(t.fullWords, rowWords));
    if (current) {
      current.seenAt = now;
      // A shorter redraw of the same words keeps the fuller text.
      const shrink = rowWords.length < current.fullWords.length && startsWith(current.fullWords, rowWords);
      if (!shrink && row.text !== current.fullText) {
        current.fullText = row.text;
        current.fullWords = rowWords;
        current.changedAt = now;
      }
      return;
    }

    const done = [...committed].reverse().find((t) => t.speaker === speaker && isRevision(t.fullWords, rowWords));
    if (done) {
      // Same caption still on screen after it was emitted. Only words beyond it start a new turn.
      if (rowWords.length > done.fullWords.length) {
        const turn = newTurn(speaker, row.text, rowWords, done.fullWords.length, now);
        done.fullWords = rowWords;
        open = [...open, turn];
      }
      return;
    }

    open = [...open, newTurn(speaker, row.text, rowWords, 0, now)];
  };

  const settled = (now: number): Turn[] => {
    const newest = open.reduce((max, t) => Math.max(max, t.firstSeenAt), Number.NEGATIVE_INFINITY);
    return open.filter((t) => {
      const quiet = now - t.changedAt;
      if (quiet >= options.idleCommitMs) return true;
      if (quiet < options.settleMs) return false;
      const offScreen = t.seenAt < lastObservedAt;
      const superseded = t.firstSeenAt < newest;
      return offScreen || superseded;
    });
  };

  return {
    observe(rows, now) {
      lastObservedAt = now;
      for (const row of rows) applyRow(row, now);
      return commit(settled(now));
    },
    tick(now) {
      return commit(settled(now));
    },
    flush() {
      return commit(open);
    },
    openTurns() {
      return open.length;
    },
  };
}
