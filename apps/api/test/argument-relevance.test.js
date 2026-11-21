import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChoices,
  createRelevanceAssessor,
  INSUFFICIENT_CONTEXT,
  isExplicitAnchor,
  RELEVANCE_FAILED,
  toRelevance,
} from '../dist/conversations/argument-relevance.js';
import { loadConversationConfig } from '../dist/conversations/config.js';
import { createIngest } from '../dist/conversations/service.js';
import { createConversationStore } from '../dist/conversations/store.js';

const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const u = (id, speaker, text) => ({ id, clientId: `c${id}`, speaker, speakerKind: 'named', text, spokenAt: '2026-11-21T10:00:00.000Z' });
const live = (verdict) => ({
  result: { verdict, sources: [] },
  meta: { verdict, reason: 'decided', relevance: 1, confidence: 1, evidenceCount: 1, cached: false, timings: {} },
});

/** Minimal store fake: earlier utterances are `history`, the batch gets ids after them. */
function store(history = []) {
  const calls = { contextBefore: [] };
  let seq = history.length;
  return {
    calls,
    async state() { return 'open'; },
    async addUtterances(_id, batch) { return batch.map((b) => ({ ...b, id: String(++seq) })); },
    async contextBefore(_id, _exclude, limit) { calls.contextBefore.push(limit); return history.slice(-limit); },
    async saveClaims(_id, records) {
      return records.map((r, i) => ({
        id: String(i + 1), claim: r.claim, speaker: 'S', utteranceClientId: 'x', status: r.check ? 'checked' : 'failed',
        verdict: r.check?.result.verdict ?? null, sources: [],
        ...(r.argumentRelevance ? { argumentRelevance: r.argumentRelevance } : {}),
      }));
    },
  };
}

const input = (clientId, speaker, text) => ({ clientId, speaker, speakerKind: 'named', text, spokenAt: '2026-11-21T10:00:05.000Z' });
const history = [u('1', 'Inés', 'Hola, gracias por venir.'), u('2', 'Inés', '¿Cuál fue vuestro MRR en octubre?')];

test('flag off: no assessor, extraction context unchanged, no argumentRelevance field', async () => {
  const s = store(history);
  let extractContext;
  const ingest = createIngest({
    store: s, contextSize: 2, checkConcurrency: 2,
    extract: async (batch, context) => { extractContext = context; return [{ utteranceId: batch[0].id, claim: 'El MRR fue 32.000 €' }]; },
    check: async () => live('no'),
  });
  const out = await ingest(ID, [input('a', 'Leo', 'El MRR fue de 32.000 euros.')]);
  assert.deepEqual(s.calls.contextBefore, [2]);
  assert.equal(extractContext.length, 2);
  assert.equal('argumentRelevance' in out.claims[0], false);
});

test('flag on: assessor gets earlier turns, runs alongside the check, and extraction still gets contextSize', async () => {
  const s = store(history);
  let seen;
  let extractContext;
  const order = [];
  const ingest = createIngest({
    store: s, contextSize: 1, checkConcurrency: 2,
    extract: async (batch, context) => { extractContext = context; return [{ utteranceId: batch[1].id, claim: 'El MRR fue 32.000 €' }]; },
    check: async () => { order.push('check:start'); await new Promise((r) => setTimeout(r, 10)); order.push('check:end'); return live('no'); },
    assessRelevance: async (args) => {
      order.push('relevance:start');
      seen = args;
      return { status: 'assessed', level: 'high', context: { utteranceClientId: 'c2', speaker: 'Inés', text: history[1].text }, reason: 'r' };
    },
  });
  const out = await ingest(ID, [input('a', 'Leo', 'Buena pregunta.'), input('b', 'Leo', 'El MRR fue de 32.000 euros.')]);
  assert.deepEqual(s.calls.contextBefore, [6]);
  assert.deepEqual(extractContext.map((x) => x.text), [history[1].text]);
  assert.deepEqual(seen.previous.map((x) => x.text), [history[0].text, history[1].text, 'Buena pregunta.']);
  assert.equal(seen.utterance.text, 'El MRR fue de 32.000 euros.');
  assert.equal(order.indexOf('relevance:start') < order.indexOf('check:end'), true);
  assert.equal(out.claims[0].verdict, 'no');
  assert.equal(out.claims[0].argumentRelevance.level, 'high');
});

