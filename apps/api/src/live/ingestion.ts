import { CLAIM_MAX_LENGTH } from '@growth-factcheking/shared';
import type { FactInput } from './fact-store.js';

function isSourceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || !/^https?:\/\//i.test(value)) return false;
  const url = URL.parse(value);
  return url !== null && !url.username && !url.password;
}

export function parseFacts(input: unknown): FactInput[] {
  const rows: unknown = typeof input === 'object' && input !== null && 'facts' in input ? input.facts : input;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Expected a non-empty facts array.');

  const ids = new Set<string>();
  return rows.map((row: unknown, index) => {
    const fail = (reason: string): never => {
      throw new Error(`Invalid fact at position ${index + 1}: ${reason}`);
    };
    if (typeof row !== 'object' || row === null) return fail('expected an object.');

    const { id, statement, sourceUrl, sourceTitle, additionalSourceUrls } = row as Partial<Record<keyof FactInput, unknown>>;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return fail('invalid ID.');
    if (ids.has(id)) return fail('duplicate ID.');
    if (typeof statement !== 'string' || !statement.trim() || Array.from(statement.trim()).length > CLAIM_MAX_LENGTH) {
      return fail('invalid statement.');
    }
    if (!isSourceUrl(sourceUrl)) return fail('expected an HTTP(S) source URL without credentials.');
    if (additionalSourceUrls !== undefined) {
      if (!Array.isArray(additionalSourceUrls) || additionalSourceUrls.length > 5 || !additionalSourceUrls.every(isSourceUrl)) {
        return fail('expected up to five additional HTTP(S) source URLs without credentials.');
      }
      const links = [sourceUrl, ...additionalSourceUrls].map((link) => new URL(link).href);
      if (new Set(links).size !== links.length) return fail('duplicate source URL.');
    }
    if (sourceTitle !== undefined && (typeof sourceTitle !== 'string' || !sourceTitle.trim() || sourceTitle.length > 300)) {
      return fail('invalid source title.');
    }
    ids.add(id);
    return {
      id,
      statement: statement.trim(),
      sourceUrl,
      ...(sourceTitle === undefined ? {} : { sourceTitle: sourceTitle.trim() }),
      ...(additionalSourceUrls === undefined ? {} : { additionalSourceUrls }),
    };
  });
}
