import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { createFactChecker, normalizeClaim } from '../dist/live/pipeline.js';
import { mapVerdict } from '../dist/live/verdict.js';
import { registerLiveFactCheck, LIVE_FACT_CHECK_PATH } from '../dist/live/route.js';

const thresholds = { minRelevance: 0.5, minConfidence: 0.6 };
const fact = { id: 'f1', statement: 'Water boils at 100 C at sea level.', sourceUrl: 'https://example.org/f1', sourceTitle: null, additionalSourceUrls: ['https://example.net/f1'], similarity: 0.8 };

function deps(overrides = {}) {
  const calls = { embed: 0, search: 0, decide: 0 };
  return {
    calls,
    deps: {
      embed: async () => { calls.embed++; return [0.1, 0.2]; },
      search: async () => { calls.search++; return [fact]; },
      decide: async () => { calls.decide++; return { relevance: 0.9, sourceId: fact.id, choice: 'yes', confidence: 0.95 }; },
      topK: 5,
      thresholds,
      cacheTtlMs: 0,
      ...overrides,
    },
  };
}

test('mapVerdict is conservative', () => {
  assert.equal(mapVerdict({ relevance: 0.9, choice: 'no', confidence: 0.9 }, thresholds).verdict, 'no');
  assert.equal(mapVerdict({ relevance: 0.9, choice: 'yes', confidence: 0.4 }, thresholds).verdict, 'probably_yes');
  assert.equal(mapVerdict({ relevance: 0.9, choice: 'no', confidence: 0.4 }, thresholds).verdict, 'probably_no');
  assert.equal(mapVerdict({ relevance: 0.2, choice: 'yes', confidence: 0.99 }, thresholds).reason, 'off_topic');
  assert.equal(mapVerdict({ relevance: null, choice: null, confidence: null }, thresholds).reason, 'refused');
  assert.equal(mapVerdict({ relevance: 0.9, choice: 'banana', confidence: 0.9 }, thresholds).verdict, 'neutral');
});

test('no evidence returns neutral without calling Decisions', async () => {
  const { calls, deps: d } = deps({ search: async () => [] });
  const out = await createFactChecker(d)('Something unknown');
  assert.deepEqual(out.result, { verdict: 'neutral', sources: [] });
  assert.equal(out.meta.reason, 'no_evidence');
  assert.equal(calls.decide, 0);
});

test('no corpus evidence falls back to a labelled general-knowledge verdict', async () => {
  const { calls, deps: d } = deps({ search: async () => [], knowledge: async () => ({ choice: 'no', confidence: 0.97 }) });
  const out = await createFactChecker(d)('The earth is flat');
  assert.deepEqual(out.result, { verdict: 'no', sources: [], basis: 'general_knowledge' });
  assert.equal(out.meta.reason, 'general_knowledge');
  assert.equal(calls.decide, 0);
});

test('off-topic corpus evidence also falls back to general knowledge', async () => {
  const { deps: d } = deps({
    decide: async () => ({ relevance: 0, sourceId: null, choice: 'neutral', confidence: 0.9 }),
    knowledge: async () => ({ choice: 'no', confidence: 0.95 }),
  });
  const out = await createFactChecker(d)('The capital of France is Rome');
  assert.equal(out.result.verdict, 'no');
  assert.equal(out.result.basis, 'general_knowledge');
});

test('general knowledge stays neutral when unsure, neutral or failing', async () => {
  for (const knowledge of [
    async () => ({ choice: 'yes', confidence: 0.5 }),
    async () => ({ choice: 'neutral', confidence: 0.99 }),
    async () => ({ choice: null, confidence: null }),
    async () => { throw new Error('timeout'); },
  ]) {
    const out = await createFactChecker(deps({ search: async () => [], knowledge }).deps)('Opinion or unknown');
    assert.deepEqual(out.result, { verdict: 'neutral', sources: [] });
    assert.equal(out.meta.reason, 'no_evidence');
  }
});

test('a corpus verdict never calls general knowledge', async () => {
  let asked = 0;
  const out = await createFactChecker(deps({ knowledge: async () => { asked++; return { choice: 'no', confidence: 1 }; } }).deps)('Water boils at 100 C');
  assert.equal(out.result.verdict, 'yes');
  assert.equal(out.result.basis, undefined);
  assert.equal(asked, 0);
});

test('the verdict includes all links for the selected fact and no unrelated links', async () => {
  const otherwiseRelevant = { ...fact, id: 'f2', statement: 'Water freezes at 0 C.' };
  const { deps: d } = deps({ search: async () => [otherwiseRelevant, fact] });
  const out = await createFactChecker(d)('Water boils at 100 degrees');
  assert.equal(out.result.verdict, 'yes');
  assert.deepEqual(out.result.sources, [fact.sourceUrl, ...fact.additionalSourceUrls].map((sourceUrl) => ({
    statement: fact.statement,
    sourceUrl,
  })));
});

test('cited sources carry the English display text without changing the judged statement', async () => {
  const translated = { ...fact, statement: 'El agua hierve a 100 C al nivel del mar.', statementEn: fact.statement };
  let judged;
  const { deps: d } = deps({
    search: async () => [translated],
    decide: async (_claim, evidence) => {
      judged = evidence.map(({ statement }) => statement);
      return { relevance: 0.9, sourceId: translated.id, choice: 'yes', confidence: 0.95 };
    },
  });
  const out = await createFactChecker(d)('Water boils at 100 degrees');
  assert.deepEqual(judged, [translated.statement]);
  assert.deepEqual(out.result.sources[0], { statement: translated.statement, statementEn: fact.statement, sourceUrl: fact.sourceUrl });
});

test('retrieved facts that do not address the claim are not cited', async () => {
  const { deps: d } = deps({
    decide: async () => ({ relevance: 0.2, sourceId: null, choice: 'neutral', confidence: 0.9 }),
  });
  const out = await createFactChecker(d)('An unrelated claim');
  assert.deepEqual(out.result, { verdict: 'neutral', sources: [] });
  assert.equal(out.meta.reason, 'off_topic');
});

test('cache dedupes repeated claims', async () => {
  const { calls, deps: d } = deps({ cacheTtlMs: 60_000 });
  const check = createFactChecker(d);
  await check('Water  boils at 100');
  const second = await check('water boils at 100 ');
  assert.equal(calls.embed, 1);
  assert.equal(second.meta.cached, true);
  assert.equal(normalizeClaim('  A  B '), 'a b');
});

test('live route returns the shared contract and 503 on failure', async (t) => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  let fail = false;
  registerLiveFactCheck(app, async () => {
    if (fail) throw new Error('boom');
    return { result: { verdict: 'probably_no', sources: [] }, meta: { timings: { embedMs: 1, searchMs: 1, decideMs: 1, totalMs: 3 } } };
  });

  const ok = await app.inject({ method: 'POST', url: LIVE_FACT_CHECK_PATH, payload: { claim: 'x' } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['x-fact-check-mode'], 'live');
  assert.equal(ok.json().verdict, 'probably_no');

  fail = true;
  const ko = await app.inject({ method: 'POST', url: LIVE_FACT_CHECK_PATH, payload: { claim: 'x' } });
  assert.equal(ko.statusCode, 503);
});
