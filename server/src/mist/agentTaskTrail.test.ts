import { expect, it } from 'vitest';
import { platformTrail } from './agentTaskTrail';

const step = (name: string, args: Record<string, unknown>, result?: unknown) => ({ id: 's', at: '', plan: { name, arguments: args }, ...(result === undefined ? {} : { result }) }) as any;

it('names a record read by its number, and never shows an internal id while the read is still in flight', () => {
  const [done, pending, coded] = platformTrail([
    step('bambook_get', { type: 'order', id: '7639f2bd-15de-4dc0-ba7c-0a1b2c3d4e5f' }, { label: 'SO-G-2026-017' }),
    step('bambook_get', { type: 'order', id: '7639f2bd-15de-4dc0-ba7c-0a1b2c3d4e5f' }),
    step('bambook_get', { type: 'order', id: 'SO-G-2026-018' }),
  ]);
  expect(done.label).toBe('读取订单 SO-G-2026-017');
  expect(pending.label).toBe('读取订单');
  expect(pending.ref?.label).toBe('订单');
  expect(coded.label).toBe('读取订单 SO-G-2026-018');
});
