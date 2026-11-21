import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { popPanel, verdictAlert } from '../test-dist/alerts.js';

test('true and false verdicts alert in colour; neutral does not', () => {
  assert.deepEqual(verdictAlert('yes'), { color: '#2FD27A', strong: true });
  assert.deepEqual(verdictAlert('probably_yes'), { color: '#2FD27A', strong: false });
  assert.deepEqual(verdictAlert('no'), { color: '#FF5247', strong: true });
  assert.deepEqual(verdictAlert('probably_no'), { color: '#FF5247', strong: false });
  assert.equal(verdictAlert('neutral'), null);
});

function withWindow(reducedMotion, fn) {
  const { window } = new JSDOM('<!doctype html><aside class="panel bump"></aside>');
  window.matchMedia = (query) => ({ matches: reducedMotion && query.includes('reduce') });
  const saved = globalThis.window;
  globalThis.window = window;
  try {
    return fn(window.document.querySelector('.panel'));
  } finally {
    globalThis.window = saved;
  }
}

test('popPanel colours the island and replaces the quiet bump', () => {
  withWindow(false, (panel) => {
    assert.equal(popPanel(panel, 'no'), true);
    assert.equal(panel.style.getPropertyValue('--pc'), '#FF5247');
    assert.deepEqual([...panel.classList].sort(), ['panel', 'pop']);
    assert.equal(popPanel(panel, 'probably_yes'), true);
    assert.equal(panel.classList.contains('soft'), true);
    assert.equal(popPanel(panel, 'neutral'), false);
  });
});

test('popPanel does nothing when the user prefers reduced motion', () => {
  withWindow(true, (panel) => {
    assert.equal(popPanel(panel, 'yes'), false);
    assert.equal(panel.classList.contains('pop'), false);
  });
});
