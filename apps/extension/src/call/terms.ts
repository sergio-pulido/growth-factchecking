// Fixes brand and product names that Spanish captions (Meet) or transcription spell phonetically, e.g. "open ei".
// Runs on every final segment before it is shown and sent, so claim extraction sees the real name.

const L = '[\\p{L}\\p{N}]';
const word = (body: string) => new RegExp(`(?<!${L})(?:${body})(?!${L})`, 'giu');

const RULES: ReadonlyArray<[RegExp, string]> = [
  // open ai, open-ai, open a.i., open ei, open ey, open ay, openai, oupen ei, oben ai, open eye, open hey…
  [word('(?:o[uw]?pen|oben|opn)[\\s.-]*(?:a[\\s.]*[iíy]\\.?|[eé][iíy]|[aá][iíy]|eye|hey|ai)'), 'OpenAI'],
  // chat gpt, chat g p t, chat jipiti, chat yipiti, chatgpt
  [word('chat[\\s-]*(?:g[\\s.]*p[\\s.]*t|[jy]ipit[ií]|[jy]i[\\s-]?pi[\\s-]?t[ií])'), 'ChatGPT'],
  // it nig, itnik, it nik, ignig
  [word('it[\\s-]?ni[gk]|itnick'), 'Itnig'],
  [word('c[oó]dex'), 'Codex'],
  [word('dev[\\s-]?day|dev[\\s-]?dei'), 'DevDay'],
];

export function normalizeTerms(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out;
}
