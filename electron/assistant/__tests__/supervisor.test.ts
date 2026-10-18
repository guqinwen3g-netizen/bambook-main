import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const forks = vi.hoisted(() => [] as Array<EventEmitter & { pid: number; postMessage: (m: any) => void; kill: () => void; sent: any[] }>);
vi.mock('electron', () => ({
  app: { getAppMetrics: () => [] },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text' },
  utilityProcess: {
    fork: () => {
      const child = Object.assign(new EventEmitter(), {
        pid: 1000 + forks.length, sent: [] as any[],
        // 假 host：收到请求立即应答。
        postMessage: (m: any) => { child.sent.push(m); if (m?.kind === 'request') queueMicrotask(() => child.emit('message', { kind: 'response', id: m.id, ok: true, result: { method: m.method } })); },
        kill: () => child.emit('exit', 9),
      });
      forks.push(child);
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  },
}));

import { AssistantSupervisor } from '../../assistantSupervisor';

let events: any[] = [];
const make = () => new AssistantSupervisor({ hostPath: '/x/host.js', dataDir: '/tmp/bb-supervisor-test', send: (_c, p) => events.push(p) });
const states = () => events.filter(e => e?.type === 'host_status').map(e => e.status.state);
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => { vi.useFakeTimers(); forks.length = 0; events = []; });
afterEach(() => { vi.useRealTimers(); });

it('waits out the restart backoff even when the page keeps sending requests', async () => {
  const sup = make();
  await expect(sup.request('providers.list', {})).resolves.toEqual({ method: 'providers.list' });
  expect(forks).toHaveLength(1);
  forks[0].emit('exit', 9);
  expect(sup.hostStatus().state).toBe('restarting');
  // 页面在重启提示期间发出的请求（如清除委托）不能提前拉起进程。
  await expect(sup.request('session.delegation', { clear: true })).rejects.toMatchObject({ code: 'HOST_RESTARTING' });
  expect(forks).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(999);
  expect(forks).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1); await flush();
  expect(forks).toHaveLength(2);
  expect(sup.hostStatus().state).toBe('running');
  await expect(sup.request('sessions.list', {})).resolves.toEqual({ method: 'sessions.list' });
  sup.stop();
});

it('stops after the restart limit despite incoming requests and restarts only on the manual action', async () => {
  const sup = make();
  await sup.request('providers.list', {});
  for (let i = 0; i < 5; i++) {
    forks.at(-1)!.emit('exit', 9);
    await sup.request('session.delegation', { clear: true }).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(30_000); await flush();
  }
  expect(forks).toHaveLength(6);
  forks.at(-1)!.emit('exit', 9);
  expect(sup.hostStatus().state).toBe('failed');
  await expect(sup.request('sessions.list', {})).rejects.toMatchObject({ code: 'HOST_FAILED' });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(forks).toHaveLength(6);
  await sup.request('host.restart', {}); await flush();
  expect(forks).toHaveLength(7);
  expect(sup.hostStatus().state).toBe('running');
  expect(states()).toContain('failed');
  sup.stop();
});

it('restores the selected account on the restarted host without the page asking again', async () => {
  const sup = make();
  await sup.request('account.select', { accountKey: 'o|u-1', displayName: '甲' });
  forks[0].emit('exit', 9);
  await vi.advanceTimersByTimeAsync(1000); await flush();
  expect(forks[1].sent.find(m => m.method === 'account.select')?.params).toEqual({ accountKey: 'o|u-1', displayName: '甲' });
  sup.stop();
});
