/**
 * /api/mist/session 远端探测兼容：旧版前端（缓存页面、桌面端）把任何 200 当本地会话解析，
 * 所以只有声明了新探测协议（X-Mist-Session-Probe: 2）的请求才得到 200 {mode:'remote'}，其余保持 404。
 */
import request from 'supertest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMistServer } from './server';
import { createMistLocalRuntime } from './local';

const db: any = { $queryRawUnsafe: vi.fn(async () => []), userAccount: { findUnique: vi.fn(async () => null) } };
afterEach(() => { vi.unstubAllEnvs(); });

describe('Mist 会话探测', () => {
  it('远端服务：未带探测头保持旧的 404', async () => {
    const res = await request(createMistServer(db)).get('/api/mist/session');
    expect(res.status).toBe(404);
    expect(res.body.mode).toBeUndefined();
  });
  it('远端服务：带 X-Mist-Session-Probe: 2 时明确回答 remote', async () => {
    const res = await request(createMistServer(db)).get('/api/mist/session').set('X-Mist-Session-Probe', '2');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, mode: 'remote' });
    expect(res.headers['cache-control']).toContain('no-store');
  });
  it('远端服务：其他探测版本号仍按旧协议 404', async () => {
    expect((await request(createMistServer(db)).get('/api/mist/session').set('X-Mist-Session-Probe', '1')).status).toBe(404);
  });
  it('本地模式不受探测头影响：两种请求都得到本地会话', async () => {
    vi.stubEnv('MIST_LOCAL_WORKSPACE', '1'); vi.stubEnv('NODE_ENV', 'test');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mist-probe-'));
    try {
      const app = createMistServer(undefined, { local: createMistLocalRuntime({ directory }) });
      for (const probe of [undefined, '2']) {
        const req = request(app).get('/api/mist/session');
        const res = await (probe ? req.set('X-Mist-Session-Probe', probe) : req);
        expect(res.status).toBe(200);
        expect(res.body.mode).not.toBe('remote');
        expect(res.body.user?.id).toBe('local-operator');
      }
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});
