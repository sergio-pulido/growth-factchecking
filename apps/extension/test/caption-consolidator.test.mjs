import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifySpeaker,
  createCaptionConsolidator,
  dropLeadingWords,
  isRevision,
  words,
} from '../test-dist/caption-consolidator.js';
import { EXPECTED, STEPS } from './fixtures/meet-call-es.mjs';

const options = { idPrefix: 's1', settleMs: 1200, idleCommitMs: 4000, unknownSpeaker: 'Unknown' };

function run(steps, extra = {}) {
  const c = createCaptionConsolidator({ ...options, ...extra });
  const out = [];
  for (const { at, rows } of steps) out.push(...c.observe(rows, at));
  out.push(...c.flush());
  return out;
}

test('the Spanish call yields one utterance per intervention, in order, with speakers', () => {
  const out = run(STEPS);
  assert.deepEqual(out.map(({ speaker, text }) => ({ speaker, text })), EXPECTED);
  assert.ok(out.every((u) => u.speakerKind === 'named'));
});

test('partial updates of one caption consolidate into one utterance with a stable clientId', () => {
  const out = run(STEPS);
  const ids = out.map((u) => u.clientId);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ['s1-1', 's1-2', 's1-3', 's1-4', 's1-5']);
  // spokenAt is when the caption first appeared, not when it became final.
  assert.equal(out[0].spokenAt, new Date(0).toISOString());
  assert.equal(out[2].spokenAt, new Date(8200).toISOString());
});

test('the same snapshots replayed twice give the same clientIds (retries stay idempotent)', () => {
  assert.deepEqual(run(STEPS).map((u) => u.clientId), run(STEPS).map((u) => u.clientId));
});

test('a caption that stays on screen after being emitted is not emitted again', () => {
  const c = createCaptionConsolidator(options);
  const row = { speaker: 'Ana', text: 'Tenemos 42 clientes.' };
  assert.equal(c.observe([row], 0).length, 0);
  assert.equal(c.observe([row], 5000).length, 1);
  for (let t = 5500; t < 20_000; t += 500) assert.equal(c.observe([row], t).length, 0);
  assert.equal(c.flush().length, 0);
});

test('a shorter redraw keeps the fuller text', () => {
  const c = createCaptionConsolidator(options);
  c.observe([{ speaker: 'Ana', text: 'Facturamos un millón de euros' }], 0);
  c.observe([{ speaker: 'Ana', text: 'Facturamos un millón' }], 300);
  assert.equal(c.flush()[0].text, 'Facturamos un millón de euros');
});

test('captions without a speaker, and the local user, are classified', () => {
  const c = createCaptionConsolidator(options);
  c.observe([{ speaker: '', text: 'Texto sin hablante' }, { speaker: 'Tú', text: 'Mi pregunta' }], 0);
  const out = c.flush();
  assert.deepEqual(out.map((u) => [u.speaker, u.speakerKind]), [['Unknown', 'unknown'], ['Tú', 'self']]);
  assert.equal(classifySpeaker('You'), 'self');
  assert.equal(classifySpeaker('Marc Puig'), 'named');
});

test('tick emits a settled caption that left the screen without a new snapshot', () => {
  const c = createCaptionConsolidator(options);
  c.observe([{ speaker: 'Ana', text: 'Una frase completa.' }], 0);
  c.observe([], 500);
  assert.equal(c.tick(1000).length, 0);
  assert.equal(c.tick(1300).length, 1);
});

test('word helpers', () => {
  assert.deepEqual(words('¿Cuántos  ingresos, 50.000€?'), ['cuantos', 'ingresos', '50', '000']);
  assert.equal(isRevision(words('Fundamos Lumen Labs en 2020'), words('Fundamos Lumen Labs en 2021 en')), true);
  assert.equal(isRevision(words('Fundamos Lumen Labs'), words('En octubre cerramos')), false);
  assert.equal(dropLeadingWords('Hola Marc, gracias. ¿Cuántos clientes?', 3), '¿Cuántos clientes?');
});
