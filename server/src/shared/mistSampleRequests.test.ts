import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, mistCommandPermission, type MistCommand, type MistContext, type MistState } from './mistWorkspace';
import { readSampleRequests } from './mistSampleRequests';
import { orderFundingReconciliationLimit } from './mistOrderFunding';

function fixture() {
  let n = 0; const ctx: MistContext = { id: () => `sr-${++n}`, now: '2026-11-04T02:00:00Z', actorName: '业务-王', actorId: 'sales', members: [{ id: 'sales', name: '业务-王', active: true, groups: ['fabric', 'garment'] }] } as MistContext;
  let state: MistState = createMistState(ctx, 'empty');
  state.customers.push({ id: 'c1', name: 'Nordic Wear AB', code: 'C1', country: 'SE', city: '', industry: '', owner: '业务-王', ownerId: 'sales', grade: '', currency: 'USD', terms: '', incoterm: '', categories: '', creditLimit: 0, since: '' });
  state.files.push({ id: 'inv-file', name: 'inv.pdf', mimeType: 'application/pdf', size: 1, storageKey: 'x', createdAt: ctx.now });
  const run = (command: { type: string; payload: unknown }, actor: Partial<MistContext> = {}) => { const r = applyMistCommand(state, command as MistCommand, { ...ctx, ...actor }); state = r.state; return r.result as any; };
  const sampleId = run({ type: 'fulfillment.samples.create', payload: { name: '羊毛双面呢', category: '面料', form: '剪样', quantity: 5, unit: '份', location: 'A1', size: '', color: 'Navy', source: { kind: 'manual', description: '库存样' }, fileIds: [], note: '' } }).id;
  return { run, sampleId, get state() { return state; } };
}
const request = (over: Record<string, unknown> = {}) => ({ type: 'sample.request.save', payload: { customerId: 'c1', description: '羊毛双面呢 Navy 剪样', quantity: 2, unit: '份', recipient: 'Anna Berg', address: 'Stockholm', neededBy: '2026-11-10', feeAmount: 30, feeCurrency: 'usd', ...over } });

describe('ord19 客户索样申请 / ord18 样品费', () => {
  it('提单进样品间待办，据单从库存寄出并扣减，寄完自动完成并提醒开样品费', () => {
    const f = fixture();
    expect(mistCommandPermission({ type: 'sample.request.save', payload: {} } as any)).toBe('products:write');
    expect(mistCommandPermission({ type: 'sample.request.invoice', payload: {} } as any)).toBe('invoices:write');
    expect(() => f.run(request({ quantity: 1.5 }))).toThrow('整数');
    const id = f.run(request()).id;
    const r = () => readSampleRequests(f.state).find(x => x.id === id)!;
    expect(r()).toMatchObject({ code: 'SR-2026-0001', state: 'open', fee: { amount: 30, currency: 'USD' } });
    expect(f.state.tasks.find(t => t.kind === 'sample-request:' + id)).toMatchObject({ done: false, assigneeIds: ['sales'], target: { view: 'samples', section: 'requests' } });
    expect(() => f.run({ type: 'sample.request.invoice', payload: { id, number: 'SF-1', due: '2026-12-01', fileIds: ['inv-file'] } })).toThrow('寄出后');
    f.run({ type: 'sample.request.fulfill', payload: { id, sampleId: f.sampleId, quantity: 1, carrier: 'DHL', trackingNo: '123', complete: false } }, { actorName: '样品间-李', actorId: 'room' });
    expect(r().state).toBe('open');
    f.run({ type: 'sample.request.fulfill', payload: { id, sampleId: f.sampleId, quantity: 1, complete: false } }, { actorName: '样品间-李', actorId: 'room' });
    expect(r()).toMatchObject({ state: 'sent', shipments: [{ quantity: 1, carrier: 'DHL', trackingNo: '123' }, { quantity: 1 }] });
    expect(f.state.fulfillment.samples.find(s => s.id === f.sampleId)!.available).toBe(3);
    expect(f.state.fulfillment.sampleMovements.filter(m => m.kind === 'send').map(m => m.person)).toEqual(['Anna Berg', 'Anna Berg']);
    expect(f.state.tasks.find(t => t.kind === 'sample-request:' + id)!.done).toBe(true);
    expect(f.state.tasks.find(t => t.kind === 'sample-request-fee:' + id)).toMatchObject({ done: false, assigneeIds: ['sales'] });
    expect(() => f.run({ type: 'sample.request.cancel', payload: { id, reason: '客户取消' } })).toThrow('已寄出');
  });
  it('样品费开票进待财务确认的无订单应收，可核销；财务驳回后可重开', () => {
    const f = fixture(), id = f.run(request()).id;
    f.run({ type: 'sample.request.fulfill', payload: { id, sampleId: f.sampleId, quantity: 2, complete: true } });
    expect(() => f.run({ type: 'sample.request.invoice', payload: { id, number: 'SF-1', due: '2026-12-01', fileIds: [] } })).toThrow('发票原件');
    const invoiceId = f.run({ type: 'sample.request.invoice', payload: { id, number: 'SF-1', due: '2026-12-01', fileIds: ['inv-file'] } }).invoiceId;
    expect(f.state.invoices.find(i => i.id === invoiceId)).toMatchObject({ orderId: '', customerId: 'c1', amount: 30, currency: 'USD', financeStatus: 'pending', sampleRequestId: id });
    expect(() => f.run({ type: 'sample.request.invoice', payload: { id, number: 'SF-2', due: '2026-12-01', fileIds: ['inv-file'] } })).toThrow('已开票');
    f.run({ type: 'finance.receivable.reject', payload: { invoiceId, reason: '金额与约定不符' } }, { actorName: '财务-林', actorId: 'fin' });
    expect(readSampleRequests(f.state)[0].fee!.invoiceId).toBeUndefined();
    const again = f.run({ type: 'sample.request.invoice', payload: { id, number: 'SF-2', due: '2026-12-01', fileIds: ['inv-file'] } }).invoiceId;
    f.run({ type: 'finance.receivable.confirm', payload: { invoiceId: again } }, { actorName: '财务-林', actorId: 'fin' });
    expect(f.state.invoices.find(i => i.id === again)!.open).toBe(30);
    f.state.receipts.push({ id: 'r1', code: 'RCV-1', date: '2026-11-04', payer: 'Nordic Wear AB', amount: 30, remaining: 30, currency: 'USD', ref: '', state: 'unmatched' } as any);
    expect(orderFundingReconciliationLimit(f.state as any, 'r1', again)).toBe(30);
  });
  it('未寄出前可修改或取消；订单须属于该客户', () => {
    const f = fixture(), id = f.run(request({ feeAmount: undefined })).id;
    expect(readSampleRequests(f.state)[0].fee).toBeUndefined();
    expect(() => f.run(request({ orderId: 'missing' }))).toThrow('订单不存在');
    f.run(request({ id, quantity: 3 }));
    expect(readSampleRequests(f.state)[0]).toMatchObject({ quantity: 3, code: 'SR-2026-0001' });
    f.run({ type: 'sample.request.cancel', payload: { id, reason: '客户改为看实物' } });
    expect(readSampleRequests(f.state)[0]).toMatchObject({ state: 'cancelled', cancelled: { reason: '客户改为看实物' } });
    expect(f.state.tasks.find(t => t.kind === 'sample-request:' + id)!.done).toBe(true);
  });
});
