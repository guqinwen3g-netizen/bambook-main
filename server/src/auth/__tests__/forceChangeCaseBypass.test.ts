/**
 * 强制改密守卫不可被路径变体绕过：Express 路由与 app.use('/api') 默认大小写不敏感，
 * 守卫若按原始大小写匹配，/API/orders 会越过拦截直达业务路由。
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { createAccountStatusGuard, invalidateAccountStatusCache } from '../accountStatusGuard';

const SECRET = process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars';

function makeApp() {
  invalidateAccountStatusCache('u-case');
  const prisma: any = { userAccount: { findUnique: async () => ({ status: 'active', deletedAt: null, metadata: { forceChangePassword: true, forceChangeReason: 'initial' } }) } };
  const app = express();
  app.use(createAccountStatusGuard(prisma));
  app.use((req, _res, next) => { if (req.url.startsWith('/bambook/api/')) req.url = req.url.slice('/bambook'.length); next(); });
  app.all('/api/orders', (_req, res) => res.json({ leaked: true }));
  app.all('/api/x', (_req, res) => res.json({ leaked: true }));
  app.get('/api/auth/me', (_req, res) => res.json({ me: true }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/index.html', (_req, res) => res.send('spa'));
  return app;
}
const h = { Authorization: `Bearer ${jwt.sign({ userId: 'u-case', roles: [] }, SECRET)}` };

describe('accountStatusGuard · 强制改密路径变体', () => {
  it.each(['/api/orders', '/API/orders', '/Api/orders', '/api/ORDERS', '/bambook/API/x', '/BAMBOOK/api/x', '/api/orders?x=1', '/api//orders', '/api/orders/'])(
    '拦截业务接口 %s', async (path) => {
      const res = await request(makeApp()).get(path).set(h);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('PASSWORD_CHANGE_REQUIRED');
    });

  it.each(['/api/auth/me', '/API/AUTH/me', '/api/health', '/API/Health', '/index.html'])('放行 %s', async (path) => {
    expect((await request(makeApp()).get(path).set(h)).status).toBe(200);
  });

  it('不把 /api/authx 之类当作 auth 放行', async () => {
    expect((await request(makeApp()).get('/api/authx').set(h)).status).toBe(403);
  });
});
