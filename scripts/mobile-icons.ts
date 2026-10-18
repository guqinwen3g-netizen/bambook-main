import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * 手机桌面图标（iPhone apple-touch-icon 180、Android 192/512、maskable 512）。
 * iOS 不支持 SVG 桌面图标，必须是 PNG；PNG 以 base64 存在 scripts/mobile-icons.json，
 * 构建时输出到 brand/ 下，开发服务器按同一路径直接返回。
 */
export function readMobileIcons(repoRoot: string): Record<string, Buffer> {
  const raw = JSON.parse(readFileSync(path.join(repoRoot, 'scripts/mobile-icons.json'), 'utf8')) as Record<string, string>;
  return Object.fromEntries(Object.entries(raw).map(([name, b64]) => [name, Buffer.from(b64, 'base64')]));
}

export function mobileIconsPlugin(repoRoot: string): Plugin {
  const icons = readMobileIcons(repoRoot);
  return {
    name: 'mist-mobile-icons',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url || '/', 'http://mist.local').pathname;
        const name = pathname.startsWith('/brand/') ? pathname.slice('/brand/'.length) : '';
        const png = icons[name];
        if (!png || (req.method !== 'GET' && req.method !== 'HEAD')) { next(); return; }
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.end(req.method === 'HEAD' ? undefined : png);
      });
    },
    generateBundle() {
      for (const [name, png] of Object.entries(icons)) this.emitFile({ type: 'asset', fileName: `brand/${name}`, source: png });
    },
  };
}
