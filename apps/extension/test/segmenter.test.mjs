import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignConsumed, CaptionSegmenter, takeSentences } from '../test-dist/segmenter.js';

const words = (text) => text.split(' ');

test('a block is final once it stops changing', () => {
  const seg = new CaptionSegmenter({ quietMs: 1000 });
  const key = {};
  assert.deepEqual(seg.update([{ key, speaker: 'Mateo', text: 'Tenemos 42' }], 0), []);
  assert.deepEqual(seg.update([{ key, speaker: 'Mateo', text: 'Tenemos 42 clientes de pago' }], 300), []);
  assert.deepEqual(seg.update([{ key, speaker: 'Mateo', text: 'Tenemos 42 clientes de pago' }], 1300),
    [{ speaker: 'Mateo', text: 'Tenemos 42 clientes de pago' }]);
  // Nothing new: nothing is emitted twice.
  assert.deepEqual(seg.update([{ key, speaker: 'Mateo', text: 'Tenemos 42 clientes de pago' }], 5000), []);
});

test('a finished sentence is emitted while the speaker keeps talking', () => {
  const seg = new CaptionSegmenter({ quietMs: 5000, wordsAfterSentence: 3 });
  const key = {};
  assert.deepEqual(seg.update([{ key, speaker: 'M', text: 'Tenemos 42 clientes. En octubre' }], 0), []);
  assert.deepEqual(seg.update([{ key, speaker: 'M', text: 'Tenemos 42 clientes. En octubre registramos 32.000' }], 100),
    [{ speaker: 'M', text: 'Tenemos 42 clientes.' }]);
  assert.deepEqual(seg.flush(), [{ speaker: 'M', text: 'En octubre registramos 32.000' }]);
});

test('a new speaker block finalizes the previous one', () => {
  const seg = new CaptionSegmenter({ quietMs: 5000 });
  const clara = {};
  const mateo = {};
  seg.update([{ key: clara, speaker: 'Clara', text: '¿Qué tal la retención?' }], 0);
  assert.deepEqual(
    seg.update([{ key: clara, speaker: 'Clara', text: '¿Qué tal la retención?' }, { key: mateo, speaker: 'Mateo', text: 'Fue' }], 100),
    [{ speaker: 'Clara', text: '¿Qué tal la retención?' }],
  );
});

test('a block that leaves the screen is emitted', () => {
  const seg = new CaptionSegmenter({ quietMs: 5000 });
  const key = {};
  seg.update([{ key, speaker: 'Clara', text: 'Hola Mateo' }], 0);
  assert.deepEqual(seg.update([], 100), [{ speaker: 'Clara', text: 'Hola Mateo' }]);
});

test('revised words already emitted are not sent again', () => {
  const seg = new CaptionSegmenter({ quietMs: 1000 });
  const key = {};
  seg.update([{ key, speaker: 'M', text: 'registramos 32 000 euros' }], 0);
  assert.equal(seg.update([{ key, speaker: 'M', text: 'registramos 32 000 euros' }], 1000).length, 1);
  // Meet rewrites "32 000" as "32.000" and the speaker goes on.
  seg.update([{ key, speaker: 'M', text: 'Registramos 32.000 euros de ingresos recurrentes' }], 1100);
  assert.deepEqual(seg.update([{ key, speaker: 'M', text: 'Registramos 32.000 euros de ingresos recurrentes' }], 2200),
    [{ speaker: 'M', text: 'de ingresos recurrentes' }]);
});

test('text trimmed at the start of a long block is aligned on the last emitted words', () => {
  assert.equal(alignConsumed(words('uno dos tres cuatro cinco seis'), words('cuatro cinco seis siete ocho')), 3);
});

test('a block reused for unrelated speech is treated as new', () => {
  assert.equal(alignConsumed(words('hola qué tal'), words('el piloto se firmó en octubre')), 0);
});

test('speech on screen while paused is skipped, not sent later', () => {
  const seg = new CaptionSegmenter({ quietMs: 1000 });
  const key = {};
  seg.update([{ key, speaker: 'M', text: 'Esto es privado' }], 0);
  seg.skipPending();
  assert.deepEqual(seg.update([{ key, speaker: 'M', text: 'Esto es privado' }], 2000), []);
  seg.update([{ key, speaker: 'M', text: 'Esto es privado y esto no' }], 2100);
  assert.deepEqual(seg.flush(), [{ speaker: 'M', text: 'y esto no' }]);
});

test('segments without letters are dropped', () => {
  const seg = new CaptionSegmenter({ quietMs: 0 });
  assert.deepEqual(seg.update([{ key: {}, speaker: 'M', text: '... 42' }], 0), []);
});

test('pausing keeps finished sentences and drops the unfinished one', () => {
  const seg = new CaptionSegmenter({ quietMs: 5000 });
  const key = {};
  seg.update([{ key, speaker: 'M', text: 'Tenemos 42 clientes. La retención' }], 0);
  assert.deepEqual(seg.flushSentences(), [{ speaker: 'M', text: 'Tenemos 42 clientes.' }]);
  // The rest of the unfinished sentence, said after the pause, is not sent either.
  seg.update([{ key, speaker: 'M', text: 'Tenemos 42 clientes. La retención fue del 94 %.' }], 100);
  seg.skipPending();
  assert.deepEqual(seg.flush(), []);
});

test('pausing after a finished sentence keeps all of it', () => {
  const seg = new CaptionSegmenter({ quietMs: 5000 });
  seg.update([{ key: {}, speaker: 'M', text: 'Tenemos 42 clientes de pago.' }], 0);
  assert.deepEqual(seg.flushSentences(), [{ speaker: 'M', text: 'Tenemos 42 clientes de pago.' }]);
});

test('a streamed transcript is cut into finished sentences', () => {
  assert.deepEqual(takeSentences(' Hola a todos. Teníamos 42 clientes. En octubre'),
    { done: ['Hola a todos.', 'Teníamos 42 clientes.'], rest: 'En octubre' });
  // The last sentence is not finished until another word follows it.
  assert.deepEqual(takeSentences('Teníamos 42 clientes.'), { done: [], rest: 'Teníamos 42 clientes.' });
  assert.deepEqual(takeSentences('uno dos tres cuatro', 2), { done: ['uno dos'], rest: 'tres cuatro' });
});
