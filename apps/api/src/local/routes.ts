import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { FactInput, MockFactsBackend } from './backend.js';

const claimSchema = {
  type: 'object', required: ['claim'], additionalProperties: false,
  properties: { claim: { type: 'string', maxLength: 1000, pattern: '\\S' } },
};

export function registerLocalRoutes(app: FastifyInstance, backend: MockFactsBackend) {
  app.get('/', async (_request, reply) => reply.type('text/html').send(
    await readFile(new URL('../../public/index.html', import.meta.url), 'utf8'),
  ));
  app.get('/local.js', async (_request, reply) => reply.type('application/javascript').send(
    await readFile(new URL('../../public/local.js', import.meta.url), 'utf8'),
  ));
  app.get('/api/facts', async () => ({ mode: 'mock', facts: backend.list() }));
  app.post<{ Body: { facts: FactInput[] } }>('/api/facts/ingest', {
    schema: { body: {
      type: 'object', required: ['facts'], additionalProperties: false,
      properties: { facts: {
        type: 'array', minItems: 1, maxItems: 100,
        items: {
          type: 'object', required: ['id', 'statement', 'sourceUrl'], additionalProperties: false,
          properties: {
            id: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-zA-Z0-9_-]+$' },
            statement: { type: 'string', maxLength: 1000, pattern: '\\S' },
            sourceUrl: { type: 'string', maxLength: 2048, pattern: '^https?://', format: 'uri' },
          },
        },
      } },
    } },
  }, async (request, reply) => {
    if (new Set(request.body.facts.map(({ id }) => id)).size !== request.body.facts.length) {
      return reply.code(400).send({ message: 'Duplicate fact ids within one batch.' });
    }
    return backend.ingest(request.body.facts);
  });
  app.post<{ Body: { claim: string } }>('/api/facts/search', { schema: { body: claimSchema } }, async (request) => ({
    mode: 'mock', matches: backend.search(request.body.claim),
  }));
}
