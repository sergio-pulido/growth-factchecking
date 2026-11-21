// Conversations, utterances and claims in Postgres. Schema: db/migrations/002_conversations.sql
import type { ClaimCheck, ConversationView, SpeakerKind, UtteranceInput, Verdict } from '@growth-factcheking/shared';
import type pg from 'pg';
import type { ClaimRecord, ConversationState, ConversationStore, StoredUtterance } from './types.js';

type UtteranceRow = {
  id: string;
  client_id: string;
  speaker: string;
  speaker_kind: SpeakerKind;
  text: string;
  spoken_at: Date;
};

type ClaimRow = {
  id: string;
  text: string;
  status: 'checked' | 'failed';
  verdict: Verdict | null;
  sources: ClaimCheck['sources'];
  reason: string | null;
  speaker: string;
  client_id: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Unknown or malformed ids behave as missing instead of raising a database error. */
export const isConversationId = (id: string): boolean => UUID.test(id);

const toUtterance = (r: UtteranceRow): StoredUtterance => ({
  id: String(r.id),
  clientId: r.client_id,
  speaker: r.speaker,
  speakerKind: r.speaker_kind,
  text: r.text,
  spokenAt: r.spoken_at.toISOString(),
});

const toClaim = (r: ClaimRow): ClaimCheck => ({
  id: String(r.id),
  claim: r.text,
  speaker: r.speaker,
  utteranceClientId: r.client_id,
  status: r.status,
  verdict: r.verdict,
  sources: r.sources,
  ...(r.reason === 'general_knowledge' ? { basis: 'general_knowledge' as const } : {}),
});

const CLAIM_SELECT = `
  SELECT c.id, c.text, c.status, c.verdict, c.sources, c.reason, u.speaker, u.client_id
    FROM claims c JOIN utterances u ON u.id = c.utterance_id`;

export function createConversationStore(pool: pg.Pool): ConversationStore {
  return {
    async create({ platform, capture, title, pageUrl, language }) {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO conversations (platform, capture, title, page_url, language)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [platform, capture, title ?? null, pageUrl ?? null, language ?? null],
      );
      return rows[0]!.id;
    },

    async state(id): Promise<ConversationState> {
      if (!isConversationId(id)) return 'missing';
      const { rows } = await pool.query<{ ended: boolean }>(
        'SELECT ended_at IS NOT NULL AS ended FROM conversations WHERE id = $1',
        [id],
      );
      if (rows.length === 0) return 'missing';
      return rows[0]!.ended ? 'ended' : 'open';
    },

    async addUtterances(conversationId, utterances: readonly UtteranceInput[]) {
      if (utterances.length === 0) return [];
      // One statement: unnest keeps it atomic and preserves input order via ordinality.
      const { rows } = await pool.query<UtteranceRow>(
        `INSERT INTO utterances (conversation_id, client_id, speaker, speaker_kind, text, spoken_at)
         SELECT $1, u.client_id, u.speaker, u.speaker_kind, u.text, u.spoken_at
           FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::timestamptz[])
                WITH ORDINALITY AS u(client_id, speaker, speaker_kind, text, spoken_at, ord)
          ORDER BY u.ord
         ON CONFLICT (conversation_id, client_id) DO NOTHING
         RETURNING id, client_id, speaker, speaker_kind, text, spoken_at`,
        [
          conversationId,
          utterances.map((u) => u.clientId),
          utterances.map((u) => u.speaker),
          utterances.map((u) => u.speakerKind),
          utterances.map((u) => u.text),
          utterances.map((u) => u.spokenAt),
        ],
      );
      return rows.map(toUtterance).sort((a, b) => Number(a.id) - Number(b.id));
    },

    async contextBefore(conversationId, excludeIds, limit) {
      if (limit <= 0) return [];
      const { rows } = await pool.query<UtteranceRow>(
        `SELECT id, client_id, speaker, speaker_kind, text, spoken_at FROM (
           SELECT * FROM utterances
            WHERE conversation_id = $1 AND NOT (id = ANY($2::bigint[]))
            ORDER BY spoken_at DESC, id DESC
            LIMIT $3
         ) recent ORDER BY spoken_at, id`,
        [conversationId, excludeIds, limit],
      );
      return rows.map(toUtterance);
    },

    async saveClaims(conversationId, claims: readonly ClaimRecord[]) {
      if (claims.length === 0) return [];
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO claims (conversation_id, utterance_id, text, status, verdict, sources, reason, relevance, confidence)
         SELECT $1, c.utterance_id, c.text, c.status, c.verdict, c.sources, c.reason, c.relevance, c.confidence
           FROM jsonb_to_recordset($2::jsonb) AS c(
                  utterance_id bigint, text text, status text, verdict text, sources jsonb,
                  reason text, relevance real, confidence real)
         RETURNING id`,
        [
          conversationId,
          JSON.stringify(claims.map(({ utteranceId, claim, check }) => ({
            utterance_id: utteranceId,
            text: claim,
            status: check ? 'checked' : 'failed',
            verdict: check?.result.verdict ?? null,
            sources: check?.result.sources ?? [],
            reason: check?.meta.reason ?? null,
            relevance: check?.meta.relevance ?? null,
            confidence: check?.meta.confidence ?? null,
          }))),
        ],
      );
      const { rows: saved } = await pool.query<ClaimRow>(
        `${CLAIM_SELECT} WHERE c.id = ANY($1::bigint[]) ORDER BY c.id`,
        [rows.map(({ id }) => id)],
      );
      return saved.map(toClaim);
    },

    async end(id) {
      if (!isConversationId(id)) return false;
      const { rowCount } = await pool.query(
        'UPDATE conversations SET ended_at = COALESCE(ended_at, now()) WHERE id = $1',
        [id],
      );
      return (rowCount ?? 0) > 0;
    },

    async remove(id) {
      if (!isConversationId(id)) return false;
      const { rowCount } = await pool.query('DELETE FROM conversations WHERE id = $1', [id]);
      return (rowCount ?? 0) > 0;
    },

    async view(id): Promise<ConversationView | null> {
      if (!isConversationId(id)) return null;
      const { rows } = await pool.query<{
        id: string; platform: string; capture: ConversationView['capture'];
        title: string | null; started_at: Date; ended_at: Date | null;
      }>('SELECT id, platform, capture, title, started_at, ended_at FROM conversations WHERE id = $1', [id]);
      const c = rows[0];
      if (!c) return null;
      const [utterances, claims] = await Promise.all([
        pool.query<UtteranceRow>(
          `SELECT id, client_id, speaker, speaker_kind, text, spoken_at FROM utterances
            WHERE conversation_id = $1 ORDER BY spoken_at, id`,
          [id],
        ),
        pool.query<ClaimRow>(`${CLAIM_SELECT} WHERE c.conversation_id = $1 ORDER BY c.id`, [id]),
      ]);
      return {
        id: c.id,
        platform: c.platform,
        capture: c.capture,
        title: c.title,
        startedAt: c.started_at.toISOString(),
        endedAt: c.ended_at?.toISOString() ?? null,
        utterances: utterances.rows.map(({ client_id, speaker, speaker_kind, text, spoken_at }) => ({
          clientId: client_id, speaker, speakerKind: speaker_kind, text, spokenAt: spoken_at.toISOString(),
        })),
        claims: claims.rows.map(toClaim),
      };
    },
  };
}
