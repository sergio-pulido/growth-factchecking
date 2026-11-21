import assert from 'node:assert/strict';
import test from 'node:test';
import { MEET_DEMO_PATH, MEET_TRANSCRIPT, VERDICTS } from '@growth-factcheking/shared';
import Fastify from 'fastify';
import { createApp } from '../dist/app.js';
import { createPitchDecider } from '../dist/meet/decisions.js';
import { registerMeetDemo } from '../dist/meet/route.js';

function checkTurn(app, turnId, mode) {
  return app.inject({ method: 'POST', url: MEET_DEMO_PATH, payload: { turnId, mode } });
}

test('the Meet transcript yields four factual founder claims in order', async (t) => {
  const app = createApp(false);
  t.after(() => app.close());
  const checks = [];
  for (const turn of MEET_TRANSCRIPT) {
    const response = await checkTurn(app, turn.id, 'mock');
    assert.equal(response.statusCode, 200, response.body);
    const result = response.json().checks;
    if (turn.speaker === 'investor') assert.deepEqual(result, []);
    checks.push(...result);
  }

  assert.deepEqual(checks.map(({ verdict, sources }) => [verdict, sources.length]), [
    ['yes', 1], ['no', 1], ['probably_yes', 1], ['neutral', 0],
  ]);
  assert.match(checks[1].claim, /32\.000 euros/);
  assert.match(checks[1].sources[0].statement, /27\.800 euros/);
  assert.ok(checks.every(({ claim }) => !/esperamos|creo|200 clientes/i.test(claim)));
});

test('a live turn sends independent cases and maps Decisions answers by name', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const requests = [];
  const decide = createPitchDecider('test-key', async (url, request) => {
    requests.push({ url, body: JSON.parse(request.body) });
    return Response.json({
      answers: [
        { type: 'choice', name: 'claim_2', choice: 'probably_no' },
        { type: 'choice', name: 'claim_1', choice: 'probably_yes' },
      ],
    });
  });
  registerMeetDemo(app, decide);
  const response = await checkTurn(app, 'traction', 'decisions');
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().checks.map(({ verdict }) => verdict), ['probably_yes', 'probably_no']);

  assert.equal(requests.length, 1);
  const [{ url, body }] = requests;
  assert.equal(url, 'https://api.openai.com/v1/decisions');
  assert.equal(body.model, 'gpt-6-luna');
  const [{ data }] = body.input[0].content;
  assert.match(data.cases[0].claim, /42 clientes/);
  assert.match(data.cases[0].evidence[0], /42 cuentas/);
  assert.match(data.cases[1].evidence[0], /27\.800 euros/);
  assert.deepEqual(body.questions[1].choices.map(({ value }) => value), VERDICTS);

  const noEvidence = await checkTurn(app, 'pilot', 'decisions');
  assert.equal(noEvidence.json().checks[0].verdict, 'neutral');
  assert.equal(requests.length, 1);
});

test('invalid turns, missing configuration and Decisions failures have distinct responses', async (t) => {
  const app = Fastify();
  const failingApp = Fastify();
  t.after(() => Promise.all([app.close(), failingApp.close()]));
  registerMeetDemo(app);
  registerMeetDemo(failingApp, createPitchDecider('test-key', async () => Response.json({
    answers: [{ type: 'refusal', name: 'claim_1' }],
  })));

  assert.equal((await checkTurn(app, 'unknown', 'mock')).statusCode, 400);
  assert.equal((await checkTurn(app, 'traction', 'unknown')).statusCode, 400);
  assert.equal((await checkTurn(app, 'traction', 'decisions')).statusCode, 503);
  assert.equal((await checkTurn(failingApp, 'traction', 'decisions')).statusCode, 502);
});

test('a rejected OpenAI key has an actionable error without provider response details', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  registerMeetDemo(app, createPitchDecider('test-key', async () => Response.json({
    error: { message: 'Private authentication details', code: 'invalid_api_key' },
  }, { status: 401 })));

  const response = await checkTurn(app, 'traction', 'decisions');
  assert.equal(response.statusCode, 503);
  assert.match(response.json().message, /Actualiza OPENAI_API_KEY/);
  assert.doesNotMatch(response.body, /Private authentication details/);
});
