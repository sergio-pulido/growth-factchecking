import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { CONVERSATIONS_PATH, TRANSCRIPTION_TOKEN_PATH } from '@growth-factcheking/shared';
import { createIngest } from '../dist/conversations/service.js';
import { createClaimExtractor, parseExtraction, MAX_CLAIMS_PER_BATCH } from '../dist/conversations/extractor.js';
import { registerConversations } from '../dist/conversations/route.js';
import { isConversationId } from '../dist/conversations/store.js';

const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function memoryStore() {
  const conversations = new Map();
  const utterances = [];
  const claims = [];
  let seq = 0;
  return {
    utterances,
    claims,
    conversations,
    async create(input) { conversations.set(ID, { ...input, ended: false }); return ID; },
    async state(id) { const c = conversations.get(id); return !c ? 'missing' : c.ended ? 'ended' : 'open'; },
    async addUtterances(conversationId, batch) {
      const inserted = [];
      for (const u of batch) {
        if (utterances.some((x) => x.conversationId === conversationId && x.clientId === u.clientId)) continue;
        const row = { ...u, conversationId, id: String(++seq) };
        utterances.push(row);
        inserted.push(row);
      }
      return inserted;
    },
    async contextBefore(conversationId, excludeIds, limit) {
      return utterances.filter((u) => u.conversationId === conversationId && !excludeIds.includes(u.id)).slice(-limit);
    },
    async saveClaims(_conversationId, records) {
      return records.map((r) => {
        const u = utterances.find((x) => x.id === r.utteranceId);
        const saved = {
          id: String(claims.length + 1),
          claim: r.claim,
          speaker: u.speaker,
          utteranceClientId: u.clientId,
          status: r.check ? 'checked' : 'failed',
          verdict: r.check?.result.verdict ?? null,
          sources: r.check?.result.sources ?? [],
        };
        claims.push(saved);
        return saved;
      });
    },
    async end(id) { const c = conversations.get(id); if (!c) return false; c.ended = true; return true; },
    async remove(id) { return conversations.delete(id); },
    async view(id) { return conversations.has(id) ? { id, utterances, claims } : null; },
  };
}

const utt = (clientId, speaker, text) => ({
  clientId, speaker, speakerKind: 'named', text, spokenAt: '2026-11-21T10:00:00.000Z',
});

const liveCheck = (verdict) => ({
  result: { verdict, sources: [{ statement: 'S', sourceUrl: 'https://example.org/s' }] },
  meta: { verdict, reason: 'decided', relevance: 1, confidence: 1, evidenceCount: 1, cached: false, timings: {} },
});

function setup(overrides = {}) {
  const store = memoryStore();
  const calls = { extract: [], check: [] };
  const ingest = createIngest({
    store,
    extract: async (utterances, context) => {
      calls.extract.push({ utterances, context });
      return utterances.filter((u) => /\d/.test(u.text)).map((u) => ({ utteranceId: u.id, claim: u.text }));
    },
    check: async (claim) => { calls.check.push(claim); return liveCheck('no'); },
    contextSize: 2,
    checkConcurrency: 2,
    ...overrides,
  });
  return { store, calls, ingest };
}

test('ingest stores utterances, extracts claims and checks each one', async () => {
  const { store, calls, ingest } = setup();
  await store.create({ platform: 'meet', capture: 'captions' });
  const out = await ingest(ID, [utt('a', 'Ana', 'Hi all'), utt('b', 'Ben', 'We have 42 customers')]);
  assert.equal(out.accepted, 2);
  assert.equal(out.duplicates, 0);
  assert.equal(out.extraction, 'ok');
  assert.deepEqual(out.claims.map((c) => [c.claim, c.speaker, c.verdict, c.utteranceClientId]), [
    ['We have 42 customers', 'Ben', 'no', 'b'],
  ]);
  assert.deepEqual(calls.check, ['We have 42 customers']);
  assert.equal(store.utterances.length, 2);
});

test('re-sent utterances are no-ops and skip extraction', async () => {
  const { store, calls, ingest } = setup();
  await store.create({ platform: 'meet', capture: 'captions' });
  await ingest(ID, [utt('a', 'Ana', 'Revenue was 10k')]);
  const again = await ingest(ID, [utt('a', 'Ana', 'Revenue was 10k')]);
  assert.deepEqual(again, { accepted: 0, duplicates: 1, extraction: 'skipped', claims: [] });
  assert.equal(calls.extract.length, 1);
});

