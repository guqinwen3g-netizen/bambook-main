import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiFetch, aiProxyUrl, needsAiProxy } from '../ai/outboundProxy';

let upstream: http.Server, proxy: http.Server, seen: string[];
const port = (s: http.Server) => (s.address() as AddressInfo).port;
const listen = (s: http.Server) => new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve));
const close = (s: http.Server) => new Promise<void>(resolve => { s.closeAllConnections?.(); s.close(() => resolve()); });

beforeEach(async () => {
  seen = [];
  upstream = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ via: 'proxy', path: req.url })); });
  proxy = http.createServer((req, res) => { seen.push(String(req.url)); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ via: 'proxy', path: req.url })); });
  // HTTPS-style tunnels arrive as CONNECT; forward every tunnel to the local fake upstream instead of the real host.
  proxy.on('connect', (req, socket) => {
    seen.push(String(req.url));
    const target = net.connect(port(upstream), '127.0.0.1', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); target.pipe(socket); socket.pipe(target); });
    target.on('error', () => socket.destroy());
  });
  await listen(upstream); await listen(proxy);
});
afterEach(async () => {
  delete process.env.BAMBOOK_AI_HTTPS_PROXY;
  vi.unstubAllGlobals();
  await close(proxy); await close(upstream);
});

describe('platform AI outbound proxy', () => {
  it('only matches OpenAI and ChatGPT hosts', () => {
    expect(needsAiProxy('https://chatgpt.com/backend-api/codex/responses')).toBe(true);
    expect(needsAiProxy('https://auth.openai.com/oauth/token')).toBe(true);
    expect(needsAiProxy('https://api.openai.com/v1/chat/completions')).toBe(true);
    expect(needsAiProxy('https://ark.cn-beijing.volces.com/api/v3/chat/completions')).toBe(false);
    expect(needsAiProxy('https://notopenai.com/x')).toBe(false);
    expect(needsAiProxy('not a url')).toBe(false);
  });

  it('uses the normal fetch when no proxy is configured', async () => {
    const direct = vi.fn(async () => new Response('{"via":"direct"}'));
    vi.stubGlobal('fetch', direct);
    expect(aiProxyUrl()).toBeNull();
    expect(await (await aiFetch('https://chatgpt.com/x')).json()).toEqual({ via: 'direct' });
    expect(direct).toHaveBeenCalledTimes(1);
  });

  it('sends OpenAI requests through the configured proxy and leaves other hosts direct', async () => {
    process.env.BAMBOOK_AI_HTTPS_PROXY = `http://127.0.0.1:${port(proxy)}`;
    const res = await aiFetch('http://api.openai.com/v1/models');
    expect(await res.json()).toMatchObject({ via: 'proxy' });
    expect(seen.some(u => u.includes('api.openai.com'))).toBe(true);
    const direct = vi.fn(async () => new Response('{"via":"direct"}'));
    vi.stubGlobal('fetch', direct);
    expect(await (await aiFetch('https://api.deepseek.com/v1/models')).json()).toEqual({ via: 'direct' });
    expect(seen.some(u => u.includes('deepseek'))).toBe(false);
  });

  it('rejects an unsupported proxy scheme with a clear message', async () => {
    process.env.BAMBOOK_AI_HTTPS_PROXY = 'socks5://127.0.0.1:7890';
    expect(() => aiFetch('https://chatgpt.com/x')).toThrow('只支持 http:// 或 https:// 代理');
  });
});
