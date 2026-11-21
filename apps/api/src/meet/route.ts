import { MEET_DEMO_PATH, MEET_JUDGES, MEET_TRANSCRIPT } from '@growth-factcheking/shared';
import type { MeetCheckRequest, MeetCheckResult } from '@growth-factcheking/shared';
import type { FastifyInstance } from 'fastify';
import { DecisionsHttpError } from './decisions.js';
import type { DecidePitch } from './decisions.js';
import { extractPitchClaims } from './pitch.js';

export function registerMeetDemo(app: FastifyInstance, decide?: DecidePitch): void {
  app.post<{ Body: MeetCheckRequest }>(
    MEET_DEMO_PATH,
    {
      onRequest: async (request, reply) => {
        if (request.hostname !== '127.0.0.1' && request.hostname !== 'localhost') {
          return reply.code(403).send({ message: 'La demo solo admite conexiones locales.' });
        }
      },
      schema: {
        body: {
          type: 'object',
          required: ['turnId', 'mode'],
          properties: {
            turnId: { type: 'string', enum: MEET_TRANSCRIPT.map(({ id }) => id) },
            mode: { type: 'string', enum: MEET_JUDGES },
          },
        },
      },
    },
    async (request, reply) => {
      const { turnId, mode } = request.body;
      const turn = MEET_TRANSCRIPT.find(({ id }) => id === turnId);
      if (!turn) return reply.code(400).send({ message: 'El turno de la demo no existe.' });

      const checks: MeetCheckResult['checks'] = extractPitchClaims(turn).map(
        ({ claim, sources, expectedVerdict }) => ({
          claim,
          sources,
          verdict: mode === 'mock' ? expectedVerdict : 'neutral',
        }),
      );
      const claimsWithEvidence = checks.filter(({ sources }) => sources.length > 0);
      if (mode === 'mock' || claimsWithEvidence.length === 0) {
        return { checks };
      }
      if (!decide) {
        return reply.code(503).send({ message: 'Configura OPENAI_API_KEY en la API local para usar Decisions.' });
      }

      try {
        const verdicts = await decide(claimsWithEvidence);
        if (verdicts.length !== claimsWithEvidence.length) {
          throw new Error('Decisions devolvió un número incorrecto de veredictos.');
        }
        for (const [index, verdict] of verdicts.entries()) {
          claimsWithEvidence[index].verdict = verdict;
        }
        return { checks };
      } catch (error) {
        request.log.warn({ err: error }, 'Falló Decisions en la demo de Meet.');
        if (error instanceof DecisionsHttpError && error.statusCode === 401) {
          return reply.code(503).send({
            message: 'OpenAI rechazó la clave. Actualiza OPENAI_API_KEY en .env y reinicia la API local.',
          });
        }
        return reply.code(502).send({ message: 'No se pudo obtener un veredicto de Decisions para este turno.' });
      }
    },
  );
}
