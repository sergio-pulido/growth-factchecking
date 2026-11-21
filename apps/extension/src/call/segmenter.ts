// Turns live captions, which rewrite themselves while someone speaks, into final utterances.
// Pure logic: no DOM access, so it can be tested in Node.

export type CaptionLine = {
  /** Identity of the caption block on the page; stays the same while that block is on screen. */
  key: object;
  speaker: string;
  text: string;
};

export type FinalSegment = { speaker: string; text: string };

export type SegmenterOptions = {
  /** A block whose text has not changed for this long is final. */
  quietMs?: number;
  /** A finished sentence is final once this many words follow it. */
  wordsAfterSentence?: number;
};

type Track = {
  speaker: string;
  words: string[];
  /** How many leading words of `words` were already emitted. */
  consumed: number;
  changedAt: number;
};

const SENTENCE_END = /[.!?…]["»”)]?$/u;

/**
 * Splits append-only text (a live transcription stream) into finished sentences and the unfinished rest.
 * A sentence is finished once another word follows it; `maxWords` caps run-on text without punctuation.
 */
export function takeSentences(text: string, maxWords = 60): { done: string[]; rest: string } {
  const words = splitWords(text);
  const done: string[] = [];
  let start = 0;
  for (let i = 0; i < words.length - 1; i++) {
    if (SENTENCE_END.test(words[i]!) || i + 1 - start >= maxWords) {
      done.push(words.slice(start, i + 1).join(' '));
      start = i + 1;
    }
  }
  return { done, rest: words.slice(start).join(' ') };
}

export function normalizeWord(word: string) {
  return word.toLocaleLowerCase().replace(/[^\p{L}\p{N}%€$]/gu, '');
}

function splitWords(text: string) {
  return text.trim().split(/\s+/u).filter(Boolean);
}

/**
 * How many leading words of `next` were already emitted, given the words emitted from the previous version.
 * Meet fixes recent words and trims the start of long blocks, so the match is tolerant.
 */
export function alignConsumed(emitted: readonly string[], next: readonly string[]): number {
  if (emitted.length === 0) return 0;
  const done = emitted.map(normalizeWord);
  const now = next.map(normalizeWord);
  const target = done.join('');

  // Prefix of `next` whose letters are closest in length to what was emitted.
  // Comparing joined letters absorbs merges and splits such as "32 000" -> "32.000".
  let closest = 0;
  let closestGap = target.length;
  let joined = '';
  for (let k = 1; k <= now.length; k++) {
    joined += now[k - 1];
    if (joined === target) return k;
    const gap = Math.abs(joined.length - target.length);
    if (gap <= closestGap) {
      closest = k;
      closestGap = gap;
    }
    if (joined.length > target.length) break;
  }

  // Same block, revised in place: most of the emitted words are still in that prefix.
  if (closest > 0 && commonWords(done, now.slice(0, closest)) >= Math.ceil(done.length * 0.7)) return closest;

  // The start was trimmed: anchor on the last emitted words.
  for (let size = Math.min(4, done.length); size >= Math.min(2, done.length); size--) {
    const anchor = done.slice(-size);
    for (let i = now.length - size; i >= 0; i--) {
      if (anchor.every((word, j) => now[i + j] === word)) return i + size;
    }
  }

  // Nothing in common: the block now holds new speech. Otherwise skip the ambiguous prefix rather than resend it.
  const seen = new Set(done);
  const shared = now.filter((word) => seen.has(word)).length;
  return shared / Math.max(now.length, 1) < 0.3 ? 0 : closest;
}

/** Longest common subsequence of two word lists. */
function commonWords(a: readonly string[], b: readonly string[]): number {
  let previous: number[] = Array.from({ length: b.length + 1 }, () => 0);
  for (const word of a) {
    const row = [0];
    for (let j = 1; j <= b.length; j++) {
      row[j] = word === b[j - 1] ? previous[j - 1]! + 1 : Math.max(previous[j]!, row[j - 1]!);
    }
    previous = row;
  }
  return previous[b.length]!;
}

export class CaptionSegmenter {
  private readonly tracks = new Map<object, Track>();
  private readonly quietMs: number;
  private readonly wordsAfterSentence: number;

  constructor({ quietMs = 1800, wordsAfterSentence = 4 }: SegmenterOptions = {}) {
    this.quietMs = quietMs;
    this.wordsAfterSentence = wordsAfterSentence;
  }

  /** Feeds the caption blocks currently on screen, in page order. Returns the segments that became final. */
  update(lines: readonly CaptionLine[], now: number): FinalSegment[] {
    const out: FinalSegment[] = [];
    const present = new Set(lines.map(({ key }) => key));

    for (const [key, track] of this.tracks) {
      if (!present.has(key)) {
        this.emitRest(track, out);
        this.tracks.delete(key);
      }
    }

    lines.forEach((line, index) => {
      const words = splitWords(line.text);
      let track = this.tracks.get(line.key);
      if (!track) {
        track = { speaker: line.speaker, words, consumed: 0, changedAt: now };
        this.tracks.set(line.key, track);
      } else if (words.join(' ') !== track.words.join(' ') || line.speaker !== track.speaker) {
        const consumed = alignConsumed(track.words.slice(0, track.consumed), words);
        track.words = words;
        track.consumed = consumed;
        track.speaker = line.speaker || track.speaker;
        track.changedAt = now;
      }

      const superseded = index < lines.length - 1;
      if (superseded || now - track.changedAt >= this.quietMs) this.emitRest(track, out);
      else this.emitSentences(track, out);
    });
    return out;
  }

  /** Emits everything still pending, e.g. when capture stops. */
  flush(): FinalSegment[] {
    const out: FinalSegment[] = [];
    for (const track of this.tracks.values()) this.emitRest(track, out);
    return out;
  }

  /** Marks what is on screen as already handled, without emitting it (used while paused). */
  skipPending() {
    for (const track of this.tracks.values()) track.consumed = track.words.length;
  }

  private emitRest(track: Track, out: FinalSegment[]) {
    this.emit(track, track.words.length, out);
  }

  /**
   * Emits the finished sentences on screen and skips the unfinished rest (used when pausing):
   * a half-said sentence would be checked as a different, shorter claim.
   */
  flushSentences(): FinalSegment[] {
    const out: FinalSegment[] = [];
    for (const track of this.tracks.values()) {
      const last = track.words.length - 1;
      if (last >= track.consumed && SENTENCE_END.test(track.words[last]!)) this.emitRest(track, out);
      else this.emitSentences(track, out, 0);
    }
    this.skipPending();
    return out;
  }

  private emitSentences(track: Track, out: FinalSegment[], wordsAfter = this.wordsAfterSentence) {
    for (let i = track.words.length - 1 - wordsAfter; i >= track.consumed; i--) {
      if (SENTENCE_END.test(track.words[i]!)) {
        this.emit(track, i + 1, out);
        return;
      }
    }
  }

  private emit(track: Track, end: number, out: FinalSegment[]) {
    if (end <= track.consumed) return;
    const text = track.words.slice(track.consumed, end).join(' ');
    track.consumed = end;
    if (/\p{L}/u.test(text)) out.push({ speaker: track.speaker, text });
  }
}
