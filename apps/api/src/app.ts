import { CLAIM_MAX_LENGTH, DEMO_SCENARIOS, FACT_CHECK_PATH } from '@growth-factcheking/shared';
import type { DemoScenario, FactCheckRequest } from '@growth-factcheking/shared';
import Fastify from 'fastify';
import { mockResults } from './mock-facts.js';
import { createPitchDecider } from './meet/decisions.js';
import { registerMeetDemo } from './meet/route.js';
import { registerLiveFactCheck } from './live/route.js';

export function createApp(logger = true) {
  const app = Fastify({ logger, ajv: { customOptions: { coerceTypes: false } } });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post<{ Body: FactCheckRequest; Querystring: { scenario?: DemoScenario } }>(
    FACT_CHECK_PATH,
    {
      schema: {
        body: {
          type: 'object',
          required: ['claim'],
          properties: {
            claim: { type: 'string', maxLength: CLAIM_MAX_LENGTH, pattern: '\\S' },
          },
        },
        querystring: {
          type: 'object',
          properties: { scenario: { type: 'string', enum: DEMO_SCENARIOS } },
        },
      },
    },
    async (request, reply) => {
      const { scenario = 'no_evidence' } = request.query;
      reply.header('X-Fact-Check-Mode', 'mock');

      if (scenario === 'error') {
        return reply.code(503).send({ message: 'Error simulado. Vuelve a intentarlo.' });
      }

      return mockResults[scenario];
    },
  );

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  registerMeetDemo(app, apiKey ? createPitchDecider(apiKey) : undefined);
  registerLiveFactCheck(app);

  return app;
}
