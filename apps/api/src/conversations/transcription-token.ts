// Short-lived Realtime client secret for a transcription-only session. The extension streams tab audio
// straight to OpenAI with it, so audio never reaches this API and the API key never leaves the server.
import type { TranscriptionTokenResult } from '@growth-factcheking/shared';
import type OpenAI from 'openai';

export type TokenMinter = (language?: string) => Promise<TranscriptionTokenResult>;

export function createTokenMinter(client: OpenAI, model: string, ttlSeconds: number): TokenMinter {
  return async (language) => {
    const secret = await client.realtime.clientSecrets.create({
      expires_after: { anchor: 'created_at', seconds: ttlSeconds },
      session: {
        type: 'transcription',
        audio: {
          input: {
            // `languages` is the hint supported by gpt-transcribe / gpt-live-transcribe.
            transcription: { model, ...(language ? { languages: [language] } : {}) },
          },
        },
      },
    });
    return { value: secret.value, expiresAt: secret.expires_at, model };
  };
}
