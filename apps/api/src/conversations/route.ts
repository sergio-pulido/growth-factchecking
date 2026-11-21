// Conversation capture routes. Spec: docs/specs/conversation-capture.md
import {
  CAPTURE_METHODS,
  CLIENT_ID_PATTERN,
  CONVERSATIONS_PATH,
  PLATFORM_PATTERN,
  SPEAKER_KINDS,
  SPEAKER_MAX,
  TRANSCRIPTION_TOKEN_PATH,
  UTTERANCE_BATCH_MAX,
  UTTERANCE_TEXT_MAX,
} from '@growth-factcheking/shared';
import type {
  ConversationCreateRequest,
  TranscriptionTokenRequest,
  UtteranceBatchRequest,
} from '@growth-factcheking/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { loadLiveConfig } from '../live/config.js';
import { createOpenAIClient } from '../live/openai.js';
import { createLiveServices } from '../live/services.js';
import { loadConversationConfig } from './config.js';
import { createClaimExtractor } from './extractor.js';
import { ConversationClosedError, createIngest } from './service.js';
import type { Ingest } from './service.js';
import { createConversationStore } from './store.js';
import { createTokenMinter } from './transcription-token.js';
import type { TokenMinter } from './transcription-token.js';
import type { ConversationStore } from './types.js';

export type ConversationServices = { store: ConversationStore; ingest: Ingest; mintToken: TokenMinter };

const LANGUAGE = { type: 'string', pattern: '^[a-z]{2}$' } as const;
const ID_PARAMS = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', maxLength: 64 } },
} as const;

const createBody = {
  type: 'object',
  required: ['platform', 'capture'],
  additionalProperties: false,
  properties: {
    platform: { type: 'string', pattern: PLATFORM_PATTERN },
    capture: { type: 'string', enum: CAPTURE_METHODS },
    title: { type: 'string', minLength: 1, maxLength: 300 },
    pageUrl: { type: 'string', maxLength: 2048, pattern: '^https?://' },
    language: LANGUAGE,
  },
} as const;

const utterancesBody = {
  type: 'object',
  required: ['utterances'],
  additionalProperties: false,
  properties: {
    utterances: {
      type: 'array',
      minItems: 1,
      maxItems: UTTERANCE_BATCH_MAX,
      items: {
        type: 'object',
        required: ['clientId', 'speaker', 'speakerKind', 'text', 'spokenAt'],
        additionalProperties: false,
        properties: {
          clientId: { type: 'string', pattern: CLIENT_ID_PATTERN },
          speaker: { type: 'string', minLength: 1, maxLength: SPEAKER_MAX, pattern: '\\S' },
          speakerKind: { type: 'string', enum: SPEAKER_KINDS },
          text: { type: 'string', minLength: 1, maxLength: UTTERANCE_TEXT_MAX, pattern: '\\S' },
          // ISO 8601 with time; parsed again below.
          spokenAt: { type: 'string', maxLength: 40, pattern: '^\\d{4}-\\d{2}-\\d{2}T' },
        },
      },
    },
  },
} as const;

function notConfigured(reply: FastifyReply) {
  return reply.code(503).send({ message: 'Conversation capture is not configured on this server.' });
}

/** Builds the real services from the environment, or null when OpenAI or Postgres is not configured. */
function buildServices(app: FastifyInstance): ConversationServices | null {
  const live = loadLiveConfig();
  if (!live) return null;
  const config = loadConversationConfig();
  // Own client for call fact-checks: longer timeout and one retry (see ConversationConfig.checkTimeoutMs).
  const { pool, check } = createLiveServices({ ...live, openaiTimeoutMs: config.checkTimeoutMs, openaiMaxRetries: config.checkRetries });
  app.addHook('onClose', async () => pool.end());
  // Separate client: the fact-check client uses a short real-time timeout that extraction can exceed.
  const client = createOpenAIClient({ ...live, openaiTimeoutMs: config.extractionTimeoutMs });
  const store = createConversationStore(pool);
  return {
    store,
    mintToken: createTokenMinter(client, config.transcriptionModel, config.transcriptionTokenTtlSeconds),
    ingest: createIngest({
      store,
      extract: createClaimExtractor(client, config.extraction),
      check,
      contextSize: config.contextSize,
      checkConcurrency: config.checkConcurrency,
      onError: (stage, error) => app.log.error({ err: error, stage }, 'conversation ingest step failed'),
    }),
  };
}

export function registerConversations(app: FastifyInstance, injected?: ConversationServices): void {
  const services = injected ?? buildServices(app);
  if (!services) app.log.warn('Conversation capture disabled: set OPENAI_API_KEY and DATABASE_URL.');

  app.post<{ Body: ConversationCreateRequest }>(CONVERSATIONS_PATH, { schema: { body: createBody } }, async (request, reply) => {
    if (!services) return notConfigured(reply);
    const id = await services.store.create(request.body);
    return reply.code(201).send({ id });
  });

  app.post<{ Params: { id: string }; Body: UtteranceBatchRequest }>(
    `${CONVERSATIONS_PATH}/:id/utterances`,
    { schema: { params: ID_PARAMS, body: utterancesBody } },
    async (request, reply) => {
      if (!services) return notConfigured(reply);
      const utterances = request.body.utterances;
      if (utterances.some(({ spokenAt }) => Number.isNaN(Date.parse(spokenAt)))) {
        return reply.code(400).send({ message: 'spokenAt must be an ISO 8601 timestamp.' });
      }
      try {
        return await services.ingest(request.params.id, utterances);
      } catch (error) {
        if (error instanceof ConversationClosedError) {
          return error.state === 'missing'
            ? reply.code(404).send({ message: 'Conversation not found.' })
            : reply.code(409).send({ message: 'Conversation has ended.' });
        }
        request.log.error(error, 'utterance ingest failed');
        return reply.code(503).send({ message: 'Could not store the utterances. Try again.' });
      }
    },
  );

  app.get<{ Params: { id: string } }>(`${CONVERSATIONS_PATH}/:id`, { schema: { params: ID_PARAMS } }, async (request, reply) => {
    if (!services) return notConfigured(reply);
    const view = await services.store.view(request.params.id);
    return view ?? reply.code(404).send({ message: 'Conversation not found.' });
  });

  app.post<{ Params: { id: string } }>(`${CONVERSATIONS_PATH}/:id/end`, { schema: { params: ID_PARAMS } }, async (request, reply) => {
    if (!services) return notConfigured(reply);
    const ended = await services.store.end(request.params.id);
    return ended ? reply.code(204).send() : reply.code(404).send({ message: 'Conversation not found.' });
  });

  app.delete<{ Params: { id: string } }>(`${CONVERSATIONS_PATH}/:id`, { schema: { params: ID_PARAMS } }, async (request, reply) => {
    if (!services) return notConfigured(reply);
    const removed = await services.store.remove(request.params.id);
    return removed ? reply.code(204).send() : reply.code(404).send({ message: 'Conversation not found.' });
  });

  app.post<{ Body: TranscriptionTokenRequest }>(
    TRANSCRIPTION_TOKEN_PATH,
    {
      schema: {
        body: { type: 'object', additionalProperties: false, properties: { language: LANGUAGE } },
      },
    },
    async (request, reply) => {
      if (!services) return notConfigured(reply);
      try {
        // The secret is returned to the local extension only; it is never logged.
        return await services.mintToken(request.body?.language);
      } catch (error) {
        request.log.error({ err: error }, 'transcription token failed');
        return reply.code(503).send({ message: 'Live transcription is unavailable. Try again.' });
      }
    },
  );
}
