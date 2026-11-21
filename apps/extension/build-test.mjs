// Bundles the Chrome-free capture modules as ESM so `node --test` can import them.
import { build } from 'esbuild';

await build({
  entryPoints: {
    'caption-consolidator': 'src/meet/caption-consolidator.ts',
    'capture-session': 'src/meet/capture-session.ts',
    'capture-controller': 'src/meet/capture-controller.ts',
    'meet-captions-dom': 'src/meet/meet-captions-dom.ts',
    'inline-feed': 'src/inline-feed.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outdir: 'test-dist',
  loader: { '.css': 'text' },
  logLevel: 'warning',
});
