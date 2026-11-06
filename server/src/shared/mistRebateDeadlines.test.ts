import { describe, expect, it } from 'vitest';
import { createMistState } from './mistWorkspace';
import { rebateDeadlineFor, rebateDeadlines } from './mistRebateDeadlines';

describe('rebate filing deadlines', () => {
  const demo = () => createMistState({ id: (() => { let n = 0; return () => `d-${++n}`; })(), now: '2026-10-17T04:00:00Z', actorName: '林舒' }, 'demo');
  it('deadline is 30 April of the year after export', () => {
    expect(rebateDeadlineFor('2026-10-13')).toBe('2027-04-30');
  });
  it('lists departed, unfiled customs with missing documents and days left', () => {
    const state = demo();
    const rows = rebateDeadlines(state, '2026-10-17');
    expect(rows.length).toBeGreaterThan(0);
    const ready = rows.find(r => !r.missing.length)!;
    expect(ready).toMatchObject({ deadline: '2027-04-30', state: 'ready' });
    state.payables!.bills = [];
    expect(rebateDeadlines(state, '2026-10-17').find(r => r.customsId === ready.customsId)!.missing).toContain('增值税专用发票');
    expect(rebateDeadlines(state, '2027-03-15').find(r => r.customsId === ready.customsId)!.state).toBe('due');
    expect(rebateDeadlines(state, '2027-05-01').find(r => r.customsId === ready.customsId)!.state).toBe('overdue');
  });
});
