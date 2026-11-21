import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createMeetSource } from '../test-dist/meet-source.js';

function setup(t) {
  const host = new JSDOM('<div role="region" aria-label="Subtítulos"></div>', { url: 'https://meet.google.com' }).window;
  const floating = new JSDOM('', { url: 'https://meet.google.com' }).window;
  const pip = new host.EventTarget();
  pip.window = null;
  host.documentPictureInPicture = pip;
  let tick;
  floating.setInterval = (fn) => { tick = fn; return 1; };
  floating.clearInterval = () => { tick = undefined; };
  let now = 0;
  const segments = [];
  const source = createMeetSource({ hostWindow: host, now: () => now, pollMs: 60_000 });

  function captions(root, speaker, text) {
    root.innerHTML = '<div class="nMcdL bj4p3b"><span class="NWpY1d"></span><div class="ygicle VbkSUe"></div></div>';
    root.querySelector('.NWpY1d').textContent = speaker;
    root.querySelector('.VbkSUe').textContent = text;
  }

  t.after(() => {
    source.stop();
    host.close();
    floating.close();
  });

  return {
    source, segments,
    main: (speaker, text) => captions(host.document.querySelector('[role="region"]'), speaker, text),
    floating: (speaker, text) => captions(floating.document.body, speaker, text),
    async start() {
      await source.start({ segments: (items) => segments.push(...items), activity() {}, failed: assert.fail });
    },
    open() {
      pip.window = floating;
      pip.dispatchEvent(new host.Event('enter'));
    },
    close() {
      pip.window = null;
      floating.dispatchEvent(new floating.Event('pagehide'));
    },
    settle() {
      now += 5000;
      tick();
    },
    ticking: () => Boolean(tick),
  };
}

test('Meet follows the floating window and returns to the tab without duplicating captions', async (t) => {
  const call = setup(t);
  call.main('Tú', 'Texto anterior al inicio.');
  await call.start();
  call.open();
  call.floating('Marc', 'Lumen Labs se fundó en 2021.');
  await Promise.resolve(); // The floating document's MutationObserver reads the new caption.
  call.settle(); // No timer from the original tab ran.
  call.main('Marc', 'Lumen Labs se fundó en 2021.');
  call.close();

  assert.equal(call.ticking(), false);
  assert.deepEqual(call.source.stop(), []);
  assert.deepEqual(call.segments, [{ speaker: 'Marc', text: 'Lumen Labs se fundó en 2021.', kind: 'named' }]);
});

test('Meet ignores existing floating captions on start and resume, and stops observing on stop', async (t) => {
  const call = setup(t);
  call.floating('Tú', 'Antes de empezar.');
  call.open();
  await call.start();
  call.settle();
  assert.deepEqual(call.source.pause(), []);
  call.floating('Tú', 'Texto hablado durante la pausa.');
  await Promise.resolve();
  call.source.resume();
  call.settle();
  assert.deepEqual(call.segments, []);

  assert.deepEqual(call.source.stop(), []);
  call.floating('Tú', 'Después de detener.');
  await Promise.resolve();
  assert.equal(call.ticking(), false);
  assert.deepEqual(call.segments, []);
});
