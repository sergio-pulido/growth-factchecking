import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeTerms } from '../test-dist/terms.js';

test('Spanish captions of "OpenAI" become the brand name', () => {
  for (const heard of ['open ei', 'open AI', 'OPEN A.I.', 'Openai', 'oupen ei', 'Open Ay', 'open eye', 'open-ai']) {
    assert.equal(normalizeTerms(`Según ${heard}, el modelo es gratis`), 'Según OpenAI, el modelo es gratis', heard);
  }
});

test('other names are fixed and ordinary words are left alone', () => {
  assert.equal(normalizeTerms('chat jipiti y el códex en it nig'), 'ChatGPT y el Codex en Itnig');
  for (const text of ['abrir la ventana', 'operación', 'openly', 'opening', 'open', 'Open, ¿y tú?']) {
    assert.equal(normalizeTerms(text), text);
  }
});
