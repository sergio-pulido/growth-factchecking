import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFacts } from '../dist/live/ingestion.js';
import { createApp } from '../dist/app.js';
import { MockFactsBackend } from '../dist/local/backend.js';

const fact = { id: 'planetarium', statement: 'El planetario de Puerto Aurora abre los viernes.', sourceUrl: 'https://example.com/planetario' };

test('ingestion, duplicate replay, retrieval and verdict form one isolated local flow', async (t) => {
  const app = createApp(false, new MockFactsBackend(false));
  t.after(() => app.close());
  const post = (url, payload) => app.inject({ method: 'POST', url, payload });
  assert.deepEqual((await post('/api/fact-check', { claim: fact.statement })).json(), { verdict: 'neutral', sources: [] });
  assert.deepEqual((await post('/api/facts/ingest', { facts: [fact] })).json(), { inserted: 1, updated: 0, skipped: 0, total: 1, mode: 'mock' });
  assert.equal((await post('/api/facts/ingest', { facts: [fact] })).json().skipped, 1);
  const matches = (await post('/api/facts/search', { claim: fact.statement })).json().matches;
  assert.equal(matches[0].id, fact.id);
  assert.ok(matches[0].score > 0.99);
  assert.deepEqual((await post('/api/fact-check', { claim: fact.statement })).json(), {
    verdict: 'yes', sources: [{ statement: fact.statement, sourceUrl: fact.sourceUrl }],
  });
  assert.equal((await post('/api/fact-check', { claim: 'Quantum entanglement' })).json().verdict, 'neutral');
  const revised = { ...fact, statement: 'El planetario cierra los viernes.' };
  assert.equal((await post('/api/facts/ingest', { facts: [revised] })).json().updated, 1);
  assert.equal((await post('/api/fact-check', { claim: fact.statement })).json().verdict, 'neutral');
  assert.equal((await app.inject('/api/facts')).json().facts.length, 1);
  const otherApp = createApp(false, new MockFactsBackend(false));
  t.after(() => otherApp.close());
  assert.deepEqual((await otherApp.inject('/api/facts')).json().facts, []);
});

test('invalid batches are rejected before any writes; fixed demo scenarios still work', async (t) => {
  const app = createApp(false, new MockFactsBackend(false));
  t.after(() => app.close());
  for (const facts of [[], [fact, fact], [fact, { ...fact, id: 'bad', sourceUrl: 'javascript:alert(1)' }], [{ ...fact, statement: ' ' }], [{ ...fact, id: 42 }], Array(101).fill(fact)]) {
    const response = await app.inject({ method: 'POST', url: '/api/facts/ingest', payload: { facts } });
    assert.equal(response.statusCode, 400);
    assert.deepEqual((await app.inject('/api/facts')).json().facts, []);
  }
  for (const scenario of ['yes', 'probably_yes', 'neutral', 'probably_no', 'no', 'no_evidence', 'error']) {
    const response = await app.inject({ method: 'POST', url: `/api/fact-check?scenario=${scenario}`, payload: { claim: fact.statement } });
    assert.equal(response.statusCode, scenario === 'error' ? 503 : 200);
    assert.equal(response.headers['x-fact-check-mode'], 'mock');
  }
  assert.equal((await app.inject('/')).statusCode, 200);
  assert.equal((await app.inject('/local.js')).statusCode, 200);
});

test('live ingestion accepts both corpus formats and rejects invalid source records', () => {
  assert.deepEqual(parseFacts({ facts: [fact] }), [fact]);
  assert.deepEqual(parseFacts([fact]), [fact]);
  const corroborated = { ...fact, additionalSourceUrls: ['https://example.org/other-source'] };
  assert.deepEqual(parseFacts([corroborated]), [corroborated]);
  assert.throws(() => parseFacts([{ ...fact, additionalSourceUrls: [fact.sourceUrl] }]), /duplicate source/);
  assert.throws(() => parseFacts({ facts: [fact, fact] }), /duplicate ID/);
  assert.throws(() => parseFacts([fact, { ...fact, id: 'other', sourceUrl: 'file:///tmp/source' }]), /HTTP/);
});
