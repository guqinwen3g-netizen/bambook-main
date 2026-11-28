// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentTaskView } from '../../../../server/src/shared/mistAgentTasks';
const seam = vi.hoisted(() => ({ api: vi.fn(), media: vi.fn(), close: vi.fn(), stopAudio: vi.fn(), onTask: vi.fn() }));
vi.mock('./workspace', () => ({ mistApiRequest: (...args: any[]) => seam.api(...args) }));
const context = { audioWorklet: { addModule: vi.fn(async () => undefined) }, createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })), createGain: vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() })), destination: {} };
vi.mock('./voiceAudio', () => ({ RealtimePcmPlayer: { create: () => ({ getAudioContext: () => context, isPlaying: () => false, stop: seam.stopAudio, close: seam.close, enqueue: vi.fn(async () => undefined) }) } }));
import { usePersonalAgentVoice } from './personalAgentVoice';
let root: Root, host: HTMLDivElement;
let latestVoice: ReturnType<typeof usePersonalAgentVoice>;
let tracks: Array<{ enabled: boolean; stop: ReturnType<typeof vi.fn>; addEventListener: (type: string, fn: () => void) => void; end: () => void }>;
let workletNodes: any[] = [];
class Socket {
  static OPEN = 1; static CLOSING = 2; static instances: Socket[] = [];
  readyState = 1; bufferedAmount = 0; binaryType = '';
  onmessage?: (e: any) => void; onerror?: () => void; onclose?: () => void;
  send = vi.fn(); close = vi.fn(() => { this.readyState = 3; this.onclose?.(); });
  constructor(public url: string, public protocols: string[]) { Socket.instances.push(this); }
  event(value: any) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
function Harness({ scope = 'A', workspaceId = 'company-A', conversationId }: { scope?: string; workspaceId?: string; conversationId?: string }) {
  const voice = usePersonalAgentVoice(scope, workspaceId, seam.onTask, conversationId);
  latestVoice = voice;
  return <><span data-testid="state">{voice.state}</span><span>{voice.error}</span><button onClick={() => void voice.start()}>start</button><button onClick={() => void voice.start('task-with-question', 'question-1')}>start selected question</button><button onClick={voice.end}>end</button><button onClick={voice.toggleMute}>mute</button><button onClick={voice.interrupt}>interrupt</button></>;
}
const flush = async () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
const click = async (text: string) => { act(() => [...host.querySelectorAll('button')].find(button => button.textContent === text)!.click()); await flush(); };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); Socket.instances = [];
  workletNodes = [];
  const track: any = { enabled: true, stop: vi.fn(), listeners: [] as Array<() => void> };
  track.addEventListener = (type: string, fn: () => void) => { if (type === 'ended') track.listeners.push(fn); };
  track.end = () => track.listeners.forEach((fn: () => void) => fn());
  tracks = [track];
  seam.media.mockResolvedValue({ getTracks: () => tracks, getAudioTracks: () => tracks });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: seam.media } });
  vi.stubGlobal('WebSocket', Socket); vi.stubGlobal('AudioContext', class {});
  vi.stubGlobal('AudioWorkletNode', class { port = { onmessage: null }; onprocessorerror: null | (() => void) = null; connect = vi.fn(); disconnect = vi.fn(); constructor() { workletNodes.push(this); } });
  seam.api.mockImplementation(async (url: string, init: any) => init?.method === 'POST' ? { id: 'call', ticket: 'private-one-use-ticket' } : { configured: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('releases microphone/playback on hangup and carries the ticket outside the URL', async () => {
  await click('start'); const socket = Socket.instances[0]; expect(socket).toBeTruthy();
  expect(socket.url).not.toContain('private-one-use-ticket'); expect(socket.protocols).toContain('bambook-ticket.private-one-use-ticket');
  act(() => socket.event({ type: 'ready' })); await click('mute');
  expect(tracks[0].enabled).toBe(false); expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'mute', muted: true }));
  await click('interrupt'); expect(seam.stopAudio).toHaveBeenCalled();
  await click('end'); expect(tracks[0].stop).toHaveBeenCalledOnce(); expect(seam.close).toHaveBeenCalledOnce(); expect(host.textContent).toContain('idle');
});

