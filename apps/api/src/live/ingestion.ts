import { CLAIM_MAX_LENGTH } from '@growth-factcheking/shared';
import type { FactInput } from './fact-store.js';

export function parseFacts(input: unknown): FactInput[] {
  const rows: unknown = typeof input === 'object' && input !== null && 'facts' in input ? input.facts : input;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Expected a non-empty facts array.');

  const ids = new Set<string>();
  return rows.map((row: unknown, index) => {
    const fail = (reason: string): never => {
      throw new Error(`Invalid fact at position ${index + 1}: ${reason}`);
    };
    if (typeof row !== 'object' || row === null) return fail('expected an object.');

    const { id, statement, sourceUrl, sourceTitle } = row as Partial<Record<keyof FactInput, unknown>>;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return fail('invalid ID.');
    if (ids.has(id)) return fail('duplicate ID.');
    if (typeof statement !== 'string' || !statement.trim() || Array.from(statement.trim()).length > CLAIM_MAX_LENGTH) {
      return fail('invalid statement.');
    }
    if (typeof sourceUrl !== 'string' || sourceUrl.length > 2048 || !/^https?:\/\//i.test(sourceUrl) || !URL.canParse(sourceUrl)) {
      return fail('expected an HTTP(S) source URL.');
    }
    const url = new URL(sourceUrl);
    if (url.username || url.password) return fail('source URL must not contain credentials.');
    if (sourceTitle !== undefined && (typeof sourceTitle !== 'string' || !sourceTitle.trim() || sourceTitle.length > 300)) {
      return fail('invalid source title.');
    }
    ids.add(id);
    return { id, statement: statement.trim(), sourceUrl, ...(sourceTitle === undefined ? {} : { sourceTitle: sourceTitle.trim() }) };
  });
}
