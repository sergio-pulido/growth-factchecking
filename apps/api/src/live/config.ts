// Runtime configuration for the live fact-check pipeline.
// Every value comes from the environment; see .env.example at the repo root.

export type LiveConfig = {
  openaiApiKey: string;
  databaseUrl: string;
  embeddingModel: string;
  embeddingDimensions: number;
  decisionsModel: string;
  /** Max facts sent to Decisions as evidence. */
  topK: number;
  /** Cosine similarity floor (0..1). Facts below it are not evidence. */
  minSimilarity: number;
  /** Minimum confidence in the selected source. Lower confidence yields neutral. */
  minRelevance: number;
  /** Below this choice confidence, "yes"/"no" are softened to "probably_*". */
  minConfidence: number;
  /** Per-call timeout for OpenAI requests. Real-time path: fail fast, no retries. */
  openaiTimeoutMs: number;
  /**
   * SDK retries per OpenAI call (timeouts, connection errors, 429, 5xx). Unset = 0 so the interactive route fails
   * fast; conversation capture sets its own value (CLAIM_CHECK_RETRIES).
   */
  openaiMaxRetries?: number;
  /** In-memory result cache TTL. 0 disables the cache. */
  cacheTtlMs: number;
  /** Fall back to general knowledge when the corpus has no evidence. KNOWLEDGE_FALLBACK=0 turns it off. */
  knowledgeFallback: boolean;
  /** Minimum confidence for a general-knowledge verdict. */
  knowledgeMinConfidence: number;
};

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number, got "${raw}"`);
  return value;
}

/** Returns null when live mode is not configured (missing key or database). */
export function loadLiveConfig(): LiveConfig | null {
  const openaiApiKey = process.env.OPENAI_API_KEY ?? '';
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!openaiApiKey || !databaseUrl) return null;

  return {
    openaiApiKey,
    databaseUrl,
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    // Must match the vector(N) column in db/migrations/001_facts.sql.
    embeddingDimensions: num('EMBEDDING_DIMENSIONS', 1536),
    decisionsModel: process.env.DECISIONS_MODEL || 'gpt-6-luna',
    topK: num('FACT_TOP_K', 5),
    minSimilarity: num('FACT_MIN_SIMILARITY', 0.35),
    minRelevance: num('VERDICT_MIN_RELEVANCE', 0.5),
    minConfidence: num('VERDICT_MIN_CONFIDENCE', 0.6),
    openaiTimeoutMs: num('OPENAI_TIMEOUT_MS', 2500),
    cacheTtlMs: num('FACT_CHECK_CACHE_TTL_MS', 10 * 60 * 1000),
    knowledgeFallback: process.env.KNOWLEDGE_FALLBACK !== '0',
    knowledgeMinConfidence: num('KNOWLEDGE_MIN_CONFIDENCE', 0.7),
  };
}