test('a relevance failure keeps the verdict and marks only the extra as failed', async () => {
  const stages = [];
  const ingest = createIngest({
    store: store(history), contextSize: 2, checkConcurrency: 2,
    extract: async (batch) => [{ utteranceId: batch[0].id, claim: 'X' }],
    check: async () => live('yes'),
    assessRelevance: async () => { throw new Error('decisions down'); },
    onError: (stage) => stages.push(stage),
  });
  const out = await ingest(ID, [input('a', 'Leo', 'X')]);
  assert.equal(out.claims[0].verdict, 'yes');
  assert.deepEqual(out.claims[0].argumentRelevance, RELEVANCE_FAILED);
  assert.deepEqual(stages, ['relevance']);
});

function fakeDecisions(answer) {
  const calls = [];
  return {
    calls,
    client: { decisions: { create: async (body) => { calls.push(body); return { answers: answer ? [answer] : [] }; } } },
  };
}

test('assessor: no question or thesis before the claim -> insufficient context without calling Decisions', async () => {
  const { client, calls } = fakeDecisions(null);
  const out = await createRelevanceAssessor(client, 'm')({
    claim: 'Tenemos 42 clientes', speaker: 'Leo', utterance: u('3', 'Leo', 'Tenemos 42 clientes.'), previous: [history[0]],
  });
  assert.deepEqual(out, INSUFFICIENT_CONTEXT);
  assert.equal(calls.length, 0);
});

test('assessor: picks turn and level in one paired choice and maps it to the contract', async () => {
  const { client, calls } = fakeDecisions({ type: 'choice', name: 'argument_relevance', choice: 'turno_1_high', confidence: 0.9 });
  const out = await createRelevanceAssessor(client, 'gpt-test')({
    claim: 'El MRR fue 32.000 €', speaker: 'Leo', utterance: u('3', 'Leo', 'El MRR fue de 32.000 euros.'), previous: history,
  });
  assert.deepEqual(out, {
    status: 'assessed',
    level: 'high',
    context: { utteranceClientId: 'c2', speaker: 'Inés', text: history[1].text },
    reason: 'La afirmación se refiere directamente a la pregunta o tesis citada.',
  });
  const body = calls[0];
  assert.equal(body.model, 'gpt-test');
  assert.equal(body.questions.length, 1);
  assert.deepEqual(body.questions[0].choices.map((c) => c.value), ['sin_contexto', 'turno_1_high', 'turno_1_partial', 'turno_1_low']);
  assert.equal(body.input[1].content[0].data.previousTurns.length, 2);
});

test('assessor: sin_contexto maps to insufficient context; refusals and unknown values throw', async () => {
  const anchors = [history[1]];
  assert.deepEqual(toRelevance(buildChoices(anchors), 'sin_contexto'), INSUFFICIENT_CONTEXT);
  assert.throws(() => toRelevance(buildChoices(anchors), 'turno_9_high'), /no valid/);
  const { client } = fakeDecisions({ type: 'refusal', name: 'argument_relevance' });
  await assert.rejects(createRelevanceAssessor(client, 'm')({
    claim: 'X', speaker: 'Leo', utterance: u('3', 'Leo', 'X'), previous: history,
  }));
});

test('explicit anchors: questions and announced theses', () => {
  assert.equal(isExplicitAnchor('¿Cuál fue vuestro MRR?'), true);
  assert.equal(isExplicitAnchor('Nuestra tesis es que la nube crece en la UE.'), true);
  assert.equal(isExplicitAnchor('Gracias por venir.'), false);
});

test('store: with the extra off no query touches claims.argument_relevance', async () => {
  const sql = [];
  const pool = {
    async query(text) {
      sql.push(text);
      if (/^\s*INSERT INTO claims/.test(text)) return { rows: [{ id: '1' }] };
      return { rows: [] };
    },
  };
  const claim = { utteranceId: '1', claim: 'X', check: live('yes'), argumentRelevance: RELEVANCE_FAILED };
  await createConversationStore(pool).saveClaims(ID, [claim]);
  assert.equal(sql.some((q) => q.includes('argument_relevance')), false);

  sql.length = 0;
  await createConversationStore(pool, { argumentRelevance: true }).saveClaims(ID, [claim]);
  assert.equal(sql.filter((q) => q.includes('argument_relevance')).length, 2);
});

test('config: the extra is off unless ARGUMENT_RELEVANCE_ENABLED is true', () => {
  const saved = process.env.ARGUMENT_RELEVANCE_ENABLED;
  try {
    delete process.env.ARGUMENT_RELEVANCE_ENABLED;
    assert.equal(loadConversationConfig().argumentRelevance.enabled, false);
    process.env.ARGUMENT_RELEVANCE_ENABLED = 'true';
    assert.equal(loadConversationConfig().argumentRelevance.enabled, true);
  } finally {
    if (saved === undefined) delete process.env.ARGUMENT_RELEVANCE_ENABLED;
    else process.env.ARGUMENT_RELEVANCE_ENABLED = saved;
  }
});
