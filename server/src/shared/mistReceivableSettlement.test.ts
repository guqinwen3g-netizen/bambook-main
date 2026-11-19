import { describe, expect, it } from 'vitest';
import { invoiceCollectionStatus } from './mistCrm';
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
  it('counts a new allocation but not an existing one when both have the promise timestamp', () => {
    const f = setup(), receiptId = f.state.receipts[0].id;
    const allocate = (amount: number) => f.run({type:'finance.reconcile',payload:{receiptId,lines:[{invoiceId:'i1',amount}]}});
    allocate(50);
    f.run({type:'crm.followUp.save',payload:{customerId:'c',method:'call',content:'客户承诺另付30美元',at:ctx.now,nextDate:'',link:{kind:'invoice',id:'i1'},collection:{level:1,promisedDate:'2026-10-30',promisedAmount:'30'}}});
    const status = () => invoiceCollectionStatus(f.state,'i1','2026-10-20').promise;
    expect(status()).toMatchObject({state:'pending',paidSince:0});
    const legacy = structuredClone(f.state);
    delete legacy.crm.followUps[0].collection!.priorSameInstantAllocations;
    expect(invoiceCollectionStatus(legacy,'i1','2026-10-20').promise).toMatchObject({state:'needsReview',paidSince:0});
    allocate(30);
    expect(status()).toMatchObject({state:'kept',paidSince:30});
    const previous = f.state.allocations.find(a=>a.invoiceId==='i1' && a.amount===50)!;
    f.run({type:'finance.allocation.reverse',payload:{allocationId:previous.id,reason:'原50美元改配其他票'}});
    expect(status()).toMatchObject({state:'kept',paidSince:30});
  });
  it('distinguishes settling a shortfall from paying the promised amount, including after reversal', () => {
    const f = setup();
    f.run({type:'crm.followUp.save',payload:{customerId:'c',method:'call',content:'确认本票分期回款',at:ctx.now,nextDate:'',link:{kind:'invoice',id:'i1'},collection:{level:1,promisedDate:'2026-10-30',promisedAmount:'300'}}});
    f.run({type:'finance.reconcile',payload:{receiptId:f.state.receipts[0].id,lines:[{invoiceId:'i1',amount:299.98}]}});
    f.run({type:'finance.receivable.writeoff',payload:{invoiceId:'i1',kind:'difference',amount:.02,reason:'核对尾差'}});
    const invoice=f.state.invoices.find(i=>i.id==='i1')!;
    expect(invoice.open).toBe(0);
    const promise=()=>invoiceCollectionStatus(f.state,'i1','2026-10-31').promise;
    expect(promise()).toMatchObject({state:'settled',paidSince:299.98});
    f.run({type:'finance.receivable.writeoff.reverse',payload:{invoiceId:'i1',writeoffId:invoice.writeoffs![0].id,reason:'继续收取原差额'}});
    expect(promise()).toMatchObject({state:'broken',paidSince:299.98});
    f.run({type:'finance.reconcile',payload:{receiptId:f.state.receipts[0].id,lines:[{invoiceId:'i1',amount:.02}]}});
    expect(promise()).toMatchObject({state:'kept',paidSince:300});
  });
  it('retains a voided collection in history but disallows using it as a promise or bad debt basis', () => {
    const f = setup();
    const follow=f.run({type:'crm.followUp.save',payload:{customerId:'c',method:'call',content:'催收记录',at:ctx.now,nextDate:'',link:{kind:'invoice',id:'i3'},collection:{level:2,promisedDate:'2026-10-30',promisedAmount:'200'}}});
    f.run({type:'crm.followUp.void',payload:{id:follow.id!,reason:'登记错票'}});
    expect(f.state.crm.followUps.find(r=>r.id===follow.id)?.voided?.reason).toBe('登记错票');
    expect(invoiceCollectionStatus(f.state,'i3','2026-10-31')).toMatchObject({count:0,promise:undefined});
    expect(()=>f.run({type:'finance.receivable.writeoff',payload:{invoiceId:'i3',kind:'badDebt',amount:200,reason:'核查催收依据'}})).toThrow('催收记录');
  });
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
  it('requires a current cash allocation on the same invoice for a red correction', () => {
    const f = setup();
    const receiptId = f.state.receipts[0].id;
    f.run({ type: 'finance.reconcile', payload: { receiptId, lines: [{ invoiceId: 'i1', amount: 100 }, { invoiceId: 'i2', amount: 10 }] } });
    const allocation = f.state.allocations.find(a => a.invoiceId === 'i1')!;
    f.run({ type: 'finance.allocation.reverse', payload: { allocationId: allocation.id, reason: '原分配已取消' } });
    expect(() => f.run({ type: 'finance.receivable.writeoff', payload: { invoiceId: 'i1', kind: 'correction', amount: 5, reason: '单价更正' } })).toThrow('到账核销');
    expect(f.state.invoices.find(i => i.id === 'i1')).toMatchObject({ open: 300 });
    expect(f.state.invoices.find(i => i.id === 'i1')!.writeoffs).toBeUndefined();
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