test('extraction gets earlier utterances as context only', async () => {
  const { store, calls, ingest } = setup();
  await store.create({ platform: 'meet', capture: 'captions' });
  await ingest(ID, [utt('a', 'Ana', 'one'), utt('b', 'Ben', 'two'), utt('c', 'Cy', 'three')]);
  await ingest(ID, [utt('d', 'Dee', 'It grew 3x')]);
  const last = calls.extract.at(-1);
  assert.deepEqual(last.utterances.map((u) => u.clientId), ['d']);
  assert.deepEqual(last.context.map((u) => u.clientId), ['b', 'c']);
});

test('extraction failure keeps the transcript', async () => {
  const errors = [];
  const { store, ingest } = setup({
    extract: async () => { throw new Error('model down'); },
    onError: (stage) => errors.push(stage),
  });
  await store.create({ platform: 'meet', capture: 'captions' });
  const out = await ingest(ID, [utt('a', 'Ana', 'We have 42 customers')]);
  assert.equal(out.extraction, 'failed');
  assert.equal(out.accepted, 1);
  assert.equal(store.utterances.length, 1);
  assert.deepEqual(errors, ['extract']);
});

test('a failed check is stored as failed without a verdict', async () => {
  const { store, ingest } = setup({
    check: async (claim) => { if (claim.includes('42')) throw new Error('timeout'); return liveCheck('yes'); },
  });
  await store.create({ platform: 'meet', capture: 'captions' });
  const out = await ingest(ID, [utt('a', 'Ana', 'We have 42 customers'), utt('b', 'Ben', 'Founded in 2019')]);
  assert.deepEqual(out.claims.map((c) => [c.status, c.verdict]), [['failed', null], ['checked', 'yes']]);
});

test('checks run with bounded concurrency', async () => {
  let inFlight = 0;
  let peak = 0;
  const { store, ingest } = setup({
    check: async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return liveCheck('neutral');
    },
  });
  await store.create({ platform: 'meet', capture: 'captions' });
  const batch = Array.from({ length: 6 }, (_, i) => utt(`u${i}`, 'Ana', `Claim number ${i}`));
  const out = await ingest(ID, batch);
  assert.equal(out.claims.length, 6);
  assert.equal(peak, 2);
});

test('parseExtraction maps refs, trims, dedupes and drops unknown refs', () => {
  const refs = new Map([['u1', '10'], ['u2', '11']]);
  const raw = JSON.stringify({ claims: [
    { ref: 'u1', claim: '  The tower   is in Rome ' },
    { ref: 'u1', claim: 'the tower is in rome' },
    { ref: 'u9', claim: 'Unknown ref' },
    { ref: 'u2', claim: '' },
    { ref: 'u2', claim: 'We have 42 customers' },
  ] });
  assert.deepEqual(parseExtraction(raw, refs), [
    { utteranceId: '10', claim: 'The tower is in Rome' },
    { utteranceId: '11', claim: 'We have 42 customers' },
  ]);
  assert.throws(() => parseExtraction('{"nope":1}', refs), /unexpected shape/);
  const many = JSON.stringify({ claims: Array.from({ length: 30 }, (_, i) => ({ ref: 'u1', claim: `c${i}` })) });
  assert.equal(parseExtraction(many, refs).length, MAX_CLAIMS_PER_BATCH);
});

test('extractor sends refs, context and a strict schema, and does not store the transcript', async () => {
  let sent;
  const client = { responses: { create: async (body) => { sent = body; return { output_text: '{"claims":[{"ref":"u1","claim":"X is 5"}]}' }; } } };
  const extract = createClaimExtractor(client, { model: 'test-model' });
  const out = await extract(
    [{ id: '7', clientId: 'b', speaker: 'Ben', speakerKind: 'named', text: 'It is 5', spokenAt: '' }],
    [{ id: '6', clientId: 'a', speaker: 'Ana', speakerKind: 'named', text: 'What is X?', spokenAt: '' }],
  );
  assert.deepEqual(out, [{ utteranceId: '7', claim: 'X is 5' }]);
  assert.equal(sent.model, 'test-model');
  assert.equal(sent.store, false);
  assert.equal(sent.text.format.type, 'json_schema');
  assert.equal(sent.text.format.strict, true);
  assert.deepEqual(JSON.parse(sent.input), {
    context: [{ speaker: 'Ana', text: 'What is X?' }],
    new: [{ ref: 'u1', speaker: 'Ben', text: 'It is 5' }],
  });
  assert.equal('reasoning' in sent, false);
});

test('isConversationId only accepts UUIDs', () => {
  assert.equal(isConversationId(ID), true);
  assert.equal(isConversationId('1; DROP TABLE x'), false);
});

async function appWith(services) {
  // Same validator options as createApp in src/app.ts.
  const app = Fastify({ logger: false, ajv: { customOptions: { coerceTypes: false, removeAdditional: false } } });
  registerConversations(app, services);
  await app.ready();
  return app;
}

