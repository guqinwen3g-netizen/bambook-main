import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMistServer } from '../server';
import { createMistLocalRuntime } from '../local';
let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'bambook-voice-routes-')); vi.stubEnv('MIST_LOCAL_WORKSPACE', '1'); vi.stubEnv('NODE_ENV', 'test'); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
async function human(app: any, profileId: string) {
  const client = request.agent(app); await client.get('/api/mist/session').expect(200); await client.post('/api/mist/session').send({ profileId }).expect(200);
  const workspace = (await client.get('/api/mist/workspaces/default').expect(200)).body.workspace;
  return { client, base: '/api/mist/workspaces/' + workspace.id };
}
it('lets only the platform/local owner configure speech and never exposes the key to staff', async () => {
  const local = createMistLocalRuntime({ directory: dir }), app = createMistServer(undefined, { local });
  const owner = await human(app, 'local-operator'), sales = await human(app, 'demo-sales');
  const key = 'test-only-voice-connection';
  await sales.client.get('/api/mist/ai/platform-model/voice').expect(403);
  const saved = await owner.client.put('/api/mist/ai/platform-model/voice').send({ revision: 0, enabled: true, apiKey: key, voice: 'zh_female_qingchezizi_uranus_bigtts', speed: 0, loudness: 0 }).expect(200);
  expect(JSON.stringify(saved.body)).not.toContain(key);
  const status = await sales.client.get(sales.base + '/voice/status').expect(200);
  expect(status.body).toMatchObject({ configured: true, provider: 'doubao' }); expect(JSON.stringify(status.body)).not.toContain(key);
  await sales.client.put('/api/mist/ai/platform-model/voice').send({ revision: 1, enabled: false }).expect(403);
});
it('rejects cross-origin tickets and binding another employee’s task', async () => {
  const local = createMistLocalRuntime({ directory: dir }), app = createMistServer(undefined, { local, voice: { config: () => ({ apiKey: 'test-only', voice: 'voice', speed: 0, loudness: 0 }) }, agentTasks: { configured: () => true, complete: async () => '' } });
  app.locals.platformTaskWorker.start(3_600_000);
  try {
    const sales = await human(app, 'demo-sales'), buyer = await human(app, 'demo-buyer');
    await sales.client.post(sales.base + '/voice/sessions').set('Origin', 'https://attacker.invalid').send({}).expect(403);
    const own = (await sales.client.post(sales.base + '/personal-agent/tasks').send({ requestId: randomUUID(), name: '核对订单', instructions: '核对本人的订单' }).expect(201)).body.item;
    await buyer.client.post(buyer.base + '/voice/sessions').set('Origin', 'http://127.0.0.1').send({ taskId: own.id }).expect(404);
    const issued = await sales.client.post(sales.base + '/voice/sessions').set('Origin', 'http://127.0.0.1').send({ taskId: own.id, locale: 'zh-CN' }).expect(201);
    expect(issued.body).toMatchObject({ expiresIn: 30 }); expect(issued.body.ticket).toHaveLength(43);
    expect(JSON.stringify(issued.body)).not.toContain('test-only');
  } finally { await app.locals.platformTaskWorker.stop(); app.locals.voice.stopCalls(); }
});
it('stops authorizing voice when the company administrator disables the personal Agent', async () => {
  const local = createMistLocalRuntime({ directory: dir }), app = createMistServer(undefined, { local });
  const sales = await human(app, 'demo-sales'), admin = await human(app, 'demo-admin');
  const identity = (await sales.client.post(sales.base + '/personal-agent').send({}).expect(200)).body.identity;
  await admin.client.post(admin.base + '/agent-identities/' + identity.id + '/configure').send({ requestId: randomUUID(), version: identity.version, name: identity.name, ownerId: 'demo-sales', mode: 'operate', enabled: false }).expect(200);
  await sales.client.get(sales.base + '/voice/status').expect(403);
});
