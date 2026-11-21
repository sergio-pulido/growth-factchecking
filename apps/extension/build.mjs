import { copyFile, rm } from 'node:fs/promises';
import { build } from 'esbuild';

// Start clean so files of removed entry points do not linger in the unpacked extension.
await rm('dist', { recursive: true, force: true });
await build({
  entryPoints: [
    'src/background.ts', 'src/call-content.ts', 'src/offscreen.ts', 'src/x-content.ts', 'src/x-demo.ts',
  ],
  bundle: true,
  format: 'iife',
  outdir: 'dist',
  minify: true,
  target: 'chrome120',
  loader: { '.css': 'text' },
});
await copyFile('manifest.json', 'dist/manifest.json');
await copyFile('src/offscreen.html', 'dist/offscreen.html');
