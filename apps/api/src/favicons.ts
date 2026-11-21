import type { FastifyInstance } from 'fastify';

type Icon = { type: string; body: Buffer };
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

// Public domain names only: no IP addresses, no localhost, no ports.
const hostPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const maxIconBytes = 100_000;
const maxPageBytes = 300_000;
const cacheLimit = 500;

/** Reads at most `limit` bytes. Icons over the limit are rejected; pages are cut, since icon links live in the head. */
async function readLimited(response: Response, limit: number, truncate = false) {
  if (!response.body) return;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    chunks.push(chunk);
    if (size > limit) {
      await response.body.cancel().catch(() => {});
      if (!truncate) return;
      break;
    }
  }
  return Buffer.concat(chunks);
}

function iconLinks(html: string, base: string) {
  const links: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/giu) ?? []) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/iu.exec(tag)?.[1].toLowerCase() ?? '';
    const href = /\bhref\s*=\s*["']?([^"'\s>]+)/iu.exec(tag)?.[1];
    if (!href || !rel.split(/\s+/u).some((value) => value === 'icon' || value === 'apple-touch-icon')) continue;
    try {
      const url = new URL(href.replaceAll('&amp;', '&'), base);
      if (url.protocol === 'https:') links.push(url.href);
    } catch {
      // Ignore malformed icon links.
    }
  }
  return links;
}

/** Fetches a website's favicon so the extension can show it as embedded image data on X. */
export function registerFavicons(app: FastifyInstance, fetcher: Fetcher = fetch) {
  const cache = new Map<string, Promise<Icon | undefined>>();

  async function fetchIcon(url: string) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(4000), redirect: 'follow' });
      const type = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
      if (!response.ok || !type.startsWith('image/') || !response.url.startsWith('https://')) return;
      const body = await readLimited(response, maxIconBytes);
      return body?.length ? { type, body } : undefined;
    } catch {
      return undefined;
    }
  }

  async function findIcon(host: string) {
    return await findIconAt(host) ?? findIconAt(`www.${host}`);
  }

  async function findIconAt(host: string) {
    const home = `https://${host}/`;
    try {
      const response = await fetcher(home, { signal: AbortSignal.timeout(4000), redirect: 'follow', headers: { Accept: 'text/html' } });
      if (response.ok && response.url.startsWith('https://')) {
        const html = (await readLimited(response, maxPageBytes, true))?.toString('utf8') ?? '';
        for (const link of iconLinks(html, response.url)) {
          const icon = await fetchIcon(link);
          if (icon) return icon;
        }
      }
    } catch {
      // Fall back to the conventional location.
    }
    return fetchIcon(new URL('/favicon.ico', home).href);
  }

  app.get<{ Querystring: { host: string } }>('/api/favicon', {
    schema: {
      querystring: {
        type: 'object', required: ['host'], additionalProperties: false,
        properties: { host: { type: 'string', maxLength: 253 } },
      },
    },
  }, async (request, reply) => {
    const host = request.query.host.toLowerCase().replace(/^www\./u, '');
    if (!hostPattern.test(host)) return reply.code(400).send({ message: 'Use a public domain name, such as boe.es.' });

    let icon = cache.get(host);
    if (!icon) {
      if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value!);
      icon = findIcon(host);
      cache.set(host, icon);
    }
    const found = await icon;
    if (!found) return reply.code(404).send({ message: `No favicon found for ${host}.` });
    return reply.header('Cache-Control', 'public, max-age=86400').type(found.type).send(found.body);
  });
}
