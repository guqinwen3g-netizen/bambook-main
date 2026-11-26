import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { createMistServer } from '../server';
import { createMistLocalRuntime } from '../local';
import type { AgentTaskView } from '../../shared/mistAgentTasks';
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
it('saves spoken tasks in the ticket conversation and refuses other conversations owned by the same user', async () => {
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(upstream, 'listening');
  let provider: WebSocket | undefined;
  upstream.on('connection', peer => {
    provider = peer;
    peer.on('message', raw => {
      const data = JSON.parse(raw.toString());
      if (data.type === 'session.create') peer.send(JSON.stringify({ type: 'session.created' }));
    });
  });
  const local = createMistLocalRuntime({ directory: dir });
  const app = createMistServer(undefined, {
    local,
    voice: {
      config: () => ({ apiKey: 'test-only', voice: 'voice', speed: 0, loudness: 0 }),
      connect: () => new WebSocket('ws://127.0.0.1:' + (upstream.address() as AddressInfo).port),
    },
    agentTasks: {
      configured: () => true,
      complete: async () => JSON.stringify({ name: 'bambook_task', arguments: { action: 'finish', outcome: 'succeeded', result: '模拟订单已核对。' } }),
    },
  });
  const backend = createServer(app);
  const detach = app.locals.voice.attach(backend);
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  app.locals.platformTaskWorker.start(3_600_000);
  let browser: WebSocket | undefined;
  try {
    const { client, base } = await human(app, 'demo-sales');
    const conversationId = 'c_voice_current';
    const other = (await client.post(base + '/personal-agent/tasks').send({
      requestId: randomUUID(), name: '另一段对话', instructions: '核对另一段对话的模拟订单。', conversationId: 'c_voice_other',
    }).expect(201)).body.item;
    const origin = 'http://127.0.0.1';
    await client.post(base + '/voice/sessions').set('Origin', origin).send({ conversationId: '../invalid' }).expect(400);
    await client.post(base + '/voice/sessions').set('Origin', origin).send({ conversationId, taskId: other.id }).expect(403);
    const { id, ticket } = (await client.post(base + '/voice/sessions').set('Origin', origin).send({ conversationId }).expect(201)).body;

    browser = new WebSocket('ws://127.0.0.1:' + (backend.address() as AddressInfo).port + '/api/mist/voice/stream?id=' + id,
      ['bambook-voice-v1', 'bambook-ticket.' + ticket], { origin });
    const messages: Array<{ type: string; code?: string; item?: AgentTaskView }> = [];
    browser.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await once(browser, 'open');
    await vi.waitFor(() => expect(messages.some(message => message.type === 'ready')).toBe(true));
    provider!.send(JSON.stringify({
      type: 'conversation.item.input_audio_transcription.completed', event_id: 'utterance-current', transcript: '核对当前对话的模拟订单。',
    }));
    provider!.send(JSON.stringify({
      type: 'response.function_call_arguments.done', items: [{ call_id: 'delegate-current', name: 'bambook_voice_task', arguments: '{}' }],
    }));
    let spoken: AgentTaskView | undefined;
    await vi.waitFor(() => {
      spoken = messages.find(message => message.type === 'task')?.item;
      expect(spoken).toMatchObject({ conversationId, instructions: '核对当前对话的模拟订单。' });
    });
    const stored = (await client.get(base + '/agent-tasks/' + spoken!.id).expect(200)).body.item;
    expect(stored).toMatchObject({ conversationId, id: spoken!.id });

    browser.send(JSON.stringify({ type: 'bind_task', taskId: other.id }));
    await vi.waitFor(() => expect(messages.some(message => message.code === 'VOICE_TASK_UNAVAILABLE')).toBe(true));
    expect(messages.some(message => message.item?.id === other.id)).toBe(false);
  } finally {
    browser?.terminate();
    detach();
    upstream.clients.forEach(peer => peer.terminate());
    await Promise.all([
      app.locals.platformTaskWorker.stop(),
      new Promise<void>(resolve => backend.close(() => resolve())),
      new Promise<void>(resolve => upstream.close(() => resolve())),
    ]);
  }
});
it('stops authorizing voice when the company administrator disables the personal Agent', async () => {
  const local = createMistLocalRuntime({ directory: dir }), app = createMistServer(undefined, { local });
  const sales = await human(app, 'demo-sales'), admin = await human(app, 'demo-admin');
  const identity = (await sales.client.post(sales.base + '/personal-agent').send({}).expect(200)).body.identity;
  await admin.client.post(admin.base + '/agent-identities/' + identity.id + '/configure').send({ requestId: randomUUID(), version: identity.version, name: identity.name, ownerId: 'demo-sales', mode: 'operate', enabled: false }).expect(200);
  await sales.client.get(sales.base + '/voice/status').expect(403);
});
