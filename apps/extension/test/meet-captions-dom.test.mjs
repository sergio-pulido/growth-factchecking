import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { findCaptionRegion, isNotice, readCaptionRows } from '../test-dist/meet-captions-dom.js';

const doc = (html) => new JSDOM(`<!doctype html><body>${html}</body>`).window.document;

// Shape reported by public 2026 Meet caption readers: region > row > speaker + text. Not verified on a live call.
const row = (speaker, text) =>
  `<div jsname="dsyhDe" class="nMcdL"><div class="KcIKyf"><span>${speaker}</span></div><div class="bh44bd">${text}</div></div>`;

test('reads rows from a caption region labelled in Spanish', () => {
  const d = doc(`<div role="region" aria-label="Subtítulos">${row('Laura Gómez', '¿Cuántos clientes tenéis?')}${row('Marc Puig', 'Tenemos 42.')}</div>`);
  assert.deepEqual(readCaptionRows(d), [
    { speaker: 'Laura Gómez', text: '¿Cuántos clientes tenéis?' },
    { speaker: 'Marc Puig', text: 'Tenemos 42.' },
  ]);
});

test('also finds the English region and the jsname fallback', () => {
  assert.ok(findCaptionRegion(doc('<div role="region" aria-label="Captions"></div>')));
  assert.ok(findCaptionRegion(doc('<div jsname="tgaKEf"></div>')));
  assert.equal(findCaptionRegion(doc('<div role="region" aria-label="Participantes"></div>')), null);
});

test('returns null when there is no caption area (captions off)', () => {
  assert.equal(readCaptionRows(doc('<main>Meet</main>')), null);
});

test('strips buttons and icon ligatures, and drops speaker-less notices', () => {
  const d = doc(`<div role="region" aria-label="Captions">
    <div jsname="dsyhDe"><div class="bh44bd">Los subtítulos están activados</div></div>
    ${row('Marc Puig', 'Fundamos la empresa en 2021')}
    <div jsname="dsyhDe"><div class="bh44bd">Laura Gómez se ha unido</div></div>
    <button><i class="google-material-icons">arrow_downward</i>Ir al final</button>
  </div>`);
  assert.deepEqual(readCaptionRows(d), [{ speaker: 'Marc Puig', text: 'Fundamos la empresa en 2021' }]);
});

test('a speaker saying notice-like words is kept', () => {
  const d = doc(`<div role="region" aria-label="Captions">${row('Marc Puig', 'Un cliente nuevo se ha unido')}</div>`);
  assert.equal(readCaptionRows(d).length, 1);
});

test('nested row matches are read once', () => {
  const d = doc(`<div role="region" aria-label="Captions"><div class="CNusmb">${row('Ana', 'Hola')}</div></div>`);
  assert.equal(readCaptionRows(d).length, 1);
});

test('unknown layout falls back to the last non-notice line without a speaker', () => {
  const d = doc('<div role="region" aria-label="Captions"><div>Primera línea</div><div>Última línea</div><div>Live captions are on</div></div>');
  assert.deepEqual(readCaptionRows(d), [{ speaker: '', text: 'Última línea' }]);
});

test('notice patterns', () => {
  for (const notice of ['Live captions are on', 'Tu micrófono está desactivado', 'Marc has left the meeting', 'Jump to bottom']) {
    assert.equal(isNotice(notice), true, notice);
  }
  assert.equal(isNotice('Facturamos 27.800 euros'), false);
});
