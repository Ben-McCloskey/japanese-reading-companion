import { resolve } from 'node:path';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Copies kuromoji's compressed dictionary files (~13 MB total) into the
 * Capacitor web bundle so the iOS app can fetch them via XHR at runtime.
 * Without this, kuromoji's BrowserDictionaryLoader has nowhere to load
 * the .dat.gz files from.
 */
function copyKuromojiDict(): Plugin {
  return {
    name: 'copy-kuromoji-dict',
    apply: 'build',
    closeBundle() {
      const src = resolve(__dirname, 'node_modules/kuromoji/dict');
      const dst = resolve(__dirname, 'out/web/kuromoji-dict');
      mkdirSync(dst, { recursive: true });
      for (const file of readdirSync(src)) {
        const srcPath = resolve(src, file);
        if (!statSync(srcPath).isFile()) continue;
        copyFileSync(srcPath, resolve(dst, file));
      }
    },
  };
}

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8'),
) as { version: string };

// Capacitor target build. Outputs a static bundle (HTML + assets) that the
// iOS shell loads from `webDir` via WKWebView.
//
// `@platform` aliases to capacitor.ts here so the renderer doesn't pull in
// Electron-only code. The Electron build keeps the alias pointing at the
// directory (which re-exports from electron.ts).
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react(), copyKuromojiDict()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: resolve(__dirname, 'out/web'),
    emptyOutDir: true,
    rollupOptions: {
      input: { index: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@platform': resolve(__dirname, 'src/platform/capacitor.ts'),
      // Polyfill Node's `path` for kuromoji's DictionaryLoader. Only `join`
      // is used, which our shim provides as URL-style concatenation.
      path: resolve(__dirname, 'src/platform/shims/path.ts'),
    },
  },
});
