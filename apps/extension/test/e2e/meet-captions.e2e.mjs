// End-to-end acceptance: Spanish Meet call (2 people) -> caption consolidation -> capture session -> real API
// (Postgres + OpenAI extraction + live fact-check). Needs a running API with OPENAI_API_KEY and DATABASE_URL
// and the demo corpus seeded:  npm run seed -- "$PWD/data/demo/meet-startup.json"
//   API_ORIGIN=http://127.0.0.1:3000 npm run test:e2e --workspace @growth-factcheking/extension
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createMeetCaptureController } from '../../test-dist/capture-controller.js';
import { CLAIMS, EXPECTED, FOUNDER, INVESTOR, STEPS } from '../fixtures/meet-call-es.mjs';

const API = process.env.API_ORIGIN ?? 'http://127.0.0.1:3000';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function http(method, path, body) {
  try {
    const response = await fetch(API + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    return response.ok ? { ok: true, data } : { ok: false, status: response.status, message: data?.message ?? text };
  } catch (error) {
    return { ok: false, status: 0, message: String(error) };
  }
}

test('Spanish two-person Meet call: speakers kept, each utterance stored once, both verdicts returned', async (t) => {
  const health = await http('GET', '/health');
  assert.ok(health.ok, `API not reachable at ${API}: ${health.message}`);

  // Real HTTP adapter; the first batch's response is "lost" after the API stored it, to force a retry.
  let lostOnce = false;
  const sends = [];
  const api = {
    create: (body) => http('POST', '/api/conversations', body),
    async sendUtterances(id, utterances) {
      sends.push(utterances.map((u) => u.clientId));
      const result = await http('POST', `/api/conversations/${id}/utterances`, { utterances });
      if (!lostOnce && result.ok) {
        lostOnce = true;
        return { ok: false, status: 0, message: 'simulated lost response' };
      }
      return result;
    },
    end: (id) => http('POST', `/api/conversations/${id}/end`, {}).then((r) => (r.ok ? { ok: true, data: null } : r)),
  };

  // Real timers; the caption timeline runs on a virtual clock so the test takes seconds, not 17 s of speech.
  let virtual = 0;
  let rows = [];
  let reads = 0;
  const controller = createMeetCaptureController({
    reader: { read: () => { reads++; return rows; } },
    api,
    scheduler: { setTimeout, clearTimeout },
    now: () => virtual,
    pollMs: 10,
    newIdPrefix: () => `e2e-${randomUUID().slice(0, 8)}`,
    meta: () => ({ title: 'E2E · Meet ES · Lumen Labs', language: 'es' }),
    session: { flushIntervalMs: 50, retryBaseMs: 50, maxBatch: 2 },
  });

  const started = await controller.start();
  assert.equal(started.status, 'capturing', JSON.stringify(started.error));
  const conversationId = started.conversationId;
  t.diagnostic(`conversation ${conversationId}`);

  for (const step of STEPS) {
    virtual = step.at;
    rows = step.rows;
    await sleep(40);
  }
  virtual += 500;
  await sleep(100);

  const t0 = performance.now();
  const stopped = await controller.stop();
  t.diagnostic(`stop drained in ${Math.round(performance.now() - t0)} ms`);
  assert.equal(stopped.status, 'stopped', JSON.stringify(stopped.error));
  assert.equal(stopped.active, false);
  assert.equal(stopped.pending, 0);

  // Capture has ceased: new captions are not read or sent.
  const readsAtStop = reads;
  const sendsAtStop = sends.length;
  rows = [{ speaker: FOUNDER, text: 'Esto se dice después de detener la captura.' }];
  await sleep(300);
  assert.equal(reads, readsAtStop);
  assert.equal(sends.length, sendsAtStop);

  // The retry re-sent the same clientIds and the API reported them as duplicates.
  assert.ok(stopped.duplicates >= 1, `expected duplicates from the retry, got ${stopped.duplicates}`);
  const allSent = sends.flat();
  assert.ok(allSent.length > new Set(allSent).size, 'some clientIds were sent twice');

  const view = await http('GET', `/api/conversations/${conversationId}`);
  assert.ok(view.ok);
  const stored = view.data.utterances;
  t.diagnostic(`stored: ${JSON.stringify(stored.map((u) => [u.speaker, u.text]))}`);
  t.diagnostic(`claims: ${JSON.stringify(view.data.claims.map((c) => [c.speaker, c.claim, c.verdict]))}`);

  assert.equal(stored.length, EXPECTED.length, 'each intervention stored exactly once');
  assert.equal(new Set(stored.map((u) => u.clientId)).size, stored.length);
  assert.deepEqual(stored.map(({ speaker, text }) => ({ speaker, text })), EXPECTED);
  assert.deepEqual([...new Set(stored.map((u) => u.speaker))].sort(), [FOUNDER, INVESTOR].sort());
  assert.ok(view.data.endedAt, 'conversation ended');

  const claims = view.data.claims;
  const founded = claims.find((c) => /2021/.test(c.claim) && /Barcelona/i.test(c.claim));
  const revenue = claims.find((c) => /50\.?000/.test(c.claim));
  assert.ok(founded, 'supported claim extracted');
  assert.ok(revenue, 'contradicted claim extracted');
  assert.equal(founded.speaker, FOUNDER);
  assert.ok(['yes', 'probably_yes'].includes(founded.verdict), `supported verdict: ${founded.verdict}`);
  assert.ok(['no', 'probably_no'].includes(revenue.verdict), `contradicted verdict: ${revenue.verdict}`);
  assert.ok(!claims.some((c) => c.claim.includes(CLAIMS.opinion.slice(0, 20))), 'the opinion is not a claim');
  assert.ok(!claims.some((c) => c.speaker === INVESTOR), 'the investor question and opinion yield no claims');
  // Claims returned to the UI during capture match what the API stored.
  assert.deepEqual(stopped.claims.map((c) => c.id).sort(), claims.map((c) => c.id).sort());

  if (!process.env.KEEP_CONVERSATION) {
    const removed = await http('DELETE', `/api/conversations/${conversationId}`);
    assert.ok(removed.ok, removed.message);
  }
});
