import { defineConfig, mergeConfig } from 'vite';
import referenceConfig from './dev-ui-preview/mist-atelier/app/vite.config';
import { mistDevelopmentProxy } from './scripts/mist-dev-target.mjs';

// Both Mist ports run the same approved frontend source. Business adapters attach here.
export default defineConfig(
  mergeConfig(referenceConfig, {
    define: { 'import.meta.env.VITE_MIST_REFERENCE': JSON.stringify('false') },
    cacheDir: '/tmp/bambook-mist-runtime-cache',
    server: {
      port: 3001,
      host: '127.0.0.1',
      strictPort: true,
      // Production builds must not reload an in-progress local business form.
      watch: { ignored: ['**/dist/**', '**/dist-*/**', '**/out/**', '**/.git/**'] },
      proxy: mistDevelopmentProxy(),
    },
    preview: { port: 4174, host: '127.0.0.1', strictPort: true },
    // 依赖预扫描跳过构建产物（out/ 是旧 Electron 打包结果），避免启动时报不存在的依赖。
    optimizeDeps: { entries: ['**/*.html', '!**/node_modules/**', '!out/**', '!dist/**', '!dist-*/**'] },
  }),
);
