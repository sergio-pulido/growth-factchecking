import { CLAIM_MAX_LENGTH, DEMO_SCENARIOS, FACT_CHECK_PATH } from '@growth-factcheking/shared';
import type { DemoScenario, FactCheckRequest } from '@growth-factcheking/shared';
import Fastify from 'fastify';
import { registerLocalRoutes } from './local/routes.js';
import { MockFactsBackend } from './local/backend.js';
import { mockResults } from './mock-facts.js';
import { createPitchDecider } from './meet/decisions.js';
import { registerMeetDemo } from './meet/route.js';
import { registerLiveFactCheck } from './live/route.js';
import { registerConversations } from './conversations/route.js';
import { registerFavicons } from './favicons.js';

export function createApp(logger = true, backend = new MockFactsBackend()) {
  const app = Fastify({ logger, ajv: { customOptions: { coerceTypes: false, removeAdditional: false } } });

  registerLocalRoutes(app, backend);

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
      const { scenario } = request.query;
      reply.header('X-Fact-Check-Mode', 'mock');

      if (!scenario) return backend.check(request.body.claim);

      if (scenario === 'error') {
        return reply.code(503).send({ message: 'Error simulado. Vuelve a intentarlo.' });
      }

      return mockResults[scenario];
    },
  );

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  registerMeetDemo(app, apiKey ? createPitchDecider(apiKey) : undefined);
  registerLiveFactCheck(app);
  registerConversations(app);
  registerFavicons(app);

  return app;
}
