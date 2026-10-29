import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { mistVersionPlugin } from '../../../scripts/mist-version';
import { mobileIconsPlugin } from '../../../scripts/mobile-icons';

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appRoot, '../../..');
// Managed worktrees share installed dependencies via a symlink. Allow only the
// real dependency directory as well as this checkout, not the whole parent repo.
const dependencyRoot = realpathSync(path.join(repoRoot, 'node_modules'));
/**
 * Mist Atelier 参考应用（独立构建，不影响主应用）。
 *   开发：npx vite --config dev-ui-preview/mist-atelier/app/vite.config.ts   → http://localhost:3130
 *   构建：npx vite build --config dev-ui-preview/mist-atelier/app/vite.config.ts
 */
export default defineConfig({
  define: { 'import.meta.env.VITE_MIST_REFERENCE': JSON.stringify('true') },
  root: appRoot,
  publicDir: path.join(repoRoot, 'public'),
  plugins: [react(), mistVersionPlugin(repoRoot), mobileIconsPlugin(repoRoot)],
  resolve: { alias: { '@': repoRoot } },
  cacheDir: '/tmp/bambook-mist-vite-cache',
  server: {
    port: 3130, host: true, fs: { allow: [repoRoot, dependencyRoot] },
    proxy: {
      '/api/mist': { target: 'http://127.0.0.1:8082', changeOrigin: true },
      '/api': { target: 'http://127.0.0.1:8082', changeOrigin: true },
    },
    // Native file events are unavailable to this desktop execution environment.
    watch: { usePolling: true, interval: 250 },
  },
  build: { outDir: '/tmp/bambook-mist-build', emptyOutDir: true, assetsInlineLimit: 100000000, cssCodeSplit: false },
});
