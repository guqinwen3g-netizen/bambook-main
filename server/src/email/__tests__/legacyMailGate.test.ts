import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { assertLegacyMailHost, legacyMailHostGate } from '../legacyMailGate';

afterEach(() => { vi.unstubAllEnvs(); });

describe('旧邮件接口的主机门禁', () => {
  const resolver = (map: Record<string, string[]>) => async (name: string) => map[name] ?? [];
  it('公网主机放行，内部地址、映射写法与解析失败一律拒绝', async () => {
    vi.stubEnv('MIST_MAIL_ALLOWED_HOSTS', '');
    const resolve = resolver({ 'imap.example.com': ['93.184.216.34'], 'evil.example.com': ['93.184.216.34', '10.0.0.5'], 'meta.example.com': ['169.254.169.254'] });
    await expect(assertLegacyMailHost('imap.example.com', resolve)).resolves.toBeUndefined();
    await expect(assertLegacyMailHost(undefined, resolve)).resolves.toBeUndefined();
    for (const host of ['evil.example.com', 'meta.example.com', 'unknown.example.com', '127.0.0.1', '::ffff:7f00:1', '::1', 'fd00::1'])
      await expect(assertLegacyMailHost(host, resolve)).rejects.toMatchObject({ status: 422 });
    await expect(assertLegacyMailHost({ host: 'x' }, resolve)).rejects.toMatchObject({ status: 422 });
  });
  it('运维白名单主机按名字放行', async () => {
    vi.stubEnv('MIST_MAIL_ALLOWED_HOSTS', 'mail.sylway.cloud');
    await expect(assertLegacyMailHost('Mail.Sylway.Cloud', async () => ['127.0.0.1'])).resolves.toBeUndefined();
  });
  it('中间件在进入路由处理前拒绝指向内部网络的请求', async () => {
    vi.stubEnv('MIST_MAIL_ALLOWED_HOSTS', '');
    const handler = vi.fn((_req, res) => res.json({ ok: true }));
    const app = express(); app.use(express.json()); app.use(legacyMailHostGate(async () => ['192.168.1.10'])); app.post('/fetch', handler);
    const denied = await request(app).post('/fetch').send({ email: 'a@b.c', password: 'x', host: 'intranet.example.com' });
    expect(denied.status).toBe(422); expect(handler).not.toHaveBeenCalled();
    const allowed = await request(app).post('/fetch').send({ email: 'a@b.c', password: 'x' });
    expect(allowed.status).toBe(200);
  });
});
