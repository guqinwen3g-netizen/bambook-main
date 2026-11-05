import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHealthHandler } from '../healthRoute';
import { createMistServer } from '../mist/server';

const SECRET = 'connect ECONNREFUSED 10.0.0.12:5432 password authentication failed for user "bambook"';
afterEach(() => vi.restoreAllMocks());

describe('public /api/health does not expose internal error text', () => {
  it('main API: database failure keeps status/database fields and logs the cause server-side only', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = express();
    app.get('/api/health', createHealthHandler({
      prisma: { $queryRaw: vi.fn(async () => { throw new Error(SECRET); }) },
      build: 'abc123', authRequired: true,
      tts: () => ({ provider: 'melo', ok: false, elapsedMs: 12, at: '2026-11-05T00:00:00Z', error: 'spawn /opt/private/melo ENOENT' }),
    }));
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'error', database: 'unavailable', build: 'abc123' });
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(res.body)).not.toContain('/opt/private');
    expect(res.body).not.toHaveProperty('error');
    expect(res.body.tts).toMatchObject({ provider: 'melo', prewarmOk: false });
    expect(res.body.tts).not.toHaveProperty('prewarmError');
    expect(log.mock.calls.flat().join(' ')).toContain('ECONNREFUSED');
  });
  it('main API: healthy database answers ok', async () => {
    const app = express();
    app.get('/api/health', createHealthHandler({ prisma: { $queryRaw: vi.fn(async () => [1]) }, build: 'abc123', authRequired: false, tts: () => null }));
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok', build: 'abc123', authRequired: false });
  });
  it('Mist API: database failure answers only status fields and logs the cause', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db: any = { $queryRawUnsafe: vi.fn(async () => { throw new Error(SECRET); }), userAccount: { findUnique: vi.fn(async () => null) } };
    const res = await request(createMistServer(db)).get('/api/health').set('Host', 'bambook.sylway.cloud');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', service: 'mist-workspace', database: 'unavailable' });
    expect(log.mock.calls.flat().join(' ')).toContain('ECONNREFUSED');
  });
});
