import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, type MistContext, type MistState } from './mistWorkspace';
import { payablesAging, paymentOutlook, supplierStatement } from './mistPayableViews';

let n = 0;
const ctx = (): MistContext => ({ id: () => `pv-${++n}`, now: '2026-10-14T02:00:00.000Z', actorName: '财务-林', actorId: '财务-林' }) as MistContext;
const bill = (supplierId: string, purchaseId: string, amount: number, invoiceNo: string, invoiceDate: string, due: string) => ({ type: 'payable.bill.register', payload: { supplierId, invoiceNo, invoiceDate, currency: 'CNY', amount, taxAmount: 0, taxRate: '13%', lines: [{ purchaseId, amount }], due, dueBasis: '合同' } });
function setup() {
  let state = createMistState(ctx(), 'demo'); state.payables!.bills = [];
  const po = state.fulfillment.purchases.find(p => p.code === 'PO-2026-00001')!;
  state = applyMistCommand(state, bill(po.supplierId, po.id, 30000, 'V-1', '2026-07-01', '2026-08-01') as never, ctx()).state;
  state = applyMistCommand(state, bill(po.supplierId, po.id, 20000, 'V-2', '2026-10-10', '2026-10-20') as never, ctx()).state;
  return { state: state as MistState, po };
}

describe('payables views', () => {
  it('supplier statement carries an opening balance and a running balance per currency', () => {
    const { state, po } = setup();
    const [cny] = supplierStatement(state, po.supplierId, '2026-10-01', '2026-10-14');
    expect(cny).toMatchObject({ currency: 'CNY', opening: 30000, closing: 50000 });
    expect(cny.lines).toEqual([expect.objectContaining({ kind: 'bill', credit: 20000, balance: 50000 })]);
  });
  it('payment outlook puts overdue bills in the first week and upcoming ones in their week', () => {
    const { state } = setup();
    const weeks = paymentOutlook(state, '2026-10-14', 4);
    expect(weeks[0].start).toBe('2026-10-12');
    expect(weeks[0].items).toEqual([expect.objectContaining({ amount: 30000, overdue: true })]);
    expect(weeks[1].items).toEqual([expect.objectContaining({ amount: 20000, overdue: false })]);
  });
  it('payables aging buckets open balances by days past due', () => {
    const { state } = setup();
    const [row] = payablesAging(state, '2026-10-14');
    expect(row.buckets).toMatchObject({ current: 20000, '61-90': 30000 });
    expect(row.total).toBe(50000);
    const later = payablesAging(state, '2026-10-25')[0];
    expect(later.buckets['1-30']).toBe(20000);
  });
});
