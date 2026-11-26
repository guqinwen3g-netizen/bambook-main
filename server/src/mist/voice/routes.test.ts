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
import type { VoiceBinding } from './service';
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

it('resumes only the sole authorized unfinished task in the requested conversation', async () => {
  const app = createMistServer(undefined, {
    local: createMistLocalRuntime({ directory: dir }),
    voice: { config: () => ({ apiKey: 'test-only', voice: 'voice', speed: 0, loudness: 0 }) },
    agentTasks: {
      configured: () => true,
      complete: async input => JSON.stringify({
        name: 'bambook_task',
        arguments: String(input.messages[0].content).includes('结束归档')
          ? { action: 'finish', outcome: 'succeeded', result: '模拟报告已归档。' }
          : { action: 'question', question: '请补充模拟订单编号。' },
      }),
    },
  });
  app.locals.platformTaskWorker.start(3_600_000);
  const issue = vi.spyOn(app.locals.voice, 'issue');
  try {
    const sales = await human(app, 'demo-sales'), buyer = await human(app, 'demo-buyer');
    const create = async (owner: typeof sales, conversationId: string, text: string, state: AgentTaskView['state']) => {
      const { item } = (await owner.client.post(owner.base + '/personal-agent/tasks').send({
        requestId: randomUUID(), name: text, instructions: text, conversationId,
      }).expect(201)).body;
      await app.locals.platformTaskWorker.tick();
      await app.locals.platformTaskWorker.settled();
      return vi.waitFor(async () => {
        const current = (await owner.client.get(owner.base + '/agent-tasks/' + item.id).expect(200)).body.item as AgentTaskView;
        expect(current.state).toBe(state);
        return current;
      }, { timeout: 3000 });
    };
    const bound = async (body: { conversationId?: string; taskId?: string }) => {
      await sales.client.post(sales.base + '/voice/sessions').set('Origin', 'http://127.0.0.1').send(body).expect(201);
      return (issue.mock.calls.at(-1)?.[0] as VoiceBinding).taskId;
    };
    const current = 'c_voice_resume_current';
    await create(sales, current, '结束归档', 'succeeded');
    await create(sales, 'c_voice_resume_other', '另一段对话待补充', 'waiting_human');
    await create(buyer, current, '其他成员待补充', 'waiting_human');
    expect(await bound({ conversationId: current })).toBeUndefined();

    const waiting = await create(sales, current, '当前对话待补充', 'waiting_human');
    expect(await bound({ conversationId: current })).toBe(waiting.id);
    await sales.client.post(sales.base + '/agent-tasks/' + waiting.id + '/pause')
      .send({ requestId: randomUUID(), version: waiting.version }).expect(200);
    expect(await bound({ conversationId: current })).toBe(waiting.id);

    const another = await create(sales, current, '同一对话的第二项待补充', 'waiting_human');
    expect(await bound({ conversationId: current })).toBeUndefined();
    expect(await bound({ conversationId: current, taskId: another.id })).toBe(another.id);
    expect(await bound({})).toBeUndefined();
  } finally {
    issue.mockRestore();
    await app.locals.platformTaskWorker.stop();
    app.locals.voice.stopCalls();
  }
});

