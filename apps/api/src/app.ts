import { FACT_CHECK_PATH } from '@growth-factcheking/shared';
import Fastify from 'fastify';

export function createApp(logger = true) {
  const app = Fastify({ logger });

  app.get('/health', async () => ({ status: 'ok' }));
  app.post(FACT_CHECK_PATH, async (_request, reply) => {
    return reply.code(501).send({ message: 'La verificación todavía no está implementada.' });
  });

  return app;
}
