import assert from 'node:assert/strict';
import test from 'node:test';
import { createMeetCaptureController } from '../test-dist/capture-controller.js';
import { EXPECTED, STEPS } from './fixtures/meet-call-es.mjs';
import { fakeApi, fakeClock } from './helpers.mjs';

function setup(api = fakeApi()) {
  const clock = fakeClock();
  let rows = [];
  let reads = 0;
  const reader = { read: () => { reads++; return rows; } };
  const controller = createMeetCaptureController({
    reader, api, scheduler: clock.scheduler, now: clock.now, pollMs: 100,
    newIdPrefix: () => 'meet-test', meta: () => ({ title: 'Reunión', language: 'es' }),
    session: { flushIntervalMs: 3000, maxBatch: 10 },
  });
  return {
    api, clock, controller,
    setRows: (next) => { rows = next; },
    setReader: (fn) => { reader.read = fn; },
    reads: () => reads,
  };
}

/** Plays the fixture: each step's rows stay visible until the next step. */
async function play(ctx, steps) {
  let at = 0;
  for (const step of steps) {
    await ctx.clock.advance(step.at - at);
    at = step.at;
    ctx.setRows(step.rows);
  }
  await ctx.clock.advance(500);
}

test('nothing is read before start', async () => {
  const ctx = setup();
  ctx.setRows(STEPS[3].rows);
  await ctx.clock.advance(5000);
  assert.equal(ctx.reads(), 0);
  assert.equal(ctx.api.calls.create, 0);
  assert.equal(ctx.controller.getState().active, false);
});

test('the Spanish call is captured end to end: speakers kept, each intervention stored once', async () => {
  const ctx = setup();
  const states = [];
  ctx.controller.subscribe((s) => states.push(s));
  const started = await ctx.controller.start();
  assert.equal(started.active, true);
  assert.equal(started.status, 'capturing');

  await play(ctx, STEPS);
  const stopped = await ctx.controller.stop();
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.active, false);

  assert.deepEqual(ctx.api.stored.map(({ speaker, text }) => ({ speaker, text })), EXPECTED);
  const ids = ctx.api.stored.map((u) => u.clientId);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ctx.api.calls.end, 1);
  assert.equal(stopped.sent, EXPECTED.length);
  assert.ok(states.some((s) => s.active && s.captionsDetected));
});

test('stop ends reading at once and later captions are ignored', async () => {
  const ctx = setup();
  await ctx.controller.start();
  ctx.setRows([{ speaker: 'Ana', text: 'Tenemos 42 clientes' }]);
  await ctx.clock.advance(300);
  await ctx.controller.stop();
  const readsAtStop = ctx.reads();
  const sendsAtStop = ctx.api.calls.send.length;
  assert.deepEqual(ctx.api.stored.map((u) => u.text), ['Tenemos 42 clientes']);

  ctx.setRows([{ speaker: 'Ana', text: 'Esto ya no se captura' }]);
  await ctx.clock.advance(20_000);
  assert.equal(ctx.reads(), readsAtStop);
  assert.equal(ctx.api.calls.send.length, sendsAtStop);
  assert.equal(ctx.clock.pendingTimers(), 0);
});

test('captionsDetected is false while Meet shows no caption area', async () => {
  const ctx = setup();
  ctx.setReader(() => null);
  await ctx.controller.start();
  await ctx.clock.advance(300);
  assert.equal(ctx.controller.getState().captionsDetected, false);
  ctx.setReader(() => []);
  await ctx.clock.advance(300);
  assert.equal(ctx.controller.getState().captionsDetected, true);
  await ctx.controller.stop();
});

test('a conversation closed elsewhere stops reading', async () => {
  const ctx = setup(fakeApi({ async sendUtterances() { return { ok: false, status: 409, message: 'ended' }; } }));
  await ctx.controller.start();
  ctx.setRows([{ speaker: 'Ana', text: 'Una frase' }]);
  await ctx.clock.advance(5000);
  ctx.setRows([]);
  await ctx.clock.advance(5000);
  const reads = ctx.reads();
  await ctx.clock.advance(5000);
  assert.equal(ctx.controller.getState().status, 'error');
  assert.equal(ctx.controller.getState().error.kind, 'conversation_closed');
  assert.equal(ctx.reads(), reads);
});
