import assert from 'node:assert/strict';
import test from 'node:test';

// call-relay touches `chrome` only when it runs a request; validation is pure.
globalThis.chrome = { runtime: {}, storage: { session: {} } };
const { isCallRequest, looksLikeCallRequest, relayCallRequest } = await import('../test-dist/call-relay.js');

const start = (pageUrl) => ({ kind: 'call-start', platform: 'web', capture: 'audio', title: 'A talk - YouTube', pageUrl });

test('accepts a start from the same page', () => {
  assert.equal(isCallRequest(start('https://www.youtube.com/watch'), 'https://www.youtube.com/watch?v=abc'), true);
});

test('accepts a start after in-app navigation changed the path (YouTube, Meet, Teams)', () => {
  assert.equal(isCallRequest(start('https://www.youtube.com/watch'), 'https://www.youtube.com/'), true);
});

test('rejects a page URL from another site', () => {
  assert.equal(isCallRequest(start('https://evil.example/watch'), 'https://www.youtube.com/watch'), false);
});

test('rejects malformed requests but still recognises them, so the overlay gets an error instead of silence', () => {
  const bad = { kind: 'audio-start', language: 'spanish' };
  assert.equal(isCallRequest(bad, 'https://www.youtube.com/watch'), false);
  assert.equal(looksLikeCallRequest(bad), true);
  assert.equal(looksLikeCallRequest({ mode: 'live', claim: 'x' }), false);
});

test('the microphone can only be requested from Google Meet', () => {
  const request = { kind: 'audio-start', language: 'en', microphone: true };
  assert.equal(isCallRequest(request, 'https://meet.google.com/abc-defg-hij'), true);
  assert.equal(isCallRequest(request, 'https://www.youtube.com/watch'), false);
  assert.equal(isCallRequest(request, 'https://meet.google.com.example.test/'), false);
});

test('a denied tab capture uses the already authorized microphone in Meet', async (t) => {
  const commands = [];
  chrome.storage.session = { async get() { return {}; }, async set() {}, async remove() {} };
  chrome.runtime = {
    ContextType: { OFFSCREEN_DOCUMENT: 'offscreen' },
    async getContexts() { return [{ contextType: 'offscreen' }]; },
    async sendMessage(command) {
      commands.push(command);
      return command.kind === 'microphone-status' ? { ok: true, permission: 'granted' } : { ok: true };
    },
  };
  chrome.offscreen = { async closeDocument() {} };
  chrome.tabCapture = { async getMediaStreamId() { throw new Error('User has not invoked the extension.'); } };
  t.mock.method(console, 'info', () => {});
  t.mock.method(globalThis, 'fetch', async () => Response.json({ value: 'test', expiresAt: 12345 }));

  assert.deepEqual(await relayCallRequest({ kind: 'audio-start', language: 'en', microphone: true }, 42), {
    ok: true, result: 'microphone',
  });
  assert.deepEqual(commands.at(-1), { target: 'offscreen', kind: 'start', token: 'test', microphone: true });
  await relayCallRequest({ kind: 'audio-stop' }, 42);
});
