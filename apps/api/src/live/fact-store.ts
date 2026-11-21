// Fact corpus in PostgreSQL + pgvector. Schema: db/migrations/001_facts.sql
import pg from 'pg';
import type { Fact, FactSearch } from './types.js';

export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

type FactRow = {
  id: string;
  statement: string;
  statement_en: string | null;
  source_url: string;
  source_title: string | null;
  additional_source_urls: string[];
  similarity: number;
};

/**
 * Nearest facts by cosine distance. ORDER BY the raw distance so the HNSW index is used;
 * the similarity floor is applied afterwards in JS.
 */
export function createFactSearch(pool: pg.Pool, minSimilarity: number): FactSearch {
  return async (embedding, limit): Promise<Fact[]> => {
    const { rows } = await pool.query<FactRow>(
      `SELECT id, statement, statement_en, source_url, source_title, additional_source_urls,
              1 - (embedding <=> $1::vector) AS similarity
         FROM facts
        ORDER BY embedding <=> $1::vector
        LIMIT $2`,
      [toVectorLiteral(embedding), limit],
    );
    return rows
      .map((r) => ({
        id: r.id,
        statement: r.statement,
        statementEn: r.statement_en,
        sourceUrl: r.source_url,
        sourceTitle: r.source_title,
        additionalSourceUrls: r.additional_source_urls,
        similarity: Number(r.similarity),
      }))
      .filter((f) => f.similarity >= minSimilarity);
  };
}

export type FactInput = {
  id: string;
  statement: string;
  statementEn?: string;
  sourceUrl: string;
  sourceTitle?: string;
  additionalSourceUrls?: string[];
};

export async function upsertFact(db: Pick<pg.PoolClient, 'query'>, fact: FactInput, embedding: number[]): Promise<void> {
  await db.query(
    `INSERT INTO facts (id, statement, source_url, source_title, embedding, additional_source_urls, statement_en)
     VALUES ($1, $2, $3, $4, $5::vector, $6, $7)
     ON CONFLICT (id) DO UPDATE
        SET statement = EXCLUDED.statement,
            statement_en = EXCLUDED.statement_en,
            source_url = EXCLUDED.source_url,
            source_title = EXCLUDED.source_title,
            embedding = EXCLUDED.embedding,
            additional_source_urls = EXCLUDED.additional_source_urls,
            updated_at = now()`,
    [fact.id, fact.statement, fact.sourceUrl, fact.sourceTitle ?? null, toVectorLiteral(embedding), fact.additionalSourceUrls ?? [], fact.statementEn ?? null],
  );
}
