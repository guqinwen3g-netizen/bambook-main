import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, mistMoneyMinor, type MistCommand, type MistContext, type MistState } from './mistWorkspace';
import { monthlyVouchers, type VoucherLine } from './mistVoucherExport';
import { assertClosedPeriodsUntouched } from './mistPeriodClose';
import { mistWorkQueue } from '../../../dev-ui-preview/mist-atelier/app/runtime/workQueue';

function fixture() {
  let seq = 0;
  const ctx: MistContext = { id: () => `fact-${++seq}`, now: '2026-10-01T02:00:00Z', actorId: 'finance', actorName: '财务' };
  let state = createMistState(ctx, 'empty');
  state.fulfillment.qcTasks = []; state.fulfillment.shipments = [];
  state.invoices = ['0398', '0405'].map(code => ({ id: code, code, orderId: '', order: '', customerId: 'customer', customer: '模拟客户', due: '2026-10-30', issuedAt: '2026-10-01', amount: 19890, open: 19890, currency: 'USD', opening: { originalAmount: 19890, note: '期初', registeredAt: ctx.now, registeredBy: ctx.actorName } }));
  const run = (command: MistCommand) => { state = applyMistCommand(state, command, ctx).state; };
  run({ type: 'finance.importReceipts', payload: { receipts: [{ date: '2026-10-01', payer: '模拟客户', amount: 19890, currency: 'USD', ref: 'BANK' }] } });
  ctx.now = '2026-11-04T02:00:00Z';
  for (const month of ['2026-10', '2026-11']) run({ type: 'fxrate.period.save', payload: { month, currency: 'USD', rate: '7.1', source: '测试牌价' } });
  ctx.now = '2026-10-01T02:00:00Z';
  const reconcile = (invoiceId: string, amount: number) => run({ type: 'finance.reconcile', payload: { receiptId: state.receipts[0].id, invoiceId, amount } });
  const reverse = () => run({ type: 'finance.allocation.reverse', payload: { allocationId: state.allocations[0].id, reason: '更正核销对象' } });
  return { get state() { return state; }, ctx, run, reconcile, reverse };
}
const sum = (rows: VoucherLine[], side: 'debit' | 'credit') => rows.reduce((n, l) => n + mistMoneyMinor(l[side] || 0), 0);
function balanced(rows: VoucherLine[]) {
  expect(rows.length).toBeGreaterThan(0);
  for (const no of new Set(rows.map(l => l.no))) {
    const voucher = rows.filter(l => l.no === no);
    expect(sum(voucher, 'debit')).toBe(sum(voucher, 'credit'));
  }
}
const advanceMinor = (rows: VoucherLine[]) => rows.filter(l => l.account === '2203' && l.currency === 'USD')
  .reduce((n, l) => n + (l.credit !== null ? 1 : -1) * mistMoneyMinor(l.amount), 0);

