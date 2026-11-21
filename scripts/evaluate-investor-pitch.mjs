import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { createApp } from '../apps/api/dist/app.js';
import { loadConversationConfig } from '../apps/api/dist/conversations/config.js';
import { loadLiveConfig } from '../apps/api/dist/live/config.js';
import { createOpenAIClient } from '../apps/api/dist/live/openai.js';
import { evaluateRelevance } from './investor-pitch-relevance.mjs';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const fixtures = resolve(root, 'data/demo/investor-pitch');
const pitch = JSON.parse(await readFile(resolve(fixtures, 'pitch.json'), 'utf8'));
const facts = JSON.parse(await readFile(resolve(fixtures, 'facts.json'), 'utf8'));
const utteranceStart = Date.parse('2026-11-21T11:00:00Z');
const compare = process.argv.includes('--compare');

async function docker(...args) {
  return (await run('docker', args, { timeout: 120_000 })).stdout.trim();
}

async function prepareDatabase(container) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const running = await docker('inspect', '--format', '{{.State.Health.Status}}', container);
    if (running === 'healthy') break;
    if (running === 'unhealthy' || attempt === 29) throw new Error('Evaluation database did not become ready');
    await delay(1000);
  }
  const address = await docker('port', container, '5432/tcp');
  if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error('Expected a loopback address for the evaluation database');
  process.env.DATABASE_URL = `postgres://pitch_eval:pitch_eval@${address}/pitch_eval`;
  process.env.FACT_CHECK_CACHE_TTL_MS = '0';
  for (const args of [
    ['apps/api/dist/scripts/migrate.js'],
    ['apps/api/dist/scripts/seed.js', resolve(fixtures, 'facts.json')],
  ]) {
    await run(process.execPath, args, { cwd: root, timeout: 180_000 });
  }
}

async function api(origin, path, method = 'GET', body) {
  const start = performance.now();
  const response = await fetch(origin + path, {
    method,
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return { data, latencyMs: Math.round(performance.now() - start) };
}

function toUtterance({ id, speaker, text, seconds }) {
  return {
    clientId: id, speaker, speakerKind: 'named', text,
    spokenAt: new Date(utteranceStart + seconds * 1000).toISOString(),
  };
}

function sourceMatches(expected, actual) {
  if (!actual) return false;
  if (expected.sourceId === null) return actual.sources.length === 0;
  const fact = facts.find(({ id }) => id === expected.sourceId);
  if (!fact) throw new Error(`Unknown fixture source ${expected.sourceId}`);
  return actual.sources.some(({ sourceUrl, statement }) => sourceUrl === fact.sourceUrl && statement === fact.statement);
}

async function evaluatePitch() {
  const config = loadLiveConfig();
  const conversationConfig = loadConversationConfig();
  const client = createOpenAIClient({ ...config, openaiTimeoutMs: 15_000 });
  const logger = process.env.PITCH_EVAL_LOG === '1' ? { level: 'warn', stream: process.stderr } : false;
  const app = createApp(logger);
  try {
    const origin = await app.listen({ port: 0, host: '127.0.0.1' });
    const { data: { id } } = await api(origin, '/api/conversations', 'POST', {
      platform: 'meet', capture: 'captions', title: pitch.title, language: pitch.language,
    });
    const path = `/api/conversations/${id}`;
    const batches = [];
    for (const [index, batch] of pitch.batches.entries()) {
      const { data, latencyMs } = await api(origin, path + '/utterances', 'POST', {
        utterances: batch.map(toUtterance),
      });
      batches.push({
        batch: index + 1, ids: batch.map(({ id: turnId }) => turnId),
        latencyMs, accepted: data.accepted, duplicates: data.duplicates,
        extraction: data.extraction, claims: data.claims.length,
      });
    }
    await api(origin, path + '/end', 'POST');
    const { data: result } = await api(origin, path);
    async function assess(claim, strategy) {
      try {
        return await evaluateRelevance(client, config.decisionsModel, claim, result.utterances, strategy);
      } catch (error) {
        return { error: error.name, httpStatus: error.status ?? null };
      }
    }
    const verdicts = await Promise.all(result.claims.map(async (claim) => {
      const relevance = await assess(claim, 'paired');
      const independent = compare ? { independentRelevance: await assess(claim, 'independent') } : {};
      return { ...claim, relevance, ...independent };
    }));
    const cases = pitch.batches.flat().map(({ id: turnId, text, expected }) => {
      const actual = verdicts.filter(({ utteranceClientId }) => utteranceClientId === turnId);
      const found = actual[0];
      return {
        id: turnId, text, expected: expected ?? null, actual,
        extractionMatches: actual.length === (expected ? 1 : 0),
        ...(expected ? {
          verdictMatches: found?.verdict === expected.verdict,
          sourceMatches: sourceMatches(expected, found),
          relevanceMatches: Boolean(found?.relevance && !found.relevance.error && found.relevance.level === expected.relevance),
          contextMatches: Boolean(found?.relevance && !found.relevance.error
            && (found.relevance.context?.id ?? null) === expected.contextId),
        } : {}),
      };
    });
    return {
      runAt: new Date().toISOString(),
      model: config.decisionsModel,
      settings: {
        embeddingModel: config.embeddingModel,
        extractionModel: conversationConfig.extraction.model,
        extractionEffort: conversationConfig.extraction.reasoningEffort,
        extractionTimeoutMs: conversationConfig.extractionTimeoutMs,
        factCheckTimeoutMs: config.openaiTimeoutMs,
        cacheTtlMs: config.cacheTtlMs,
      },
      storedUtterances: result.utterances.length,
      batches,
      cases,
    };
  } finally {
    await app.close();
  }
}

if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('Configure OPENAI_API_KEY before running the evaluation');

const container = await docker(
  'run', '--rm', '--detach', '--publish', '127.0.0.1::5432',
  '--env', 'POSTGRES_USER=pitch_eval', '--env', 'POSTGRES_PASSWORD=pitch_eval', '--env', 'POSTGRES_DB=pitch_eval',
  '--health-cmd', 'pg_isready -U pitch_eval -d pitch_eval -h 127.0.0.1', '--health-interval', '1s',
  'pgvector/pgvector:pg17',
);
try {
  await prepareDatabase(container);
  console.log(JSON.stringify(await evaluatePitch(), null, 2));
} finally {
  await docker('stop', container);
}
