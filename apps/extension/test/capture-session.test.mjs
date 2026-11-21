import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaptureSession } from '../test-dist/capture-session.js';
import { fakeApi, fakeClock } from './helpers.mjs';

const utt = (clientId, text = `línea ${clientId}`) => ({
  clientId, speaker: 'Ana', speakerKind: 'named', text, spokenAt: '2026-11-21T10:00:00.000Z',
});

function setup(api = fakeApi(), extra = {}) {
  const clock = fakeClock();
  const states = [];
  const session = createCaptureSession({
    api, scheduler: clock.scheduler, now: clock.now, flushIntervalMs: 3000, maxBatch: 3,
    retryBaseMs: 1000, retryMaxMs: 4000, stopAttempts: 2, onState: (s) => states.push(s), ...extra,
  });
  return { api, clock, session, states };
}

test('start creates a meet/captions conversation and exposes an active state', async () => {
  let body;
  const api = fakeApi({ async create(b) { body = b; return { ok: true, data: { id: 'c1' } }; } });
  const { session } = setup(api);
  const state = await session.start({ title: 'Reunión', language: 'es' });
  assert.equal(state.status, 'capturing');
  assert.equal(state.conversationId, 'c1');
  assert.deepEqual(body, { platform: 'meet', capture: 'captions', title: 'Reunión', language: 'es' });
});

test('start failures map to UI error kinds', async () => {
  for (const [status, kind] of [[0, 'api_unreachable'], [503, 'service_unavailable'], [400, 'rejected']]) {
    const { session } = setup(fakeApi({ async create() { return { ok: false, status, message: 'x' }; } }));
    const state = await session.start({});
    assert.equal(state.status, 'error');
    assert.equal(state.error.kind, kind);
  }
});

test('utterances are batched on an interval, or at once when a batch is full', async () => {
  const { api, clock, session } = setup();
  await session.start({});
  session.enqueue([utt('a'), utt('b')]);
  await clock.advance(2999);
  assert.equal(api.calls.send.length, 0);
  await clock.advance(1);
  assert.deepEqual(api.calls.send, [['a', 'b']]);
  session.enqueue([utt('c'), utt('d'), utt('e'), utt('f')]);
  await clock.advance(0);
  assert.deepEqual(api.calls.send.slice(1), [['c', 'd', 'e'], ['f']]);
  assert.equal(session.state().sent, 6);
  assert.equal(session.state().pending, 0);
});

test('a lost response is retried with the same clientIds and the API reports the duplicates', async () => {
  const api = fakeApi();
  const realSend = api.sendUtterances;
  let first = true;
  api.sendUtterances = async (id, batch) => {
    const result = await realSend(id, batch);
    if (first) { first = false; return { ok: false, status: 0, message: 'socket hang up' }; }
    return result;
  };
  const { clock, session } = setup(api);
  await session.start({});
  session.enqueue([utt('a'), utt('b')]);
  await clock.advance(3000);
  assert.equal(session.state().error.kind, 'api_unreachable');
  assert.equal(session.state().pending, 2);
  await clock.advance(1000);
  assert.deepEqual(api.calls.send, [['a', 'b'], ['a', 'b']]);
  assert.equal(api.stored.length, 2);
  assert.equal(session.state().duplicates, 2);
  assert.equal(session.state().error, null);
});

test('503 keeps retrying with backoff until the service is back', async () => {
  let down = 2;
  const api = fakeApi();
  const realSend = api.sendUtterances;
  api.sendUtterances = async (id, batch) => (down-- > 0 ? { ok: false, status: 503, message: 'down' } : realSend(id, batch));
  const { clock, session } = setup(api);
  await session.start({});
  session.enqueue([utt('a')]);
  await clock.advance(3000);
  assert.equal(session.state().error.kind, 'service_unavailable');
  await clock.advance(1000 + 2000);
  assert.equal(session.state().sent, 1);
  assert.equal(session.state().error, null);
});

test('409 stops the session and drops what is pending', async () => {
  const api = fakeApi({ async sendUtterances() { return { ok: false, status: 409, message: 'ended' }; } });
  const { clock, session } = setup(api);
  await session.start({});
  session.enqueue([utt('a')]);
  await clock.advance(3000);
  assert.equal(session.state().status, 'error');
  assert.equal(session.state().error.kind, 'conversation_closed');
  assert.equal(session.state().pending, 0);
});

test('400 drops the rejected batch and keeps capturing', async () => {
  let calls = 0;
  const api = fakeApi();
  const realSend = api.sendUtterances;
  api.sendUtterances = async (id, batch) => (++calls === 1 ? { ok: false, status: 400, message: 'bad' } : realSend(id, batch));
  const { clock, session } = setup(api);
  await session.start({});
  session.enqueue([utt('a')]);
  await clock.advance(3000);
  assert.equal(session.state().error.kind, 'rejected');
  session.enqueue([utt('b')]);
  await clock.advance(3000);
  assert.deepEqual(api.stored.map((u) => u.clientId), ['b']);
  assert.equal(session.state().status, 'capturing');
});

test('stop sends pending and final utterances, then ends the conversation', async () => {
  const { api, clock, session } = setup();
  await session.start({});
  session.enqueue([utt('a')]);
  const stopping = session.stop([utt('b')]);
  await clock.advance(0);
  const state = await stopping;
  assert.equal(state.status, 'stopped');
  assert.deepEqual(api.stored.map((u) => u.clientId), ['a', 'b']);
  assert.equal(api.calls.end, 1);
  assert.equal(clock.pendingTimers(), 0);
  session.enqueue([utt('late')]);
  await clock.advance(10_000);
  assert.equal(api.stored.length, 2);
});

test('stop gives up after the retry budget, still ends, and reports what was lost', async () => {
  const api = fakeApi({ async sendUtterances() { return { ok: false, status: 0, message: 'down' }; } });
  const { clock, session } = setup(api);
  await session.start({});
  const stopping = session.stop([utt('a'), utt('b')]);
  await clock.advance(10_000);
  const state = await stopping;
  assert.equal(state.status, 'stopped');
  assert.equal(api.calls.end, 1);
  assert.match(state.error.message, /2 intervenciones/);
});
