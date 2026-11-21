import assert from 'node:assert/strict';
import test from 'node:test';
import { FACT_CHECK_PATH } from '@growth-factcheking/shared';
import { createApp } from '../dist/app.js';

test('the local API responds to its health check', async (t) => {
  const app = createApp(false);
  t.after(() => app.close());

  const response = await app.inject('/health');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
});

test('the verification route reports its implementation status', async (t) => {
  const app = createApp(false);
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: FACT_CHECK_PATH,
    payload: { claim: 'Una afirmación' },
  });
  assert.equal(response.statusCode, 501);
});
