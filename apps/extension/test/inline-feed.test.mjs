import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><body></body>');
globalThis.document = window.document;
globalThis.NodeFilter = window.NodeFilter;
const { findCheckedRange, sourceLabel } = await import('../test-dist/inline-feed.js');

function post(html) {
  const element = document.createElement('div');
  element.innerHTML = html;
  return element;
}

test('the line that shares a date with the evidence is highlighted, not the one with a date only in a hashtag', () => {
  const text = post('<img alt="🗳️"><a>#VotoCERA</a>: si eres español residente en el extranjero con derecho a voto en las <a>#EleccionesGenerales</a> del <a>#29N</a>, consulta el <a>#VotoExterior</a>.\n\n<img alt="ℹ️"> <a>#VotoPorCorreo</a> al Consulado <img alt="➡️"> Plazo hasta el 24 de noviembre.\n\nToda la información en <a>exteriores.gob.es/es/Paginas/Ele…</a>');
  const range = findCheckedRange(text, 'For Spain\'s 29 November 2026 general election, eligible CERA voters sending their postal vote from abroad to their consular office must dispatch it no later than 24 November 2026.');
  assert.equal(range?.toString(), '#VotoPorCorreo al Consulado  Plazo hasta el 24 de noviembre.');
});

test('a sentence spread over several text nodes is highlighted whole', () => {
  const text = post('Hola. Madrid elige <span>37</span> diputados al Congreso. Adiós.');
  assert.equal(findCheckedRange(text, 'Madrid elects 37 deputies to the Congress.')?.toString(), 'Madrid elige 37 diputados al Congreso.');
});

test('nothing is highlighted when no sentence clearly matches', () => {
  assert.equal(findCheckedRange(post('La obsesión socialista porque España se quede atrás'), 'Inflation was 3.1% in October 2026.'), undefined);
});

test('source labels use the page slug, or the site when there is none', () => {
  assert.equal(sourceLabel('https://www.lamoncloa.gob.es/notasprensa/voto-extranjero-elecciones-generales-29n.aspx'), 'Voto extranjero elecciones generales 29n');
  assert.equal(sourceLabel('https://www.exteriores.gob.es/Paginas/ELECCIONES-GENERALES-DE-29-DE-NOVIEMBRE.aspx'), 'Elecciones generales de 29 de noviembre');
  assert.equal(sourceLabel('https://www.ine.es/'), 'ine.es');
  assert.equal(sourceLabel('https://www.exteriores.gob.es/es/Paginas/index.aspx'), 'exteriores.gob.es');
});
