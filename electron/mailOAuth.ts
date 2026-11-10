import http from 'node:http';
import { randomUUID } from 'node:crypto';

const paths = {
  google: 'https://accounts.google.com/o/oauth2/v2/auth',
  microsoft: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
} as const;

/** One expiring listener on the machine running the original Bambook session. No cookies leave Electron. */
export async function prepareMailReturn(origin: string, provider: keyof typeof paths) {
  if (provider !== 'google' && provider !== 'microsoft') throw new Error('邮箱服务商无效');
  const callback = new URL('/api/mist/email/oauth/callback/' + provider, origin);
  const id = randomUUID();
  let expected = '', finishUrl = '', settled = false;
  let resolve: (() => void) | undefined, reject: ((error: Error) => void) | undefined;
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const local = '127.0.0.1:' + port;
    let url: URL;
    try { url = new URL(req.url || '/', 'http://' + local); } catch { res.writeHead(400).end(); return; }
    if (settled || !expected || req.method !== 'GET' || req.headers.host !== local || url.origin !== 'http://' + local ||
        url.pathname !== '/mail/oauth/' + provider || url.searchParams.get('state') !== expected) {
      res.writeHead(404).end(); return;
    }
    const code = url.searchParams.get('code'), error = url.searchParams.get('error');
    if (!error && (!code || code.length > 8192)) { res.writeHead(400).end(); return; }
    callback.searchParams.set('state', expected);
    callback.searchParams.set('finish', '1');
    if (error) callback.searchParams.set('error', error === 'access_denied' ? error : 'failed');
    else callback.searchParams.set('code', code!);
    finishUrl = callback.toString(); settled = true;
    res.end('请返回 Bambook 查看邮箱连接结果。');
    server.close(); resolve?.();
  });
  let port = 0;
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', fail); ok(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('无法打开桌面授权回程'); }
  port = address.port;
  const cancel = () => {
    clearTimeout(timer); settled = true; finishUrl = ''; server.close(); server.closeAllConnections();
    reject?.(new Error('邮箱连接已结束，请重新连接'));
  };
  const timer = setTimeout(cancel, 600_000); timer.unref();
  server.on('error', cancel);
  return {
    id, port, origin, cancel,
    async open(value: string, openExternal: (url: string) => Promise<unknown>) {
      const url = new URL(value), state = url.searchParams.get('state');
      if (settled || expected || url.username || url.password || url.origin + url.pathname !== paths[provider] ||
          url.searchParams.get('redirect_uri') !== callback.toString() || !state?.startsWith('desktop.' + port + '.'))
        throw new Error('邮箱授权地址无效');
      expected = state;
      await new Promise<void>((ok, fail) => {
        resolve = ok; reject = fail; void openExternal(value).catch(() => { cancel(); });
      });
    },
    finish() {
      if (!finishUrl) throw new Error('邮箱授权尚未返回');
      const url = finishUrl; cancel(); return url;
    },
  };
}
