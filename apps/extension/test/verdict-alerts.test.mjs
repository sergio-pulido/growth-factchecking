import assert from 'node:assert/strict';
import test from 'node:test';
import { pickVideoRect, verdictAlert } from '../test-dist/alerts.js';

test('true and false verdicts get a green or red border; neutral gets none', () => {
  assert.deepEqual(verdictAlert('yes'), { color: '#2FD27A', strong: true });
  assert.deepEqual(verdictAlert('probably_yes'), { color: '#2FD27A', strong: false });
  assert.deepEqual(verdictAlert('no'), { color: '#FF5247', strong: true });
  assert.deepEqual(verdictAlert('probably_no'), { color: '#FF5247', strong: false });
  assert.equal(verdictAlert('neutral'), null);
});

const viewport = { width: 1600, height: 900 };

test('the border goes around the largest visible video', () => {
  const player = { x: 20, y: 150, width: 1380, height: 776 };
  const preview = { x: 1430, y: 210, width: 340, height: 190 };
  assert.deepEqual(pickVideoRect([preview, player], viewport), { x: 20, y: 150, width: 1380, height: 750 });
});

test('small or off-screen videos are ignored, so the border falls back to the screen', () => {
  assert.equal(pickVideoRect([], viewport), null);
  assert.equal(pickVideoRect([{ x: 10, y: 10, width: 200, height: 112 }], viewport), null);
  assert.equal(pickVideoRect([{ x: 0, y: 1200, width: 1280, height: 720 }], viewport), null);
});

test('a video partly scrolled out is framed only where it is visible', () => {
  assert.deepEqual(pickVideoRect([{ x: 0, y: -300, width: 1280, height: 720 }], viewport), { x: 0, y: 0, width: 1280, height: 420 });
});
