// @vitest-environment jsdom
import type React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { preloadPagesWhenIdle } from './pagePreload';
import { page } from './pageRegistry';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('preloads one page at a time and stops when the session is left', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('requestIdleCallback', undefined);
  let finish!: () => void;
  const first = new Promise<void>(resolve => { finish = resolve; });
  const load = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
  const pages: React.FC[] = [() => null, () => null];
  const stop = preloadPagesWhenIdle(pages, load);
  expect(load).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(300);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(load).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  stop();
  await vi.advanceTimersByTimeAsync(1000);
  expect(load).toHaveBeenCalledTimes(1);
});

it('does not use background data when the browser requests data saving', () => {
  vi.stubGlobal('navigator', { connection: { saveData: true } });
  const load = vi.fn();
  const stop = preloadPagesWhenIdle([() => null], load);
  expect(load).not.toHaveBeenCalled();
  stop();
});

it('pauses background downloads on a slow connection and resumes when it improves', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('requestIdleCallback', undefined);
  const connection = Object.assign(new EventTarget(), { effectiveType: '3g', saveData: false });
  vi.stubGlobal('navigator', { connection });
  const load = vi.fn().mockResolvedValue(undefined);
  const pages: React.FC[] = [() => null, () => null, () => null];
  const change = (effectiveType: string) => {
    connection.effectiveType = effectiveType;
    connection.dispatchEvent(new Event('change'));
  };
  const stop = preloadPagesWhenIdle(pages, load);
  try {
    await vi.advanceTimersByTimeAsync(1000);
    expect(load).not.toHaveBeenCalled();

    change('4g');
    await vi.advanceTimersByTimeAsync(300);
    expect(load).toHaveBeenCalledTimes(1);

    change('3g');
    await vi.advanceTimersByTimeAsync(1000);
    expect(load).toHaveBeenCalledTimes(1);

    change('4g');
    await vi.advanceTimersByTimeAsync(300);
    expect(load).toHaveBeenCalledTimes(2);

    stop();
    change('4g');
    await vi.advanceTimersByTimeAsync(1000);
    expect(load.mock.calls.map(call => call[0])).toEqual(pages.slice(0, 2));
  } finally {
    stop();
  }
});

it('does not spend extra idle slots on pages from the same code bundle', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('requestIdleCallback', undefined);
  const shared = async () => ({ First: () => null, Second: () => null });
  const first = page(shared, module => module.First);
  const second = page(shared, module => module.Second);
  const other = page(async () => ({ Other: () => null }), module => module.Other);
  const load = vi.fn().mockResolvedValue(undefined);
  const stop = preloadPagesWhenIdle([first, second, other], load);
  await vi.advanceTimersByTimeAsync(600);
  expect(load.mock.calls.map(call => call[0])).toEqual([first, other]);
  stop();
});
