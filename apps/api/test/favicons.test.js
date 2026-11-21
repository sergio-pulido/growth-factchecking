import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerFavicons } from '../dist/favicons.js';

const png = Buffer.from('89504e470d0a1a0a', 'hex');

function respond(url, body, type, status = 200) {
  const response = new Response(body, { status, headers: { 'content-type': type } });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

function appWith(routes) {
  const requested = [];
  const app = Fastify({ logger: false });
  registerFavicons(app, async (url) => {
    requested.push(url);
    const route = routes[url];
    return route ? respond(url, ...route) : respond(url, 'Not found', 'text/plain', 404);
  });
  return { app, requested };
}

test('the favicon comes from the icon link on the home page', async (t) => {
  const { app } = appWith({
    'https://boe.es/': ['<head><link rel="shortcut icon" href="/img/icon.png"></head>', 'text/html'],
    'https://boe.es/img/icon.png': [png, 'image/png'],
  });
  t.after(() => app.close());

  const response = await app.inject('/api/favicon?host=www.boe.es');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'image/png');
  assert.deepEqual(response.rawPayload, png);
});

test('without an icon link, the favicon comes from /favicon.ico and is cached', async (t) => {
  const { app, requested } = appWith({
    'https://ine.es/': ['<head><title>INE</title></head>', 'text/html'],
    'https://ine.es/favicon.ico': [png, 'image/x-icon'],
  });
  t.after(() => app.close());

  assert.equal((await app.inject('/api/favicon?host=ine.es')).statusCode, 200);
  assert.equal((await app.inject('/api/favicon?host=ine.es')).statusCode, 200);
  assert.deepEqual(requested, ['https://ine.es/', 'https://ine.es/favicon.ico']);
});

test('a site without a favicon returns 404', async (t) => {
  const { app } = appWith({ 'https://example.org/favicon.ico': ['<html></html>', 'text/html'] });
  t.after(() => app.close());

  assert.equal((await app.inject('/api/favicon?host=example.org')).statusCode, 404);
});

test('only public domain names are fetched', async (t) => {
  const { app, requested } = appWith({});
  t.after(() => app.close());

  for (const host of ['localhost', '127.0.0.1', '10.0.0.1', 'boe.es:8080', 'boe.es/path']) {
    assert.equal((await app.inject(`/api/favicon?host=${encodeURIComponent(host)}`)).statusCode, 400, host);
  }
  assert.deepEqual(requested, []);
});
