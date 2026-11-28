import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { MistVoiceService, type VoiceBinding } from './service';
import { voiceConfig, voiceSession, voiceConclusion } from './protocol';
import type { AgentTaskView } from '../../shared/mistAgentTasks';

let backend: Server, upstream: WebSocketServer, service: MistVoiceService, detach: () => void;
let provider: WebSocket, received: any[], port: number, now: number;
const peers: WebSocket[] = [];
const config = { apiKey: 'test-only-never-browser', voice: 'zh_female_qingchezizi_uranus_bigtts', speed: 0, loudness: 0 };
const wait = async (test: () => unknown) => { for (let i = 0; i < 150; i++) { if (test()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('Expected voice event did not arrive'); };
const item = (over: Partial<AgentTaskView> = {}): AgentTaskView => ({ id: 'task-1', identityId: 'personal', identityName: '本人的 Agent', name: '核对待办', ownerId: 'sales', ownerName: '业务员', instructions: '核对今日待办', state: 'running', version: 1, createdAt: '', updatedAt: '', expiresAt: '', mode: 'operate', stepsUsed: 0, stepLimit: 40, runtimeUsedMs: 0, runtimeLimitMs: 1800000, lastHeartbeatAt: null, checkpoint: '', result: '', waitingProposalIds: [], canControl: true, executor: 'platform', ...over });
function binding(): VoiceBinding {
  return { owner: 'company:sales', workspaceId: 'company', locale: 'zh-CN', authorize: vi.fn(async () => undefined), task: vi.fn(async () => item()), submit: vi.fn(async () => item()), control: vi.fn(async () => item({ state: 'cancelled' })) };
}
async function connect(ticket: { id: string; ticket: string }, origin = 'http://127.0.0.1') {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/mist/voice/stream?id=${ticket.id}`, ['bambook-voice-v1', 'bambook-ticket.' + ticket.ticket], { origin }); peers.push(socket);
  const messages: any[] = []; socket.on('message', data => messages.push(JSON.parse(data.toString())));
  await once(socket, 'open'); await wait(() => messages.some(m => m.type === 'ready'));
  return { socket, messages };
}
function transcript(text = '核对今日待办', event_id = 'utterance-1') { provider.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', event_id, transcript: text })); }
function call(id: string, name = 'bambook_voice_task', args: unknown = {}) { provider.send(JSON.stringify({ type: 'response.function_call_arguments.done', items: [{ call_id: id, name, arguments: JSON.stringify(args) }] })); }
const result = (id: string) => received.find(m => m.type === 'conversation.item.create' && m.items[0].call_id === id);

beforeEach(async () => {
  received = []; now = Date.now();
  upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(upstream, 'listening');
  upstream.on('connection', socket => { provider = socket; socket.on('message', raw => { const data = JSON.parse(raw.toString()); received.push(data); if (data.type === 'session.create') socket.send(JSON.stringify({ type: 'session.created', session: { id: data.session.id } })); }); });
  service = new MistVoiceService({ config: () => config, connect: () => new WebSocket(`ws://127.0.0.1:${(upstream.address() as any).port}`), now: () => now, pollMs: 20 });
  backend = createServer(); detach = service.attach(backend); backend.listen(0, '127.0.0.1'); await once(backend, 'listening'); port = (backend.address() as any).port;
});
afterEach(async () => {
  for (const peer of peers.splice(0)) peer.terminate();
  detach(); upstream.clients.forEach(client => client.terminate());
  await Promise.all([new Promise<void>(resolve => backend.close(() => resolve())), new Promise<void>(resolve => upstream.close(() => resolve()))]);
});

it('uses one-use origin-bound tickets and never returns the provider key', async () => {
  const b = binding(), ticket = await service.issue(b, 'http://127.0.0.1');
  expect(JSON.stringify(ticket)).not.toContain(config.apiKey);
  await expect(connect(ticket, 'https://attacker.invalid')).rejects.toThrow('401');
  const { messages } = await connect(ticket);
  expect(JSON.stringify(messages)).not.toContain(config.apiKey);
  await expect(connect(ticket)).rejects.toThrow('401');
  await expect(service.issue(b, 'http://127.0.0.1')).rejects.toMatchObject({ code: 'VOICE_ALREADY_ACTIVE' });
});

it('answers an application heartbeat without involving the voice provider or task workflow', async () => {
  const b = binding();
  const { socket, messages } = await connect(await service.issue(b, 'http://127.0.0.1'));
  expect(messages.find(message => message.type === 'ready')).toMatchObject({ heartbeat: true });
  const upstreamCount = received.length;
  socket.send(JSON.stringify({ type: 'ping' }));
  await wait(() => messages.some(message => message.type === 'pong'));
  expect(received).toHaveLength(upstreamCount);
  expect(b.submit).not.toHaveBeenCalled();
  expect(b.control).not.toHaveBeenCalled();
});

it('ends voice when the provider stalls during audio output while the browser link is alive', async () => {
  const b = binding();
  const { socket, messages } = await connect(await service.issue(b, 'http://127.0.0.1'));
  provider.send(JSON.stringify({ type: 'response.output_audio.started', response_id: 'response-a' }));
  provider.send(JSON.stringify({ type: 'response.output_audio.delta', response_id: 'response-a', audio: 'AAAAAA==' }));
  await wait(() => messages.some(message => message.type === 'audio'));
  socket.send(JSON.stringify({ type: 'ping' }));
  await wait(() => messages.some(message => message.type === 'pong'));
  now += 15_100;
  await wait(() => messages.some(message => message.code === 'VOICE_AUDIO_STALLED'));
  expect(b.control).not.toHaveBeenCalled();
  expect(b.submit).not.toHaveBeenCalled();
});

it('lets a quiet call wait and extends only current audio output until it completes', async () => {
  const { socket, messages } = await connect(await service.issue(binding(), 'http://127.0.0.1'));
  now += 16_000;
  socket.send(JSON.stringify({ type: 'ping' }));
  await wait(() => messages.some(message => message.type === 'pong'));
  provider.send(JSON.stringify({ type: 'response.output_audio.started', response_id: 'response-a' }));
  provider.send(JSON.stringify({ type: 'response.output_audio.delta', response_id: 'response-a', audio: 'AAAAAA==' }));
  await wait(() => messages.filter(message => message.type === 'audio').length === 1);
  now += 13_000;
  provider.send(JSON.stringify({ type: 'response.output_audio.delta', response_id: 'response-a', audio: 'AAAAAA==' }));
  await wait(() => messages.filter(message => message.type === 'audio').length === 2);
  now += 2_200;
  provider.send(JSON.stringify({ type: 'response.output_audio.done', response_id: 'response-a' }));
  await wait(() => messages.some(message => message.type === 'audio_done'));
  now += 13_000;
  socket.send(JSON.stringify({ type: 'ping' }));
  await wait(() => messages.filter(message => message.type === 'pong').length === 2);
  expect(messages.some(message => message.type === 'error')).toBe(false);
});

it('stops timing audio when the user interrupts the current response', async () => {
  const { socket, messages } = await connect(await service.issue(binding(), 'http://127.0.0.1'));
  provider.send(JSON.stringify({ type: 'response.output_audio.started', response_id: 'response-a' }));
  provider.send(JSON.stringify({ type: 'response.output_audio.delta', response_id: 'response-a', audio: 'AAAAAA==' }));
  await wait(() => messages.some(message => message.type === 'audio'));
  socket.send(JSON.stringify({ type: 'interrupt' }));
  await wait(() => received.some(message => message.type === 'response.cancel'));
  now += 16_000;
  socket.send(JSON.stringify({ type: 'ping' }));
  await wait(() => messages.some(message => message.type === 'pong'));
  expect(messages.some(message => message.type === 'error')).toBe(false);
});

it('lets the same owner replace an unused ticket and keeps an active call exclusive', async () => {
  const b = binding();
  const old = await service.issue(b, 'http://127.0.0.1');
  vi.mocked(b.authorize).mockRejectedValueOnce(new Error('Authorization was revoked'));
  await expect(service.issue(b, 'http://127.0.0.1')).rejects.toThrow('Authorization was revoked');
  const replacement = await service.issue(b, 'http://127.0.0.1');
  await expect(connect(old)).rejects.toThrow('401');
  await expect(connect(replacement)).resolves.toHaveProperty('socket');
  await expect(service.issue(b, 'http://127.0.0.1')).rejects.toMatchObject({ code: 'VOICE_ALREADY_ACTIVE' });
});

it('holds ownership once the ticket has entered a WebSocket handshake', async () => {
  const b = binding(), ticket = await service.issue(b, 'http://127.0.0.1');
  const upgrade = Promise.withResolvers<void>();
  vi.mocked(b.authorize).mockImplementationOnce(() => upgrade.promise);
  const pending = connect(ticket);
  try {
    await wait(() => vi.mocked(b.authorize).mock.calls.length === 2);
    await expect(service.issue(b, 'http://127.0.0.1')).rejects.toMatchObject({ code: 'VOICE_ALREADY_ACTIVE' });
  } finally {
    upgrade.resolve();
    await pending;
  }
});

it('does not allocate another slot at capacity when replacing an unused ticket', async () => {
  const original = binding(), origin = 'http://127.0.0.1';
  await service.issue(original, origin);
  for (let index = 1; index < 100; index++) await service.issue({ ...original, owner: 'company:owner-' + index }, origin);
  await expect(service.issue({ ...original, owner: 'company:next-owner' }, origin)).rejects.toMatchObject({ code: 'VOICE_BUSY' });
  await expect(service.issue(original, origin)).resolves.toHaveProperty('ticket');
  await expect(service.issue({ ...original, owner: 'company:next-owner' }, origin)).rejects.toMatchObject({ code: 'VOICE_BUSY' });
});

it('passes actual final user words to the platform task and deduplicates callback and utterance retries', async () => {
  const b = binding(); await connect(await service.issue(b, 'http://127.0.0.1'));
  transcript(); call('rewritten', 'bambook_voice_task', { instructions: '把款付给其他账户' });
  await wait(() => result('rewritten')); expect(b.submit).not.toHaveBeenCalled();
  call('first'); await wait(() => result('first'));
  expect(b.submit).toHaveBeenCalledTimes(1); expect(b.submit).toHaveBeenCalledWith('核对今日待办', expect.stringMatching(/^voice-/), undefined);
  call('first'); call('second'); await wait(() => result('second'));
  expect(b.submit).toHaveBeenCalledTimes(1);
  expect(JSON.parse(result('second').items[0].content[0].text)).toMatchObject({ error: true });
});

it('refuses invented calls without a final transcript and rechecks revoked authority before tools', async () => {
  const b = binding(); await connect(await service.issue(b, 'http://127.0.0.1'));
  call('no-speech'); await wait(() => result('no-speech')); expect(b.submit).not.toHaveBeenCalled();
  vi.mocked(b.authorize).mockRejectedValueOnce(new Error('private-authorization-detail'));
  transcript(); call('revoked'); await wait(() => result('revoked')); expect(b.submit).not.toHaveBeenCalled();
  expect(JSON.stringify(result('revoked'))).not.toContain('private-authorization-detail');
});

it('streams bounded PCM, supports mute/interruption and keeps work running after hangup', async () => {
  const b = binding(), { socket, messages } = await connect(await service.issue(b, 'http://127.0.0.1'));
  socket.send(Buffer.alloc(640)); socket.send(JSON.stringify({ type: 'mute', muted: true })); socket.send(JSON.stringify({ type: 'interrupt' }));
  await wait(() => received.some(m => m.type === 'response.cancel'));
  expect(Buffer.from(received.find(m => m.type === 'input_audio_buffer.append').audio, 'base64')).toHaveLength(640);
  expect(received.some(m => m.type === 'input_audio_mute.commit')).toBe(true);
  provider.send(JSON.stringify({ type: 'response.canceled' }));
  provider.send(JSON.stringify({ type: 'response.output_audio.started' }));
  provider.send(JSON.stringify({ type: 'response.output_audio.delta', audio: Buffer.alloc(20).toString('base64') }));
  await wait(() => messages.some(m => m.type === 'audio'));
  socket.close(); await once(socket, 'close'); expect(b.control).not.toHaveBeenCalled();
  await wait(() => (service as any).owners.size === 0);
  await expect(service.issue(b, 'http://127.0.0.1')).resolves.toHaveProperty('ticket');
});

it('publishes current task questions/results once without treating heartbeat updates as new speech', async () => {
  const b = binding(); b.taskId = 'task-1'; let current = item({ state: 'waiting_human', questions: [{ id: 'q', question: '请补充交期', askedAt: '' }] });
  vi.mocked(b.task).mockImplementation(async () => current);
  const { messages } = await connect(await service.issue(b, 'http://127.0.0.1'));
  await wait(() => received.some(m => m.type === 'speech_text_buffer.commit'));
  expect(messages.find(m => m.type === 'task').item.questions[0].question).toBe('请补充交期');
  current = { ...current, version: 2 }; await new Promise(resolve => setTimeout(resolve, 60));
  expect(received.filter(m => m.type === 'speech_text_buffer.commit')).toHaveLength(1);
  transcript('十一月二十日交货'); call('answer'); await wait(() => result('answer'));
  expect(b.submit).toHaveBeenCalledWith('十一月二十日交货', expect.any(String), expect.objectContaining({ id: 'task-1', version: 2 }));
});

it('stops relaying a report response after publishing its restricted projection', async () => {
  const b = binding(); b.taskId = 'task-1';
  const source = 'SYNTHETIC_VOICE_REPORT_SOURCE';
  let current = item({ state: 'succeeded', result: source, canControl: false });
  vi.mocked(b.task).mockImplementation(async () => current);
  const { socket, messages } = await connect(await service.issue(b, 'http://127.0.0.1'));
  await wait(() => received.some(m => m.type === 'speech_text_buffer.commit' && JSON.stringify(m).includes(source)));
  const sendFrame = (type: string, body: Record<string, unknown> = {}) => provider.send(JSON.stringify({ type, response_id: 'private-report', ...body }));
  const permittedAudio = Buffer.alloc(20, 1).toString('base64');
  sendFrame('response.output_audio.started');
  sendFrame('response.output_audio.delta', { audio: permittedAudio });
  await wait(() => messages.some(m => m.type === 'audio' && m.audio === permittedAudio));

  current = { ...current, contentRestricted: true, name: 'Agent任务', instructions: '', result: '' };
  await wait(() => messages.some(m => m.type === 'task' && m.item.contentRestricted === true));
  const boundary = messages.length;
  const lateAudio = Buffer.alloc(20, 2).toString('base64');
  if (provider.readyState === WebSocket.OPEN) {
    sendFrame('response.output_audio.delta', { audio: lateAudio });
    sendFrame('response.output_text.delta', { delta: source });
    sendFrame('response.output_text.done', { text: source });
    // Frames sent on this same connection are handled in order.
    transcript('stream-observation-boundary');
  }
  await wait(() => socket.readyState === WebSocket.CLOSED || messages.some(m => m.type === 'transcript' && m.text === 'stream-observation-boundary'));
  const lateFrames = messages.slice(boundary).filter(m => m.type === 'audio' && m.audio === lateAudio || m.type === 'reply' && m.text === source);
  expect(lateFrames).toEqual([]);
  const maskIndex = messages.findIndex(m => m.type === 'task' && m.item.contentRestricted === true);
  expect(messages.slice(maskIndex, maskIndex + 3).map(m => m.type)).toEqual(['task', 'speech_stopped', 'error']);
  expect(messages[maskIndex + 2].code).toBe('VOICE_ACCESS_CHANGED');
  expect(socket.readyState).toBe(WebSocket.CLOSED);
  expect(b.control).not.toHaveBeenCalled();
  expect(b.submit).not.toHaveBeenCalled();
  await expect(service.issue({ ...b, taskId: undefined }, 'http://127.0.0.1')).resolves.toHaveProperty('ticket');
});

it('checks the current task before a voice control and sends no tool result after confirmed restriction', async () => {
  const b = binding(); b.taskId = 'task-1';
  const allowed = item({ state: 'waiting_human' });
  let current = allowed;
  vi.mocked(b.task).mockImplementation(async () => current);
  const { socket, messages } = await connect(await service.issue(b, 'http://127.0.0.1'));
  await wait(() => messages.some(m => m.type === 'task' && m.item.id === allowed.id));
  call('authorized-context', 'bambook_voice_context'); await wait(() => result('authorized-context'));
  vi.mocked(b.authorize).mockImplementationOnce(async () => {
    current = { ...allowed, name: 'Agent任务', instructions: '', state: 'access_changed', contentRestricted: true };
  });
  transcript('暂停这项工作');
  call('restricted-control', 'bambook_voice_control', { action: 'pause' });
  await wait(() => socket.readyState === WebSocket.CLOSED);
  expect(messages.some(m => m.type === 'task' && m.item.contentRestricted)).toBe(true);
  expect(messages.some(m => m.code === 'VOICE_ACCESS_CHANGED')).toBe(true);
  expect(b.control).not.toHaveBeenCalled();
  expect(result('restricted-control')).toBeUndefined();
  await expect(service.issue(b, 'http://127.0.0.1')).rejects.toMatchObject({ code: 'VOICE_ACCESS_CHANGED' });
});

it('does not replay a cached context result when a repeated provider callback discovers restriction', async () => {
  const b = binding(); b.taskId = 'task-1';
  const report = item({ state: 'succeeded', result: 'SYNTHETIC_CACHED_VOICE_CONTEXT', canControl: false });
  let current = report;
  vi.mocked(b.task).mockImplementation(async () => current);
  const { socket, messages } = await connect(await service.issue(b, 'http://127.0.0.1'));
  call('cached-context', 'bambook_voice_context'); await wait(() => result('cached-context'));
  expect(JSON.stringify(result('cached-context'))).toContain(report.result);
  vi.mocked(b.authorize).mockImplementationOnce(async () => {
    current = { ...report, name: 'Agent任务', instructions: '', result: '', contentRestricted: true };
  });
  call('cached-context', 'bambook_voice_context');
  await wait(() => socket.readyState === WebSocket.CLOSED);
  expect(messages.some(m => m.code === 'VOICE_ACCESS_CHANGED')).toBe(true);
  expect(received.filter(m => m.type === 'conversation.item.create' && m.items[0].call_id === 'cached-context')).toHaveLength(1);
});

it('does not close the new binding for a late restricted read of the former task', async () => {
  const b = binding(); b.taskId = 'task-1';
  const oldRead = Promise.withResolvers<AgentTaskView>();
  const next = item({ id: 'task-2', state: 'running' });
  const { socket, messages } = await connect(await service.issue(b, 'http://127.0.0.1'));
  await wait(() => messages.some(m => m.type === 'task' && m.item.id === 'task-1'));
  call('former-context', 'bambook_voice_context'); await wait(() => result('former-context'));
  let previousInFlight = false;
  vi.mocked(b.task).mockImplementation(async id => {
    if (id === next.id) return next;
    previousInFlight = true;
    return oldRead.promise;
  });
  await wait(() => previousInFlight);
  socket.send(JSON.stringify({ type: 'bind_task', taskId: next.id }));
  await wait(() => messages.some(m => m.type === 'task' && m.item.id === next.id));
  oldRead.resolve(item({ state: 'access_changed', contentRestricted: true }));
  call('former-context', 'bambook_voice_context');
  call('current-context', 'bambook_voice_context'); await wait(() => result('current-context'));
  expect(socket.readyState).toBe(WebSocket.OPEN);
  expect(messages.some(m => m.item?.contentRestricted)).toBe(false);
  expect(received.filter(m => m.type === 'conversation.item.create' && m.items[0].call_id === 'former-context')).toHaveLength(1);
});

it('expires abandoned tickets and rejects arbitrary client tool commands', async () => {
  const b = binding(), old = await service.issue(b, 'http://127.0.0.1'); now += 30_001;
  await expect(connect(old)).rejects.toThrow('401');
  const { socket, messages } = await connect(await service.issue(b, 'http://127.0.0.1'));
  socket.send(JSON.stringify({ type: 'execute', command: 'finance.payment' }));
  await wait(() => messages.some(m => m.code === 'VOICE_INPUT_INVALID'));
  expect(b.submit).not.toHaveBeenCalled(); expect(b.control).not.toHaveBeenCalled();
});

it('keeps speech tools separate from business tools and validates configuration', () => {
  const session = voiceSession(config, 'call', 'en-US');
  expect(session.session.tools.map(t => t.name)).toEqual(['bambook_voice_context', 'bambook_voice_interrupt', 'bambook_voice_task', 'bambook_voice_control']);
  expect(JSON.stringify(session)).not.toContain(config.apiKey);
  expect(voiceConfig({ BAMBOOK_VOICE_API_KEY: 'bad\r\nkey' })).toBeNull();
  expect(voiceConfig({ BAMBOOK_VOICE_API_KEY: 'configured', BAMBOOK_VOICE_SPEED: '999' })?.speed).toBe(0);
});
it('continues the same authorized task when its owner hands work over in text during a call', async () => {
  const b = binding(), { socket } = await connect(await service.issue(b, 'http://127.0.0.1'));
  vi.mocked(b.task).mockResolvedValue(item({ id: 'typed-task', state: 'waiting_human', questions: [{ id: 'q', question: '请补充交期', askedAt: '' }] }));
  socket.send(JSON.stringify({ type: 'bind_task', taskId: 'typed-task' }));
  await wait(() => vi.mocked(b.task).mock.calls.some(([id]) => id === 'typed-task'));
  transcript('十一月二十日交货'); call('text-follow-up'); await wait(() => result('text-follow-up'));
  expect(b.submit).toHaveBeenCalledWith('十一月二十日交货', expect.any(String), expect.objectContaining({ id: 'typed-task' }));
});
it('drops late audio after interruption and resumes only for a new audio response', async () => {
  const b = binding(), { socket, messages } = await connect(await service.issue(b, 'http://127.0.0.1'));
  const audio = Buffer.alloc(20).toString('base64');
  provider.send(JSON.stringify({ type: 'response.output_audio.delta', audio })); await wait(() => messages.filter(m => m.type === 'audio').length === 1);
  socket.send(JSON.stringify({ type: 'interrupt' })); await wait(() => received.some(m => m.type === 'response.cancel'));
  provider.send(JSON.stringify({ type: 'response.output_audio.delta', audio }));
  provider.send(JSON.stringify({ type: 'response.canceled' })); provider.send(JSON.stringify({ type: 'response.output_audio.started' }));
  provider.send(JSON.stringify({ type: 'response.output_audio.delta', audio }));
  await wait(() => messages.filter(m => m.type === 'audio').length === 2);
  expect(messages.filter(m => m.type === 'audio')).toHaveLength(2); expect(b.control).not.toHaveBeenCalled();
});
it('does not revive a cancelled response when its late chunks arrive after a new response started', async () => {
  const b = binding(), { socket, messages } = await connect(await service.issue(b, 'http://127.0.0.1'));
  const audio = Buffer.alloc(20).toString('base64');
  provider.send(JSON.stringify({ type: 'response.output_audio.started', response_id: 'old' }));
  provider.send(JSON.stringify({ type: 'response.output_audio.delta', response_id: 'old', audio })); await wait(() => messages.some(m => m.type === 'audio'));
  socket.send(JSON.stringify({ type: 'interrupt' })); await wait(() => received.some(m => m.type === 'response.cancel'));
  provider.send(JSON.stringify({ type: 'response.output_audio.started', response_id: 'new' }));
  provider.send(JSON.stringify({ type: 'response.output_audio.delta', response_id: 'old', audio }));
  provider.send(JSON.stringify({ type: 'response.output_audio.delta', response_id: 'new', audio }));
  await wait(() => messages.filter(m => m.type === 'audio').length === 2);
  expect(messages.filter(m => m.type === 'audio')).toHaveLength(2);
});
it('does not require a cancel acknowledgement when speech starts while no reply is active', async () => {
  const b = binding(), { messages } = await connect(await service.issue(b, 'http://127.0.0.1'));
  provider.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.started' }));
  await wait(() => received.some(m => m.type === 'response.cancel'));
  provider.send(JSON.stringify({ type: 'response.output_audio.started' }));
  provider.send(JSON.stringify({ type: 'response.output_audio.delta', audio: Buffer.alloc(20).toString('base64') }));
  await wait(() => messages.some(m => m.type === 'audio'));
});
it('stops spoken output without cancelling the business task when the user asks to stop reading', async () => {
  const b = binding(), { messages } = await connect(await service.issue(b, 'http://127.0.0.1'));
  transcript('别念了，继续在后台办理'); call('speech-only', 'bambook_voice_interrupt'); await wait(() => result('speech-only'));
  expect(messages.some(m => m.type === 'speech_stopped')).toBe(true);
  expect(b.control).not.toHaveBeenCalled(); expect(b.submit).not.toHaveBeenCalled();
});
it('summarizes long public results without cutting identifiers, money or unfinished sentences', () => {
  const result = '订单 SO-G-2026-018 已批准待履约，履约 59%。\n客户 Cedar & Crown，金额 USD 140,800.50。\n' + '后续资料已核对。'.repeat(70);
  const spoken = voiceConclusion(result);
  expect(spoken).toContain('SO-G-2026-018'); expect(spoken).toContain('USD 140,800.50'); expect(spoken.length).toBeLessThan(240);
  expect(spoken).toContain('完整内容已保存在原事项');
  expect(voiceConclusion('x'.repeat(2000), '请查看原件')).toBe('请查看原件');
  expect(voiceConclusion('单据 FOB#123 金额 USD 23.50。')).toContain('FOB#123');
});
