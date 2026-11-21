import assert from 'node:assert/strict';
import test from 'node:test';
import { FACT_CHECK_PATH, VERDICTS } from '@growth-factcheking/shared';
import { createApp } from '../dist/app.js';

test('the local API responds to its health check', async (t) => {
  const app = createApp(false);
  t.after(() => app.close());

  const response = await app.inject('/health');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
});

test('the demo returns every verdict with example sources', async (t) => {
  const app = createApp(false);
  t.after(() => app.close());

  for (const verdict of VERDICTS) {
    const response = await app.inject({
      method: 'POST',
      url: `${FACT_CHECK_PATH}?scenario=${verdict}`,
      payload: { claim: 'Una afirmación' },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['x-fact-check-mode'], 'mock');
    assert.equal(response.json().verdict, verdict);
    assert.ok(response.json().sources.length > 0);
  }
});

test('the default and no-evidence scenarios return neutral with no sources', async (t) => {
  const app = createApp(false);
  t.after(() => app.close());

  for (const url of [FACT_CHECK_PATH, `${FACT_CHECK_PATH}?scenario=no_evidence`]) {
    const response = await app.inject({ method: 'POST', url, payload: { claim: 'Una afirmación' } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { verdict: 'neutral', sources: [] });
  }
});

test('the error scenario simulates a 503 and invalid requests return 400', async (t) => {
  const app = createApp(false);
  t.after(() => app.close());

  const request = { method: 'POST', payload: { claim: 'Una afirmación' } };
  const error = await app.inject({ ...request, url: `${FACT_CHECK_PATH}?scenario=error` });
  assert.equal(error.statusCode, 503);
  assert.equal(error.headers['x-fact-check-mode'], 'mock');

  const invalidScenario = await app.inject({ ...request, url: `${FACT_CHECK_PATH}?scenario=unknown` });
  assert.equal(invalidScenario.statusCode, 400);

  for (const payload of [{}, { claim: '   ' }, { claim: 5 }, { claim: 'x'.repeat(1001) }]) {
    const response = await app.inject({ method: 'POST', url: FACT_CHECK_PATH, payload });
    assert.equal(response.statusCode, 400);
  }
});
