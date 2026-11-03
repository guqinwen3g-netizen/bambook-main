import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, mistCommandPermission, type MistCommand, type MistContext, type MistState } from './mistWorkspace';
import { monthLocked } from './mistPeriodClose';

const ctx = { id: (() => { let n = 0; return () => `pc-${++n}`; })(), now: '2026-11-05T02:00:00Z', actorId: 'fin', actorName: '林舒' } as MistContext;
function setup() {
  let state = createMistState(ctx, 'empty');
  const run = (command: MistCommand) => { const r = applyMistCommand(state, command, ctx); state = r.state; return r.result; };
  run({ type: 'finance.importReceipts', payload: { receipts: [{ date: '2026-09-28', payer: 'Cedar', amount: 100, currency: 'USD', ref: 'SEP' }, { date: '2026-10-28', payer: 'Cedar', amount: 200, currency: 'USD', ref: 'OCT' }] } });
  return { run, get state(): MistState { return state; } };
}
describe('month-end close', () => {
  it('closes months in order and locks every finance fact dated in or before them', () => {
    const f = setup();
    expect(() => f.run({ type: 'finance.period.close', payload: { month: '2026-11', note: '月中' } })).toThrow('已过去');
    f.run({ type: 'finance.period.close', payload: { month: '2026-09', note: '银行余额与流水核对一致' } });
    expect(() => f.run({ type: 'finance.period.close', payload: { month: '2026-11', note: 'x' } })).toThrow('已过去');
    expect(monthLocked(f.state, '2026-08')).toBe(true);
    expect(() => f.run({ type: 'finance.importReceipts', payload: { receipts: [{ date: '2026-09-30', payer: 'X', amount: 1, currency: 'USD', ref: 'LATE' }] } })).toThrow('2026-09 已结账');
    f.run({ type: 'finance.importReceipts', payload: { receipts: [{ date: '2026-10-30', payer: 'X', amount: 1, currency: 'USD', ref: 'OK' }] } });
    f.run({ type: 'finance.period.close', payload: { month: '2026-10', note: '十月核对' } });
    expect(() => f.run({ type: 'finance.payment.save', payload: { date: '2026-10-15', payee: 'Mill', amount: 5, currency: 'USD', ref: '' } })).toThrow('已结账');
    f.run({ type: 'finance.payment.save', payload: { date: '2026-11-03', payee: 'Mill', amount: 5, currency: 'USD', ref: '' } });
  });
  it('reopens only the latest closed month, with the approval permission and a reason', () => {
    const f = setup();
    f.run({ type: 'finance.period.close', payload: { month: '2026-09', note: 'ok' } });
    f.run({ type: 'finance.period.close', payload: { month: '2026-10', note: 'ok' } });
    expect(mistCommandPermission({ type: 'finance.period.reopen', payload: { month: '2026-10', reason: 'x' } })).toBe('invoices:approve:writeoff');
    expect(() => f.run({ type: 'finance.period.reopen', payload: { month: '2026-09', reason: '补登' } })).toThrow('2026-10');
    f.run({ type: 'finance.period.reopen', payload: { month: '2026-10', reason: '漏登一笔到账' } });
    f.run({ type: 'finance.importReceipts', payload: { receipts: [{ date: '2026-10-29', payer: 'X', amount: 3, currency: 'USD', ref: 'FIX' }] } });
    expect(f.state.periodCloses!.map(c => [c.month, !!c.reopened])).toEqual([['2026-09', false], ['2026-10', true]]);
  });
});
describe('monthly voucher export', () => {
  it('produces balanced suggested entries with account codes and period-rate CNY', async () => {
    const { monthlyVouchers } = await import('./mistVoucherExport');
    const f = setup();
    (f.state as any).fxPeriodRates = [{ id: 'r', code: 'R', month: '2026-10', currency: 'USD', rate: '7.10', source: '中行', createdAt: '', actor: '' }];
    const lines = monthlyVouchers(f.state, '2026-10');
    expect(lines.map(l => l.account)).toEqual(['1002', '2203']);
    expect(lines[0]).toMatchObject({ currency: 'USD', amount: 200, rate: 7.1, debit: 1420 });
    const sum = (k: 'debit' | 'credit') => lines.reduce((n, l) => n + (l[k] || 0), 0);
    expect(sum('debit')).toBe(sum('credit'));
  });
});
