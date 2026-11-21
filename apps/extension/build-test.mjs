// Bundles the Chrome-free capture modules as ESM so `node --test` can import them.
import { build } from 'esbuild';

await build({
  entryPoints: {
    'caption-consolidator': 'src/meet/caption-consolidator.ts',
    'meet-captions-dom': 'src/meet/meet-captions-dom.ts',
    'inline-feed': 'src/inline-feed.ts',
    card: 'src/card.ts',
    segmenter: 'src/call/segmenter.ts',
    terms: 'src/call/terms.ts',
    'call-session': 'src/call/session.ts',
    'audio-source': 'src/call/audio-source.ts',
    'call-panel': 'src/call/panel.ts',
    'meet-source': 'src/call/meet-source.ts',
    'http-transport': 'src/call/http-transport.ts',
    'call-relay': 'src/call-relay.ts',
    offscreen: 'src/offscreen.ts',
    alerts: 'src/call/alerts.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outdir: 'test-dist',
  loader: { '.css': 'text' },
  logLevel: 'warning',
});