it('discards late permission grants after an account/company change without creating a session', async () => {
  let grant!: (value: unknown) => void; seam.media.mockImplementation(() => new Promise(resolve => { grant = resolve; }));
  await click('start'); expect(seam.media).toHaveBeenCalledOnce();
  act(() => root.render(<Harness scope="B" workspaceId="company-B" />));
  grant({ getTracks: () => tracks, getAudioTracks: () => tracks }); await flush();
  expect(tracks[0].stop).toHaveBeenCalledOnce(); expect(Socket.instances).toHaveLength(0);
  expect(seam.api.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

it('reconnects to the existing persistent task without replaying old audio or submitting a new task', async () => {
  await click('start'); const old = Socket.instances[0];
  act(() => { old.event({ type: 'ready' }); old.event({ type: 'task', item: { id: 'existing-task' } }); old.onclose?.(); }); await flush();
  expect(host.textContent).toContain('error'); await click('start');
  const posts = seam.api.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(JSON.parse(posts[1][1].body)).toMatchObject({ taskId: 'existing-task' });
  expect(posts.every(([url]) => url.endsWith('/voice/sessions'))).toBe(true);
  expect(Socket.instances[1].send).not.toHaveBeenCalled();
  act(() => old.event({ type: 'task', item: { id: 'stale-task' } })); expect(seam.onTask).toHaveBeenCalledTimes(1);
});

it('clears queued playback, the old reply and the restricted selection before reconnecting', async () => {
  await click('start'); const socket = Socket.instances[0];
  act(() => {
    socket.event({ type: 'ready' });
    socket.event({ type: 'task', item: { id: 'restricted-task' } });
    socket.event({ type: 'reply', text: '原报告正文' });
  });
  expect(latestVoice.reply).toBe('原报告正文');
  act(() => {
    socket.event({ type: 'task', item: { id: 'restricted-task', contentRestricted: true } });
    socket.event({ type: 'speech_stopped' });
    socket.event({ type: 'error', code: 'VOICE_ACCESS_CHANGED', message: '语音授权已变化，请重新连接' });
    socket.event({ type: 'reply', text: '迟到的原报告正文' });
  });
  expect(latestVoice.reply).toBe('');
  expect(latestVoice.state).toBe('error');
  expect(seam.stopAudio).toHaveBeenCalledOnce();
  expect(seam.close).toHaveBeenCalledOnce();
  expect(tracks[0].stop).toHaveBeenCalledOnce();
  expect(seam.onTask).toHaveBeenLastCalledWith({ id: 'restricted-task', contentRestricted: true });
  await click('start');
  const posts = seam.api.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(JSON.parse(posts[1][1].body)).not.toHaveProperty('taskId');
});

it('keeps the task on same-conversation reconnect and drops late bindings after switching conversations', async () => {
  act(() => root.render(<Harness conversationId="c_original_room" />));
  await click('start');
  const original = Socket.instances[0];
  const oldFollow = latestVoice.followTask;
  const task = { id:'task-a', conversationId:'c_original_room' } as AgentTaskView;
  act(() => { original.event({ type:'ready' }); original.event({ type:'task', item:task }); });
  await click('end');
  await click('start');
  const restarted = Socket.instances[1];
  act(() => root.render(<Harness conversationId="c_next_room" />));
  expect(restarted.close).toHaveBeenCalledOnce();
  await click('start');
  const newRoom = Socket.instances[2];
  act(() => {
    newRoom.event({ type:'ready' });
    oldFollow(task);
    original.event({ type:'task', item:task });
  });
  expect(newRoom.send).not.toHaveBeenCalled();
  expect(seam.onTask).toHaveBeenCalledExactlyOnceWith(task);
  const posts = seam.api.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init.body));
  expect(posts).toEqual([
    expect.objectContaining({conversationId:'c_original_room'}),
    expect.objectContaining({conversationId:'c_original_room',taskId:'task-a'}),
    expect.objectContaining({conversationId:'c_next_room'}),
  ]);
  expect(posts[2]).not.toHaveProperty('taskId');
});

it('preserves the selected question across a disconnect and releases it only after the server rejects the stale ticket', async () => {
  let stale = false;
  seam.api.mockImplementation(async (_url: string, init: any) => {
    if (init?.method !== 'POST') return {configured:true};
    if (stale && JSON.parse(init.body).questionId) throw Object.assign(Error('问题已更新，请在原事项核对'),{code:'AGENT_TASK_CHANGED'});
    return {id:'call',ticket:'private-one-use-ticket'};
  });
  await click('start selected question');
  const socket=Socket.instances[0];
  act(() => {
    socket.event({type:'ready'});
    socket.event({type:'task',item:{id:'task-with-question',questions:[{id:'question-1',answer:'另一页回答',answeredAt:'2026-11-26T01:00:00Z'}]}});
    socket.onclose?.();
  });
  stale=true;
  await click('start');
  expect(host.textContent).toContain('问题已更新，请在原事项核对');
  expect(Socket.instances).toHaveLength(1);
  await click('start');
  expect(Socket.instances).toHaveLength(2);
  const posts=seam.api.mock.calls.filter(([,init])=>init?.method==='POST').map(([,init])=>JSON.parse(init.body));
  expect(posts[1]).toMatchObject({taskId:'task-with-question',questionId:'question-1'});
  expect(posts[2]).not.toHaveProperty('taskId');
  expect(posts[2]).not.toHaveProperty('questionId');
});

it('clears the selected question on the receipt for its own spoken answer',async()=>{
  await click('start selected question');
  const socket=Socket.instances[0];
  act(() => {
    socket.event({type:'ready'});
    socket.event({type:'task',item:{id:'task-with-question'},answeredQuestionId:'question-1'});
    socket.onclose?.();
  });
  await click('start');
  const posts=seam.api.mock.calls.filter(([,init])=>init?.method==='POST').map(([,init])=>JSON.parse(init.body));
  expect(posts[1].taskId).toBe('task-with-question');
  expect(posts[1]).not.toHaveProperty('questionId');
});

it('does not request the microphone when the platform has no voice connection', async () => {
  seam.api.mockResolvedValue({ configured: false }); await click('start');
  expect(seam.media).not.toHaveBeenCalled(); expect(seam.close).toHaveBeenCalledOnce(); expect(host.textContent).toContain('平台尚未配置实时语音');
});

it.each(['status', 'worklet', 'ticket', 'socket'] as const)('ends a call if the %s stage stalls and ignores its late result', async stage => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined, resolveLate: ((value: any) => void) | undefined;
  const pending = () => new Promise<any>(resolve => { resolveLate = resolve; });
  const loadWorklet = stage === 'worklet' ? context.audioWorklet.addModule.mockImplementationOnce(pending) : undefined;
  seam.api.mockImplementation(async (url: string, init?: RequestInit) => {
    if (stage === 'status' && url.endsWith('/status') || stage === 'ticket' && init?.method === 'POST') {
      signal = init?.signal ?? undefined;
      return pending();
    }
    return init?.method === 'POST' ? { id: 'call', ticket: 'fake-ticket' } : { configured: true };
  });
  try {
    await click('start');
    await flush();
    expect(latestVoice.state).toBe('connecting');
    await act(async () => vi.advanceTimersByTimeAsync(stage === 'socket' ? 18_001 : 10_001));
    expect(latestVoice.state).toBe('error');
    expect(latestVoice.error).toBe('语音连接超时，请重试');
    expect(tracks[0].stop).toHaveBeenCalledTimes(stage === 'status' ? 0 : 1);
    expect(seam.close).toHaveBeenCalledOnce();
    if (stage === 'status' || stage === 'ticket') expect(signal?.aborted).toBe(true);
    if (stage === 'socket') {
      expect(Socket.instances[0].close).toHaveBeenCalledOnce();
      act(() => Socket.instances[0].event({ type: 'ready' }));
    } else {
      await act(async () => resolveLate?.(stage === 'status' ? { configured: true } : stage === 'ticket' ? { id: 'late', ticket: 'late' } : undefined));
      expect(Socket.instances).toHaveLength(0);
    }
    expect(workletNodes).toHaveLength(0);
    expect(seam.api.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(stage === 'status' || stage === 'worklet' ? 0 : 1);
  } finally {
    loadWorklet?.mockReset();
    if (loadWorklet) loadWorklet.mockResolvedValue(undefined);
    vi.useRealTimers();
  }
});

it('cancels the deadline once the voice connection is ready', async () => {
  vi.useFakeTimers();
  try {
    await click('start');
    await flush();
    const socket = Socket.instances[0];
    act(() => socket.event({ type: 'ready' }));
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(latestVoice.state).toBe('listening');
    expect(socket.close).not.toHaveBeenCalled();
    expect(tracks[0].stop).not.toHaveBeenCalled();
    await click('end');
  } finally { vi.useRealTimers(); }
});

it('leaves the native microphone permission prompt pending until the user decides', async () => {
  vi.useFakeTimers();
  let grant: ((value: unknown) => void) | undefined;
  seam.media.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
  try {
    await click('start');
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(latestVoice.state).toBe('connecting');
    expect(seam.api.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    await click('end');
    await act(async () => grant?.({ getTracks: () => tracks, getAudioTracks: () => tracks }));
    expect(tracks[0].stop).toHaveBeenCalledOnce();
    expect(Socket.instances).toHaveLength(0);
  } finally { vi.useRealTimers(); }
});

it('ends the call and releases the microphone when the device disconnects mid-call', async () => {
  await click('start'); const socket = Socket.instances[0];
  act(() => socket.event({ type: 'ready' })); await flush();
  act(() => tracks[0].end()); await flush();
  expect(host.textContent).toContain('error'); expect(host.textContent).toContain('麦克风已断开，已交办事项继续执行');
  expect(tracks[0].stop).toHaveBeenCalledOnce(); expect(socket.close).toHaveBeenCalled(); expect(seam.close).toHaveBeenCalledOnce();
});

it('ends the call when the capture processor fails', async () => {
  await click('start'); const socket = Socket.instances[0];
  act(() => socket.event({ type: 'ready' })); await flush();
  act(() => workletNodes[0].onprocessorerror()); await flush();
  expect(host.textContent).toContain('麦克风采集中断，已交办事项继续执行');
  expect(tracks[0].stop).toHaveBeenCalledOnce(); expect(socket.close).toHaveBeenCalled();
});
