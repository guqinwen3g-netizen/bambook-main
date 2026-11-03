import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, mistCommandPermission, type MistCommand, type MistContext, type MistState } from './mistWorkspace';

const ctx = { id: (() => { let n = 0; return () => `rs-${++n}`; })(), now: '2026-10-20T02:00:00Z', actorId: 'fin', actorName: '林舒' } as MistContext;
function setup() {
  let state = createMistState(ctx, 'empty');
  state.customers.push({ id: 'c', name: 'Cedar', code: 'C' } as any);
  state.orders.push({ id: 'o', code: 'SO-1', customerId: 'c', customer: 'Cedar', currency: 'USD', amount: 1000, type: 'garment' } as any);
  state.orderLines.push({ id: 'l', orderId: 'o', name: '大衣', style: 'C1', img: 'coat', qty: 100, unit: '件', price: 10, made: 0, qc: 0 } as any);
  for (const [id, amount] of [['i1', 300], ['i2', 500], ['i3', 200]] as const) state.invoices.push({ id, code: id.toUpperCase(), orderId: 'o', order: 'SO-1', customer: 'Cedar', due: '2026-10-30', amount, open: amount, currency: 'USD' });
  const run = (command: MistCommand) => { const r = applyMistCommand(state, command, ctx); state = r.state; return r.result; };
  run({ type: 'finance.importReceipts', payload: { receipts: [{ date: '2026-10-19', payer: 'Cedar', amount: 790, currency: 'USD', ref: 'TT-1019' }] } });
  return { run, get state(): MistState { return state; } };
}
describe('receivable settlement', () => {
  it('spreads one receipt over several invoices in one step and refuses over-allocation', () => {
    const f = setup(), r = f.state.receipts[0].id;
    expect(() => f.run({ type: 'finance.reconcile', payload: { receiptId: r, lines: [{ invoiceId: 'i1', amount: 300 }, { invoiceId: 'i2', amount: 500 }] } })).toThrow('I2');
    expect(f.state.allocations).toHaveLength(0);
    expect(f.run({ type: 'finance.reconcile', payload: { receiptId: r, lines: [{ invoiceId: 'i1', amount: 300 }, { invoiceId: 'i2', amount: 490 }] } }).applied).toBe(2);
    expect(f.state.invoices.map(i => i.open)).toEqual([0, 10, 200]);
    expect(f.state.receipts[0].remaining).toBe(0);
  });
  it('writes off a small difference within the limit, and bad debt only with collection evidence and authority', () => {
    const f = setup(), r = f.state.receipts[0].id;
    f.run({ type: 'finance.reconcile', payload: { receiptId: r, lines: [{ invoiceId: 'i1', amount: 300 }, { invoiceId: 'i2', amount: 490 }] } });
    expect(() => f.run({ type: 'finance.receivable.writeoff', payload: { invoiceId: 'i2', kind: 'difference', amount: 60, reason: '汇款尾差' } })).toThrow('超出');
    f.run({ type: 'finance.receivable.writeoff', payload: { invoiceId: 'i2', kind: 'difference', amount: 10, reason: '客户汇款尾差，邮件确认' } });
    expect(f.state.invoices.find(i => i.id === 'i2')!.open).toBe(0);
    expect(() => f.run({ type: 'finance.receivable.writeoff', payload: { invoiceId: 'i3', kind: 'badDebt', amount: 200, reason: '客户破产' } })).toThrow('催收记录');
    expect(mistCommandPermission({ type: 'finance.receivable.writeoff', payload: { invoiceId: 'i3', kind: 'badDebt', amount: 1, reason: 'x' } })).toBe('invoices:approve:writeoff');
    expect(mistCommandPermission({ type: 'finance.receivable.writeoff', payload: { invoiceId: 'i3', kind: 'difference', amount: 1, reason: 'x' } })).toBe('invoices:reconcile');
    const w = f.state.invoices.find(i => i.id === 'i2')!.writeoffs![0];
    f.run({ type: 'finance.receivable.writeoff.reverse', payload: { invoiceId: 'i2', writeoffId: w.id, reason: '客户补付' } });
    expect(f.state.invoices.find(i => i.id === 'i2')!.open).toBe(10);
  });
  it('red-corrects an over-billed invoice that already has receipts, with approval authority', () => {
    const f = setup(), r = f.state.receipts[0].id;
    f.run({ type: 'finance.reconcile', payload: { receiptId: r, lines: [{ invoiceId: 'i1', amount: 100 }] } });
    expect(mistCommandPermission({ type: 'finance.receivable.writeoff', payload: { invoiceId: 'i1', kind: 'correction', amount: 1, reason: 'x' } })).toBe('invoices:approve:writeoff');
    f.run({ type: 'finance.receivable.writeoff', payload: { invoiceId: 'i1', kind: 'correction', amount: 150, reason: '单价开错 USD 1.5/米' } });
    expect(f.state.invoices.find(i => i.id === 'i1')!.open).toBe(50);
  });
});
describe('advance receipts', () => {
  it('lists the order advance and applies it to the oldest open invoices', async () => {
    const { advanceBalances } = await import('./mistOrderFunding');
    const f = setup(), r = f.state.receipts[0].id;
    f.run({ type: 'funding.assign', payload: { receiptId: r, customerId: 'c', orderId: 'o', amount: 400, note: '30% 定金，PO 附言' } });
    const before = advanceBalances(f.state);
    expect(before).toEqual([expect.objectContaining({ orderId: 'o', earmarked: 400, remaining: 400 })]);
    f.run({ type: 'finance.advance.apply', payload: { assignmentId: before[0].assignmentId } });
    expect(f.state.invoices.map(i => i.open)).toEqual([0, 400, 200]);
    expect(advanceBalances(f.state)).toEqual([]);
  });
});
