// Builds the live fact-check dependencies (OpenAI client, Postgres pool, checker) from one config.
// The caller owns the pool and must end it on shutdown.
import type OpenAI from 'openai';
import type pg from 'pg';
import type { LiveConfig } from './config.js';
import { createFactSearch, createPool } from './fact-store.js';
import { createDecider, createEmbedder, createKnowledgeDecider, createOpenAIClient } from './openai.js';
import { createFactChecker } from './pipeline.js';
import type { FactChecker } from './pipeline.js';

export type LiveServices = { client: OpenAI; pool: pg.Pool; check: FactChecker };

export function createLiveServices(config: LiveConfig): LiveServices {
  const client = createOpenAIClient(config);
  const pool = createPool(config.databaseUrl);
  const check = createFactChecker({
    embed: createEmbedder(client, config),
    search: createFactSearch(pool, config.minSimilarity),
    decide: createDecider(client, config),
    topK: config.topK,
    thresholds: { minRelevance: config.minRelevance, minConfidence: config.minConfidence },
    ...(config.knowledgeFallback ? { knowledge: createKnowledgeDecider(client, config) } : {}),
    knowledgeMinConfidence: config.knowledgeMinConfidence,
    cacheTtlMs: config.cacheTtlMs,
  });
  return { client, pool, check };
}
