// Bundles the Chrome-free capture modules as ESM so `node --test` can import them.
import { build } from 'esbuild';

await build({
  entryPoints: {
    'caption-consolidator': 'src/meet/caption-consolidator.ts',
    'meet-captions-dom': 'src/meet/meet-captions-dom.ts',
    'inline-feed': 'src/inline-feed.ts',
    card: 'src/card.ts',
    segmenter: 'src/call/segmenter.ts',
    'call-session': 'src/call/session.ts',
    'meet-source': 'src/call/meet-source.ts',
    'http-transport': 'src/call/http-transport.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outdir: 'test-dist',
  loader: { '.css': 'text' },
  logLevel: 'warning',
});
