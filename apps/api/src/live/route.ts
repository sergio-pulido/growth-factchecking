// Live route. Lives next to the mock route instead of replacing it, so the UX demo keeps working.
import { CLAIM_MAX_LENGTH, FACT_CHECK_PATH } from '@growth-factcheking/shared';
import type { FactCheckRequest } from '@growth-factcheking/shared';
import type { FastifyInstance } from 'fastify';
import { loadLiveConfig } from './config.js';
import { createPool, createFactSearch } from './fact-store.js';
import { createDecider, createEmbedder, createOpenAIClient } from './openai.js';
import { createFactChecker } from './pipeline.js';
import type { FactChecker } from './pipeline.js';

export const LIVE_FACT_CHECK_PATH = `${FACT_CHECK_PATH}/live`;

export function registerLiveFactCheck(app: FastifyInstance, injected?: FactChecker): void {
  let check = injected;

  if (!check) {
    const config = loadLiveConfig();
    if (config) {
      const client = createOpenAIClient(config);
      const pool = createPool(config.databaseUrl);
      app.addHook('onClose', async () => pool.end());
      check = createFactChecker({
        embed: createEmbedder(client, config),
        search: createFactSearch(pool, config.minSimilarity),
        decide: createDecider(client, config),
        topK: config.topK,
        thresholds: { minRelevance: config.minRelevance, minConfidence: config.minConfidence },
        // Never reuse a verdict here: every X card and panel check runs the full pipeline, so the demo
        // shows real latency on each load. FACT_CHECK_CACHE_TTL_MS still applies to conversation capture.
        cacheTtlMs: 0,
      });
    } else {
      app.log.warn('Live fact-check disabled: set OPENAI_API_KEY and DATABASE_URL.');
    }
  }

  app.post<{ Body: FactCheckRequest }>(
    LIVE_FACT_CHECK_PATH,
    {
      schema: {
        body: {
          type: 'object',
          required: ['claim'],
          properties: { claim: { type: 'string', maxLength: CLAIM_MAX_LENGTH, pattern: '\\S' } },
        },
      },
    },
    async (request, reply) => {
      reply.header('X-Fact-Check-Mode', 'live');
      if (!check) {
        return reply.code(503).send({ message: 'Live fact-check is not configured on this server.' });
      }
      try {
        const { result, meta } = await check(request.body.claim);
        const t = meta.timings;
        reply.header(
          'Server-Timing',
          `embed;dur=${t.embedMs.toFixed(0)}, search;dur=${t.searchMs.toFixed(0)}, decide;dur=${t.decideMs.toFixed(0)}, total;dur=${t.totalMs.toFixed(0)}`,
        );
        request.log.info({ factCheck: meta }, 'fact-check');
        return result;
      } catch (error) {
        request.log.error(error, 'fact-check failed');
        return reply.code(503).send({ message: 'Fact-check service unavailable. Try again.' });
      }
    },
  );
}
