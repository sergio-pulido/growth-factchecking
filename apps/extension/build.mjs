import { copyFile } from 'node:fs/promises';
import { build } from 'esbuild';

await build({
  entryPoints: ['src/background.ts', 'src/overlay.ts', 'src/x-content.ts', 'src/x-demo.ts', 'src/news-content.ts'],
  bundle: true,
  format: 'iife',
  outdir: 'dist',
  minify: true,
  target: 'chrome120',
  loader: { '.css': 'text' },
});
await copyFile('manifest.json', 'dist/manifest.json');
