import { VERDICTS } from '@growth-factcheking/shared';
import type { MeetCheckResult, Verdict } from '@growth-factcheking/shared';

type PitchCase = Pick<MeetCheckResult['checks'][number], 'claim' | 'sources'>;
export type DecidePitch = (claims: readonly PitchCase[]) => Promise<Verdict[]>;

export class DecisionsHttpError extends Error {
  constructor(readonly statusCode: number) {
    super(`OpenAI Decisions respondió con HTTP ${statusCode}.`);
  }
}

const descriptions: Record<Verdict, string> = {
  yes: 'La evidencia confirma la afirmación completa.',
  probably_yes: 'La evidencia favorece la afirmación, pero quedan lagunas.',
  neutral: 'La evidencia es insuficiente, contradictoria o irrelevante.',
  probably_no: 'La evidencia apunta en contra, pero quedan lagunas.',
  no: 'La evidencia contradice la afirmación directamente.',
};

export function createPitchDecider(apiKey: string, send = fetch): DecidePitch {
  return async (claims) => {
    const cases = claims.map(({ claim, sources }, index) => ({
      id: `claim_${index + 1}`,
      claim,
      evidence: sources.map(({ statement }) => statement),
    }));

    const response = await send('https://api.openai.com/v1/decisions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        model: 'gpt-6-luna',
        input: [{
          role: 'user',
          content: [{ type: 'input_json', data: { cases } }],
        }],
        questions: cases.map(({ id }) => ({
          name: id,
          type: 'choice',
          instructions: `Clasifica únicamente el caso ${id}. Usa solo su evidencia. Comprueba fechas, cantidades y alcance. Si los datos no permiten decidir, elige neutral.`,
          choices: VERDICTS.map((value) => ({ value, description: descriptions[value] })),
        })),
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new DecisionsHttpError(response.status);
    }

    const payload: unknown = await response.json();
    if (typeof payload !== 'object' || payload === null || !('answers' in payload) || !Array.isArray(payload.answers)) {
      throw new Error('OpenAI Decisions devolvió un formato inválido.');
    }

    const answers: unknown[] = payload.answers;
    return cases.map(({ id }) => {
      for (const answer of answers) {
        if (typeof answer !== 'object' || answer === null || !('name' in answer) || answer.name !== id) continue;
        if (!('type' in answer) || answer.type !== 'choice' || !('choice' in answer)) break;
        const verdict = VERDICTS.find((value) => value === answer.choice);
        if (verdict) return verdict;
        break;
      }
      throw new Error(`OpenAI Decisions no devolvió un veredicto válido para ${id}.`);
    });
  };
}