function routeServices(overrides = {}) {
  const { store, ingest } = setup();
  return { store, ingest, mintToken: async (language) => ({ value: 'ek_test', expiresAt: 1, model: 'm', language }), ...overrides };
}

const post = (app, url, payload) => app.inject({ method: 'POST', url, payload });

test('routes: create, ingest, view, end, delete', async () => {
  const services = routeServices();
  const app = await appWith(services);
  const created = await post(app, CONVERSATIONS_PATH, { platform: 'meet', capture: 'captions', title: 'Weekly' });
  assert.equal(created.statusCode, 201);
  const { id } = created.json();
  assert.equal(id, ID);

  const batch = await post(app, `${CONVERSATIONS_PATH}/${id}/utterances`, { utterances: [utt('a', 'Ana', 'We have 42 customers')] });
  assert.equal(batch.statusCode, 200);
  assert.equal(batch.json().claims[0].verdict, 'no');

  assert.equal((await app.inject({ method: 'GET', url: `${CONVERSATIONS_PATH}/${id}` })).statusCode, 200);
  assert.equal((await post(app, `${CONVERSATIONS_PATH}/${id}/end`)).statusCode, 204);
  const afterEnd = await post(app, `${CONVERSATIONS_PATH}/${id}/utterances`, { utterances: [utt('b', 'Ben', 'Late line 7')] });
  assert.equal(afterEnd.statusCode, 409);
  assert.equal((await app.inject({ method: 'DELETE', url: `${CONVERSATIONS_PATH}/${id}` })).statusCode, 204);
  assert.equal((await app.inject({ method: 'GET', url: `${CONVERSATIONS_PATH}/${id}` })).statusCode, 404);
  const missing = await post(app, `${CONVERSATIONS_PATH}/${id}/utterances`, { utterances: [utt('c', 'Cy', 'x 1')] });
  assert.equal(missing.statusCode, 404);
  await app.close();
});

test('routes: input validation', async () => {
  const app = await appWith(routeServices());
  const bad = async (url, payload) => (await post(app, url, payload)).statusCode;
  assert.equal(await bad(CONVERSATIONS_PATH, { platform: 'Google Meet', capture: 'captions' }), 400);
  assert.equal(await bad(CONVERSATIONS_PATH, { platform: 'meet', capture: 'video' }), 400);
  assert.equal(await bad(CONVERSATIONS_PATH, { platform: 'meet', capture: 'captions', extra: 1 }), 400);
  assert.equal(await bad(CONVERSATIONS_PATH, { platform: 'meet', capture: 'captions', pageUrl: 'javascript:alert(1)' }), 400);
  const u = `${CONVERSATIONS_PATH}/${ID}/utterances`;
  assert.equal(await bad(u, { utterances: [] }), 400);
  assert.equal(await bad(u, { utterances: Array.from({ length: 51 }, (_, i) => utt(`c${i}`, 'A', 't')) }), 400);
  assert.equal(await bad(u, { utterances: [{ ...utt('a', 'A', 't'), speakerKind: 'robot' }] }), 400);
  assert.equal(await bad(u, { utterances: [{ ...utt('a', 'A', 't'), clientId: 'has space' }] }), 400);
  assert.equal(await bad(u, { utterances: [{ ...utt('a', 'A', '   ') }] }), 400);
  assert.equal(await bad(u, { utterances: [{ ...utt('a', 'A', 't'), spokenAt: '2026-13-45T99:00:00Z' }] }), 400);
  assert.equal(await bad(TRANSCRIPTION_TOKEN_PATH, { language: 'spanish' }), 400);
  await app.close();
});

test('routes: transcription token, and 503 when minting fails', async () => {
  const app = await appWith(routeServices());
  const ok = await post(app, TRANSCRIPTION_TOKEN_PATH, { language: 'es' });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().language, 'es');
  await app.close();

  const failing = await appWith(routeServices({ mintToken: async () => { throw new Error('upstream'); } }));
  assert.equal((await post(failing, TRANSCRIPTION_TOKEN_PATH, {})).statusCode, 503);
  await failing.close();
});

test('routes: 503 when OpenAI or Postgres is not configured', async () => {
  const saved = { key: process.env.OPENAI_API_KEY, db: process.env.DATABASE_URL };
  delete process.env.OPENAI_API_KEY;
  delete process.env.DATABASE_URL;
  try {
    const app = await appWith(undefined);
    assert.equal((await post(app, CONVERSATIONS_PATH, { platform: 'meet', capture: 'captions' })).statusCode, 503);
    assert.equal((await post(app, TRANSCRIPTION_TOKEN_PATH, {})).statusCode, 503);
    await app.close();
  } finally {
    if (saved.key !== undefined) process.env.OPENAI_API_KEY = saved.key;
    if (saved.db !== undefined) process.env.DATABASE_URL = saved.db;
  }
});
