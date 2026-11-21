import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConversationConfig } from '../dist/conversations/config.js';
import { createOpenAIClient } from '../dist/live/openai.js';

const base = { openaiApiKey: 'test-key-not-real', openaiTimeoutMs: 2500 };

function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('call fact-checks default to 5 s and one retry per OpenAI call', () => {
  withEnv({ CLAIM_CHECK_TIMEOUT_MS: undefined, CLAIM_CHECK_RETRIES: undefined }, () => {
    const config = loadConversationConfig();
    assert.equal(config.checkTimeoutMs, 5000);
    assert.equal(config.checkRetries, 1);
  });
});

test('call fact-check timeout and retries can be tuned and are validated', () => {
  withEnv({ CLAIM_CHECK_TIMEOUT_MS: '8000', CLAIM_CHECK_RETRIES: '0' }, () => {
    const config = loadConversationConfig();
    assert.equal(config.checkTimeoutMs, 8000);
    assert.equal(config.checkRetries, 0);
  });
  withEnv({ CLAIM_CHECK_RETRIES: '9' }, () => assert.throws(() => loadConversationConfig(), /CLAIM_CHECK_RETRIES/));
  withEnv({ CLAIM_CHECK_TIMEOUT_MS: 'fast' }, () => assert.throws(() => loadConversationConfig(), /CLAIM_CHECK_TIMEOUT_MS/));
});

test('the interactive client still fails fast: no retries unless asked', () => {
  const interactive = createOpenAIClient(base);
  assert.equal(interactive.maxRetries, 0);
  assert.equal(interactive.timeout, 2500);
  const calls = createOpenAIClient({ ...base, openaiTimeoutMs: 5000, openaiMaxRetries: 1 });
  assert.equal(calls.maxRetries, 1);
  assert.equal(calls.timeout, 5000);
});
