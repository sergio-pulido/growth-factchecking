import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createAudioSource } from '../test-dist/audio-source.js';
import { mountCallPanel } from '../test-dist/call-panel.js';
import { createCallSession } from '../test-dist/call-session.js';
import { settle } from './helpers.mjs';

const saved = { accepted: 1, duplicates: 0, claims: [], extraction: 'ok' };

test('shows provisional audio text immediately and checks only the finished transcript', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000 });
  const { window } = new JSDOM('<!doctype html><body></body>');
  window.setInterval = setInterval;
  window.clearInterval = clearInterval;
  t.mock.method(window.HTMLCanvasElement.prototype, 'getContext', () => null);
  let onMessage;
  Object.assign(globalThis, {
    window,
    document: window.document,
    CSSStyleSheet: class { replaceSync() {} },
    getComputedStyle: window.getComputedStyle,
    requestAnimationFrame() {},
    chrome: { runtime: { onMessage: {
      addListener(listener) { onMessage = listener; },
      removeListener() { onMessage = undefined; },
    } } },
  });
  let shadow;
  const attachShadow = window.Element.prototype.attachShadow;
  t.mock.method(window.Element.prototype, 'attachShadow', function (options) {
    shadow = attachShadow.call(this, options);
    return shadow;
  });

  const sent = [];
  let receiveResult;
  const panel = mountCallPanel(createAudioSource(async () => undefined, 'meet'), {
    async start() { return { id: 'conversation' }; },
    send(_id, batch) {
      sent.push(...batch);
      return new Promise((resolve) => { receiveResult = resolve; });
    },
    async end() {},
  }, { autoStart: true });
  t.after(() => {
    panel.destroy();
    window.close();
  });
  await settle();

  const status = () => shadow.querySelector('.capture-status').textContent;
  const draft = () => shadow.querySelector('.line-draft .quote');
  const delta = (text) => onMessage({ kind: 'audio-delta', itemId: 'audio-item', text });
  shadow.querySelectorAll('.tabs button')[2].click();
  assert.match(status(), /Listening for speech/);
  delta('We had 42 ');
  assert.equal(draft().textContent, 'We had 42');
  assert.match(status(), /Transcribing speech/);
  const draftNode = draft();
  t.mock.timers.tick(2400);
  assert.equal(sent.length, 0, 'a bare number may still be missing its unit');
  delta('paying customers');
  assert.equal(draft(), draftNode, 'updates the draft without remounting it');
  assert.equal(draft().textContent, 'We had 42 paying customers');

  t.mock.timers.tick(2400);
  assert.equal(draft(), null);
  assert.equal(shadow.querySelector('.line .quote').textContent, 'We had 42 paying customers');
  t.mock.timers.tick(250);
  assert.deepEqual(sent.map(({ text }) => text), ['We had 42 paying customers']);
  assert.match(status(), /Extracting and checking claims/);
  receiveResult(saved);
  await settle();
  assert.match(status(), /Listening for speech/);

  delta('This unfinished part');
  shadow.querySelector('button[aria-label="Pause listening"]').click();
  assert.equal(draft(), null);
  delta(' is said on pause.');
  shadow.querySelector('button[aria-label="Resume listening"]').click();
  assert.equal(draft(), null);
  assert.equal(sent.length, 1);
});

test('new sentences cannot delay a pending batch or bypass retry backoff', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  let sink;
  const sent = [];
  let finishRequest;
  const session = createCallSession({
    platform: 'meet', capture: 'audio',
    async start(next) { sink = next; },
    stop() { return []; },
  }, {
    async start() { return { id: 'conversation' }; },
    send(_id, batch) {
      sent.push(batch.map(({ clientId }) => clientId));
      return new Promise((resolve, reject) => { finishRequest = { resolve, reject }; });
    },
    async end() {},
  }, { onChange() {}, onVerdict() {} });
  t.after(() => session.dispose());
  await session.start();
  const speak = (text) => sink.segments([{ speaker: 'Call audio', text }]);

  speak('First sentence.');
  t.mock.timers.tick(200);
  speak('Second sentence.');
  t.mock.timers.tick(50);
  assert.deepEqual(sent, [['u1', 'u2']]);

  speak('Third sentence.');
  t.mock.timers.tick(500);
  assert.equal(sent.length, 1, 'only one request is in flight');
  finishRequest.resolve(saved);
  await settle();
  t.mock.timers.tick(1);
  assert.deepEqual(sent[1], ['u3']);

  finishRequest.reject(new Error('API unavailable'));
  await settle();
  t.mock.timers.tick(1000);
  speak('Fourth sentence.');
  speak('Fifth sentence.');
  speak('Sixth sentence.');
  t.mock.timers.tick(2999);
  assert.equal(sent.length, 2);
  t.mock.timers.tick(1);
  assert.deepEqual(sent[2], ['u3', 'u4', 'u5', 'u6']);
  finishRequest.resolve(saved);
  await settle();
  await session.stop();
});
