// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { bindBusinessClock, businessNow } from '../../runtime/businessClock';
import { today } from './fulfillmentKit';
import { todayIso } from './pageKit';

afterEach(() => { bindBusinessClock(undefined); vi.useRealTimers(); });
it('uses the same business day as the server after Shanghai midnight, while preserving the UTC instant', () => {
  vi.useFakeTimers(); vi.setSystemTime('2026-10-28T16:30:00.000Z'); bindBusinessClock(undefined);
  expect(today()).toBe('2026-10-29'); expect(todayIso()).toBe('2026-10-29');
  expect(businessNow().toISOString()).toBe('2026-10-28T16:30:00.000Z');
});
it('retains the selected company fixed clock and resets to the actual company day on leaving it', () => {
  vi.useFakeTimers(); vi.setSystemTime('2026-10-28T16:30:00.000Z');
  bindBusinessClock({ mode: 'fixed', at: '2026-10-07T20:18:00.000Z', timezone: 'Asia/Shanghai' });
  expect(today()).toBe('2026-10-08'); expect(todayIso()).toBe('2026-10-08');
  expect(businessNow().toISOString()).toBe('2026-10-07T20:18:00.000Z');
  bindBusinessClock(undefined); expect(today()).toBe('2026-10-29');
});
