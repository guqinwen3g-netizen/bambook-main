import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isLiveApiPath, liveApiSurface } from '../liveApiSurface';

const app = express();
app.use('/api', liveApiSurface);
app.use('/api', (_req, res) => { res.json({ ok: true, reached: true }); });

describe('main API live surface', () => {
  it.each([
    '/health', '/auth/login', '/auth/me', '/admin/users', '/admin/order-approval-authorities/fabric',
    '/platform/companies', '/hr/teams/mine', '/hr/employment-events',
    '/v1/procurement/contracts/approval-authority/fabric/finished', '/dev/info',
  ])('passes %s through', async (p) => {
    expect(isLiveApiPath(p)).toBe(true);
    const res = await request(app).get('/api' + p);
    expect(res.body.reached).toBe(true);
  });

  it.each([
    '/uploads/a.pdf', '/uploads/invoices/x.pdf', '/app', '/v1/finance/invoices', '/v2/finance', '/v1/order-lines',
    '/agent/chat', '/ai/chat', '/v1/email', '/email/send', '/v2/customer/auth/login', '/v1/events', '/orders',
    '/v1/procurement', '/v1/procurement/contracts', '/healthz', '/authx', '/v1/config', '/mcp', '/mist/session',
  ])('answers 404 for %s before any later middleware', async (p) => {
    expect(isLiveApiPath(p)).toBe(false);
    const res = await request(app).post('/api' + p).send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('is mounted ahead of the auth guards in index.ts', () => {
    const src = readFileSync(path.resolve(__dirname, '../../index.ts'), 'utf8');
    const gate = src.indexOf("app.use('/api', liveApiSurface)");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(src.indexOf("app.use('/api', createAuthorizationSnapshotGuard("));
    expect(gate).toBeLessThan(src.indexOf("app.use('/api', tenantSurfaceGuard)"));
  });
});
