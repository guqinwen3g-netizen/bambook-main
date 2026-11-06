// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const seam = vi.hoisted(() => ({ api: vi.fn(), media: vi.fn(), close: vi.fn(), stopAudio: vi.fn(), onTask: vi.fn() }));
vi.mock('./workspace', () => ({ mistApiRequest: (...args: any[]) => seam.api(...args) }));
const context = { audioWorklet: { addModule: vi.fn(async () => undefined) }, createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })), createGain: vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() })), destination: {} };
vi.mock('./voiceAudio', () => ({ RealtimePcmPlayer: { create: () => ({ getAudioContext: () => context, isPlaying: () => false, stop: seam.stopAudio, close: seam.close, enqueue: vi.fn(async () => undefined) }) } }));
import { usePersonalAgentVoice } from './personalAgentVoice';
let root: Root, host: HTMLDivElement;
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
function Harness({ scope = 'A', workspaceId = 'company-A' }: { scope?: string; workspaceId?: string }) {
  const voice = usePersonalAgentVoice(scope, workspaceId, seam.onTask);
  return <><span data-testid="state">{voice.state}</span><span>{voice.error}</span><button onClick={() => void voice.start()}>start</button><button onClick={voice.end}>end</button><button onClick={voice.toggleMute}>mute</button><button onClick={voice.interrupt}>interrupt</button></>;
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

it('does not request the microphone when the platform has no voice connection', async () => {
  seam.api.mockResolvedValue({ configured: false }); await click('start');
  expect(seam.media).not.toHaveBeenCalled(); expect(seam.close).toHaveBeenCalledOnce(); expect(host.textContent).toContain('平台尚未配置实时语音');
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