describe('immutable allocation-period vouchers', () => {
  it('keeps October unchanged after November reversal and reallocation, even after close', () => {
    const f = fixture(); f.reconcile('0398', 19890);
    const original = structuredClone(f.state.allocations[0]);
    const october = monthlyVouchers(f.state, '2026-10');
    f.ctx.now = '2026-11-04T02:00:00Z';
    f.run({ type: 'finance.period.close', payload: { month: '2026-10', note: '核对一致' } });
    f.reverse(); f.reconcile('0405', 12555);
    expect(monthlyVouchers(f.state, '2026-10')).toEqual(october);
    const november = monthlyVouchers(f.state, '2026-11');
    expect(november.filter(l => l.summary.startsWith('冲回核销')).map(l => [l.date, l.account, l.amount])).toEqual([
      ['2026-11-04', '1122', 19890], ['2026-11-04', '2203', 19890],
    ]);
    expect(november.find(l => l.summary.startsWith('冲回核销'))!.summary).toContain(original.id);
    expect(november.filter(l => l.summary.startsWith('收款核销')).map(l => [l.date, l.account, l.amount])).toEqual([
      ['2026-11-04', '2203', 12555], ['2026-11-04', '1122', 12555],
    ]);
    expect(november.some(l => l.account === '1002')).toBe(false);
    expect(advanceMinor(october)).toBe(0); expect(advanceMinor(november)).toBe(733500);
    expect(mistMoneyMinor(f.state.receipts[0].remaining)).toBe(733500);
    balanced(october); balanced(november);
    const before = structuredClone(f.state), tampered = structuredClone(f.state);
    tampered.financeReversals![0].allocation!.amount = 1;
    expect(() => assertClosedPeriodsUntouched(before, tampered)).toThrow('2026-10 已结账');
  });

  it('same-month reversal retains both facts and recognizes the bank receipt only once', () => {
    const f = fixture(); f.reconcile('0398', 19890); f.reverse(); f.reconcile('0405', 12555);
    const rows = monthlyVouchers(f.state, '2026-10');
    expect(rows.filter(l => l.account === '1002')).toHaveLength(1);
    expect(rows.filter(l => l.summary.startsWith('收款核销') && l.account === '1122')).toHaveLength(2);
    expect(advanceMinor(rows)).toBe(733500); balanced(rows);
  });

  it('legacy allocation without time uses receipt date, including its reversal snapshot', () => {
    const f = fixture(); f.reconcile('0398', 19890);
    delete (f.state.allocations[0] as Partial<typeof f.state.allocations[0]>).createdAt;
    const october = monthlyVouchers(f.state, '2026-10');
    f.ctx.now = '2026-11-04T02:00:00Z'; f.reverse();
    expect(monthlyVouchers(f.state, '2026-10')).toEqual(october);
    expect(monthlyVouchers(f.state, '2026-11').every(l => l.date === '2026-11-04')).toBe(true);
    balanced(october); balanced(monthlyVouchers(f.state, '2026-11'));
  });

  it('locks backdated additions, changes, removals and reversal facts, not current adjustments', () => {
    const f = fixture(); f.reconcile('0398', 19890); f.reverse();
    f.ctx.now = '2026-11-04T02:00:00Z';
    f.run({ type: 'finance.period.close', payload: { month: '2026-10', note: '核对一致' } });
    const before = structuredClone(f.state);
    for (const mutate of [
      (s: MistState) => { s.financeReversals![0].at = '2026-11-04T02:00:00Z'; },
      (s: MistState) => { s.financeReversals = []; },
      (s: MistState) => { s.financeReversals![0].allocation!.amount = 1; },
    ]) {
      const after = structuredClone(before); mutate(after);
      expect(() => assertClosedPeriodsUntouched(before, after)).toThrow('已结账');
    }
    f.ctx.now = '2026-10-10T02:00:00Z';
    expect(() => f.reconcile('0405', 1)).toThrow('已结账');
    f.ctx.now = '2026-11-04T02:00:00Z'; f.reconcile('0405', 1);
    expect(() => assertClosedPeriodsUntouched(before, f.state)).not.toThrow();
  });
});

describe('partial receipt finance work', () => {
  const items = (state: MistState) => mistWorkQueue(state, { canRead: () => true, can: p => p === 'invoices:reconcile', me: 'finance', today: '2026-11-04' }).filter(item => item.id.startsWith('receipt:'));
  it('adds the remaining amount and currency, then exits when fully allocated', () => {
    const f = fixture(); f.reconcile('0398', 12555);
    expect(items(f.state)).toEqual([expect.objectContaining({ title: '模拟客户 · USD 7,335.00', when: '部分核销', target: { view: 'payment-vouchers', id: f.state.receipts[0].id } })]);
    f.reconcile('0405', 7335); expect(items(f.state)).toEqual([]);
  });
  it('excludes a remaining balance registered as customer advance, without adding currencies', () => {
    const f = fixture(); f.reconcile('0398', 12555);
    const assignment = { id: 'advance', receiptId: f.state.receipts[0].id, customerId: 'customer', orderId: null, amount: 7335, currency: 'USD', state: 'active' };
    f.state.orderFunding = { assignments: [assignment] } as MistState['orderFunding'];
    expect(items(f.state)).toEqual([]);
    f.state.orderFunding!.assignments[0].currency = 'EUR';
    expect(items(f.state)).toHaveLength(1);
  });
});