it('keeps an explicit spoken answer on its chosen question when text and voice race', async () => {
  const origin = 'http://127.0.0.1';
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(upstream, 'listening');
  let provider: WebSocket | undefined;
  const replies = new Map<string, Record<string, unknown>>();
  upstream.on('connection', peer => {
    provider = peer;
    peer.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'session.create') peer.send(JSON.stringify({ type: 'session.created' }));
      if (message.type === 'conversation.item.create') {
        const item = message.items[0];
        replies.set(item.call_id, JSON.parse(item.content[0].text));
      }
    });
  });
  const app = createMistServer(undefined, {
    local: createMistLocalRuntime({ directory: dir }),
    voice: {
      config: () => ({ apiKey: 'test-only', voice: 'voice', speed: 0, loudness: 0 }),
      connect: () => new WebSocket('ws://127.0.0.1:' + (upstream.address() as AddressInfo).port),
    },
    agentTasks: {
      configured: () => true,
      tickMs: 3_600_000,
      complete: async () => JSON.stringify({
        name: 'bambook_task', arguments: { action: 'question', question: '请补充模拟订单编号。' },
      }),
    },
  });
  const server = createServer(app), detach = app.locals.voice.attach(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const worker = app.locals.platformTaskWorker;
  worker.start(3_600_000);
  let browser: WebSocket | undefined;
  try {
    const { client, base } = await human(app, 'demo-sales');
    const getTask = async (id: string): Promise<AgentTaskView> =>
      (await client.get(base + '/agent-tasks/' + id).expect(200)).body.item;
    const createWaiting = async (conversationId: string) => {
      const { item } = (await client.post(base + '/personal-agent/tasks').send({
        requestId: randomUUID(), name: '待补充资料', instructions: '核对模拟订单。', conversationId,
      }).expect(201)).body;
      await worker.tick();
      await worker.settled();
      const task = await getTask(item.id);
      expect(task.state).toBe('waiting_human');
      return task;
    };
    const ticket = (data: { conversationId: string; taskId?: string; questionId?: string }) =>
      client.post(base + '/voice/sessions').set('Origin', origin).send(data);
    const connect = async (issued: { id: string; ticket: string }) => {
      browser = new WebSocket('ws://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/mist/voice/stream?id=' + issued.id,
        ['bambook-voice-v1', 'bambook-ticket.' + issued.ticket], { origin });
      const messages: Array<{ type: string; item?: AgentTaskView }> = [];
      browser.on('message', raw => messages.push(JSON.parse(raw.toString())));
      await once(browser, 'open');
      await vi.waitFor(() => expect(messages.some(message => message.type === 'ready')).toBe(true));
      return messages;
    };
    const speak = async (id: string, transcript: string) => {
      provider!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.started' }));
      provider!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', event_id: id, transcript }));
      provider!.send(JSON.stringify({
        type: 'response.function_call_arguments.done', items: [{ call_id: id, name: 'bambook_voice_task', arguments: '{}' }],
      }));
      return vi.waitFor(() => {
        expect(replies.has(id)).toBe(true);
        return replies.get(id);
      }, { timeout: 3000 });
    };
    const closeBrowser = async () => {
      const closed = once(browser!, 'close');
      browser!.close();
      await closed;
      browser = undefined;
    };

    const staleConversation = 'c_voice_stale_question';
    const stale = await createWaiting(staleConversation);
    const questionId = stale.questions![0].id;
    await ticket({ conversationId: staleConversation, questionId }).expect(400);
    await ticket({ conversationId: 'c_voice_other', taskId: stale.id, questionId }).expect(403);
    const issued = (await ticket({ conversationId: staleConversation, taskId: stale.id, questionId }).expect(201)).body;
    await client.post(base + '/agent-tasks/' + stale.id + '/answer').send({
      requestId: randomUUID(), version: stale.version, questionId, answer: '文字答案：订单 A。',
    }).expect(200);
    await connect(issued);
    expect(await speak('stale-spoken', '语音答案：订单 B。')).toEqual({ error: true, message: '问题已更新，请在原事项核对' });
    expect((await getTask(stale.id)).questions?.[0].answer).toBe('文字答案：订单 A。');
    const current = (await client.get(base + '/agent-tasks').expect(200)).body.items as AgentTaskView[];
    expect(current.filter(task => task.conversationId === staleConversation).map(task => task.id)).toEqual([stale.id]);
    await closeBrowser();
    const rejected = await ticket({ conversationId: staleConversation, taskId: stale.id, questionId }).expect(409);
    expect(rejected.body.error.code).toBe('AGENT_TASK_CHANGED');

    const happyConversation = 'c_voice_happy_question';
    const happy = await createWaiting(happyConversation);
    const newTicket = (await ticket({ conversationId: happyConversation, taskId: happy.id, questionId: happy.questions![0].id }).expect(201)).body;
    const messages = await connect(newTicket);
    expect(await speak('correct-spoken', '模拟订单 C。')).toMatchObject({ state: 'queued' });
    expect((await getTask(happy.id)).questions?.[0].answer).toBe('模拟订单 C。');
    expect(messages.find(message => message.type === 'task')?.item?.id).toBe(happy.id);
    expect(await speak('next-task', '再核对模拟订单 D。')).toMatchObject({ state: 'queued' });
    expect(messages.find(message => message.type === 'task' && message.item?.id !== happy.id)?.item).toMatchObject({
      conversationId: happyConversation, instructions: '再核对模拟订单 D。',
    });
  } finally {
    browser?.terminate();
    detach();
    upstream.clients.forEach(peer => peer.terminate());
    await Promise.all([
      worker.stop(),
      new Promise<void>(resolve => server.close(() => resolve())),
      new Promise<void>(resolve => upstream.close(() => resolve())),
    ]);
  }
});
