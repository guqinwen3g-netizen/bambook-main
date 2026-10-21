import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodexSubscriptionService } from '../ai/codexSubscription';
import { createPlatformProviderStore, SUBSCRIPTION_SLOT } from '../ai/platformProviders';
import { createMistRouter } from './route';

let dir: string;
let audit: ReturnType<typeof vi.fn>;
const KEY = 'sk-live-secret-9F3A';
const body = { name: 'OpenAI', baseUrl: 'https://api.openai.example.test/v1', model: 'gpt-test', apiKey: KEY };

function app() {
  audit = vi.fn(async () => ({}));
  const prisma = {
    userAccount: { findUnique: async ({ where }: any) => ({ platformRole: where.id === 'platform' ? 'platform_admin' : null, status: 'active', deletedAt: null }) },
    auditLog: { create: audit },
  };
  const a = express();
  a.use(express.json());
  a.use('/api/mist', createMistRouter({
    prisma, repository: {} as any,
    subscriptions: new CodexSubscriptionService({ dir, enabled: false }),
    platformProviders: createPlatformProviderStore({ dir }),
    authenticate: (req, _res, next) => { (req as any).actor = { userId: String(req.headers['x-test-user'] || ''), roles: ['owner'], permissions: ['*'] }; next(); },
  }));
  return a;
}

beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'bambook-provider-route-')); });
afterEach(async () => { vi.unstubAllGlobals(); await rm(dir, { recursive: true, force: true }); });

describe('platform API provider routes', () => {
  it('rejects company accounts, even a company owner', async () => {
    const server = app();
    expect((await request(server).post('/api/mist/ai/platform-model/providers').set('x-test-user', 'owner').send(body)).status).toBe(403);
    expect((await request(server).get('/api/mist/ai/platform-model').set('x-test-user', 'owner')).status).toBe(403);
    expect(audit).not.toHaveBeenCalled();
  });

  it('lets a platform admin manage providers without ever returning the key', async () => {
    const server = app();
    const created = await request(server).post('/api/mist/ai/platform-model/providers').set('x-test-user', 'platform').send(body);
    expect(created.status).toBe(201);
    expect(created.body.provider).toMatchObject({ name: 'OpenAI', model: 'gpt-test', keyHint: '••••9F3A', enabled: true });
    const id = created.body.provider.id;
    const listed = await request(server).get('/api/mist/ai/platform-model').set('x-test-user', 'platform');
    expect(listed.body.api.order).toEqual([SUBSCRIPTION_SLOT, id]);
    expect(listed.headers['cache-control']).toContain('no-store');
    const updated = await request(server).patch(`/api/mist/ai/platform-model/providers/${id}`).set('x-test-user', 'platform').send({ enabled: false, apiKey: '' });
    expect(updated.body.provider.enabled).toBe(false);
    const ordered = await request(server).put('/api/mist/ai/platform-model/order').set('x-test-user', 'platform').send({ order: [id, SUBSCRIPTION_SLOT] });
    expect(ordered.body.api.order).toEqual([id, SUBSCRIPTION_SLOT]);
    const removed = await request(server).delete(`/api/mist/ai/platform-model/providers/${id}`).set('x-test-user', 'platform');
    expect(removed.body.api.providers).toEqual([]);
    for (const res of [created, listed, updated, ordered, removed]) expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(audit.mock.calls.map(([arg]: any) => arg.data.action)).toEqual(['platform.ai.provider.create', 'platform.ai.provider.update', 'platform.ai.provider.order', 'platform.ai.provider.delete']);
    expect(JSON.stringify(audit.mock.calls)).not.toContain(KEY);
    expect(audit.mock.calls[1][0].data.detail).toMatchObject({ keyChanged: false, after: { enabled: false, host: 'api.openai.example.test' } });
  });

  it('reports a failed connection test without echoing the key', async () => {
    const server = app();
    const { body: { provider } } = await request(server).post('/api/mist/ai/platform-model/providers').set('x-test-user', 'platform').send(body);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}` } }), { status: 401 })));
    const res = await request(server).post(`/api/mist/ai/platform-model/providers/${provider.id}/test`).set('x-test-user', 'platform').send({});
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('Incorrect API key');
    expect(res.body.error).not.toContain(KEY);
  });

  it('explains an unreachable address in plain language',async () => {
    const server = app();
    const { body: { provider } } = await request(server).post('/api/mist/ai/platform-model/providers').set('x-test-user', 'platform').send(body);
    vi.stubGlobal('fetch', vi.fn(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }));
    const res = await request(server).post(`/api/mist/ai/platform-model/providers/${provider.id}/test`).set('x-test-user', 'platform').send({});
    expect(res.body).toEqual({ ok: false, error: '无法连接到接口地址（ENOTFOUND），请检查地址是否正确，以及服务器能否访问该地址' });
  });

  it('reports a successful connection test with its latency', async () => {
    const server = app();
    const { body: { provider } } = await request(server).post('/api/mist/ai/platform-model/providers').set('x-test-user', 'platform').send(body);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 })));
    const res = await request(server).post(`/api/mist/ai/platform-model/providers/${provider.id}/test`).set('x-test-user', 'platform').send({});
    expect(res.body).toMatchObject({ ok: true });
    expect(typeof res.body.latencyMs).toBe('number');
  });

  it('returns validation errors as client errors', async () => {
    const res = await request(app()).post('/api/mist/ai/platform-model/providers').set('x-test-user', 'platform').send({ ...body, baseUrl: 'http://api.example.test' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('https');
  });
});
