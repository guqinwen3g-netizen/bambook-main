import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, mistCommandPermission, type MistCommand, type MistContext, type MistState } from './mistWorkspace';

function fixture() {
  let n = 0; const ctx = (actorId = 'sales'): MistContext => ({ id: () => `os-${++n}`, now: '2026-11-04T02:00:00Z', actorName: actorId === 'reviewer' ? '主管' : '业务', actorId, members: [{ id: 'sales', name: '业务', active: true, groups: ['garment', 'fabric'] }], authority: { supplier: {}, orderReviewerIds: { garment: ['reviewer'], fabric: ['reviewer'] } } } as MistContext);
  let state: MistState = createMistState(ctx(), 'empty');
  state.customers.push({ id: 'c1', name: '客户甲', code: 'C1', country: '', city: '', industry: '', owner: '业务', ownerId: 'sales', grade: '', currency: 'USD', terms: '', incoterm: '', categories: '', creditLimit: 0, since: '' });
  state.files.push({ id: 'po', name: 'po.pdf', mimeType: 'application/pdf', size: 1, storageKey: 'x', createdAt: '2026-11-04T00:00:00Z' });
  const run = (command: { type: string; payload: unknown }, actor = 'sales') => { const r = applyMistCommand(state, command as MistCommand, ctx(actor)); state = r.state; return r.result as any; };
  const order = (lines: Array<{ style: string; qty: number }>, currency = 'USD') => run({ type: 'order.create', payload: { type: 'garment', customerId: 'c1', season: 'AW26', currency, due: '2026-12-01', ownerId: 'sales', governance: { kind: 'external', poNumber: 'PO-1', confirmationFileIds: ['po'], internalPurpose: '', receiver: '', paymentMethod: 'TT', depositPercent: 0, preShipmentPercent: 0, paymentNote: '30 天', incoterm: 'FOB', deliveryPlace: '上海' }, lines: lines.map(l => ({ fulfillmentMode: 'cmt', cmtIncludedItems: [], name: l.style, style: l.style, qty: l.qty, unit: '件', price: 10, img: 'clay' })) } }).id as string;
  const approve = (id: string) => { run({ type: 'order.governance.submit', payload: { orderId: id } }); run({ type: 'order.governance.decide', payload: { id, decision: 'approved', note: '同意' } }, 'reviewer'); };
  return { run, order, approve, get state() { return state; } };
}

describe('ord30 订单拆分与合并', () => {
  it('archives trusted bidirectional line movements without accepting client references or rewriting old events',()=>{
    const f=fixture(),source=f.order([{style:'A',qty:10},{style:'B',qty:20}]);
    const a=f.state.orderLines.find(l=>l.orderId===source&&l.style==='A')!,b=f.state.orderLines.find(l=>l.orderId===source&&l.style==='B')!;
    const legacy={id:'legacy',entityType:'order',entityId:source,actor:'原业务员',at:'2026-11-03T00:00:00Z',text:'旧拆分说明 SO-FAKE',fileIds:[]};f.state.events.push(legacy);
    const target=f.run({type:'order.split',payload:{orderId:source,lines:[{lineId:a.id,qty:4},{lineId:b.id}],reason:'按批次交付',orderFlow:{sourceOrderId:'forged',targetOrderId:'forged'}}}).id;
    const copied=f.state.orderLines.find(l=>l.orderId===target&&l.style==='A')!,moved=f.state.orderLines.find(l=>l.orderId===target&&l.style==='B')!;
    const expected={action:'split',sourceOrderId:source,targetOrderId:target,lines:[{sourceLineId:a.id,targetLineId:copied.id,quantity:4,unit:'件'},{sourceLineId:b.id,targetLineId:b.id,quantity:20,unit:'件'}]};
    expect(copied.id).not.toBe(a.id);expect(moved.id).toBe(b.id);
    const splitEvents=f.state.events.filter(e=>(e as any).orderFlow?.action==='split');expect(splitEvents).toHaveLength(2);for(const e of splitEvents){expect((e as any).orderFlow).toEqual(expected);expect(e.text).toContain('按批次交付');expect(e.text).not.toContain(f.state.orders.find(o=>o.id===source)!.code);expect(e.text).not.toContain(f.state.orders.find(o=>o.id===target)!.code);}
    expect(f.state.events.find(e=>e.id==='legacy')).toEqual(legacy);
    const targetOwner=f.state.orders.find(o=>o.id===target)!.ownerId;f.run({type:'order.merge',payload:{orderId:source,sourceOrderId:target,reason:'恢复统一交付'}});
    const mergeEvents=f.state.events.filter(e=>(e as any).orderFlow?.action==='merge');expect(mergeEvents).toHaveLength(2);for(const e of mergeEvents){const flow=(e as any).orderFlow;expect(flow).toMatchObject({action:'merge',sourceOrderId:target,targetOrderId:source});expect(flow.lines).toHaveLength(2);expect(flow.lines).toEqual(expect.arrayContaining([{sourceLineId:copied.id,targetLineId:copied.id,quantity:4,unit:'件'},{sourceLineId:moved.id,targetLineId:moved.id,quantity:20,unit:'件'}]));}
    const retired=f.state.orders.find(o=>o.id===target)!;expect(retired.governance!.status).toBe('void');expect(retired.governance!.termination!.reason).not.toContain(f.state.orders.find(o=>o.id===source)!.code);expect(retired.ownerId).toBe(targetOwner);expect(f.state.orders.find(o=>o.id===source)!.ownerId).toBe('sales');
  });
  it('按条目和数量拆出新草稿订单，可另定交期；已批准订单回到草稿重新审批', () => {
    const f = fixture(), id = f.order([{ style: 'A', qty: 100 }, { style: 'B', qty: 50 }]);
    expect(mistCommandPermission({ type: 'order.split', payload: {} } as any)).toBe('orders:write');
    f.approve(id);
    const a = f.state.orderLines.find(l => l.orderId === id && l.style === 'A')!, b = f.state.orderLines.find(l => l.orderId === id && l.style === 'B')!;
    expect(() => f.run({ type: 'order.split', payload: { orderId: id, lines: [{ lineId: a.id }, { lineId: b.id }], reason: '分批' } })).toThrow('至少保留');
    expect(() => f.run({ type: 'order.split', payload: { orderId: id, lines: [{ lineId: a.id, qty: 120 }], reason: '分批' } })).toThrow('超过');
    expect(() => f.run({ type: 'order.split', payload: { orderId: id, lines: [{ lineId: a.id, qty: 0.5 }], reason: '分批' } })).toThrow('整数');
    const nid = f.run({ type: 'order.split', payload: { orderId: id, lines: [{ lineId: a.id, qty: 40 }, { lineId: b.id }], due: '2027-01-15', reason: '第二批交期' } }).id;
    const o1 = f.state.orders.find(o => o.id === id)!, o2 = f.state.orders.find(o => o.id === nid)!;
    expect(f.state.orderLines.filter(l => l.orderId === id).map(l => [l.style, l.qty])).toEqual([['A', 60]]);
    expect(f.state.orderLines.filter(l => l.orderId === nid).map(l => [l.style, l.qty]).sort()).toEqual([['A', 40], ['B', 50]]);
    expect(o1.amount).toBe(600); expect(o2.amount).toBe(900); expect(o2.due).toBe('2027-01-15');
    expect((o1 as any).governance.status).toBe('draft'); expect((o2 as any).governance).toMatchObject({ status: 'draft', rounds: [] });
    expect((o2 as any).governance.contract.poNumber).toBe('PO-1');
  });
  it('同客户同类型同币种可合并，来源订单作废并注明去向；有后续业务时不能拆分或合并', () => {
    const f = fixture(), x = f.order([{ style: 'A', qty: 10 }]), y = f.order([{ style: 'C', qty: 20 }]), z = f.order([{ style: 'D', qty: 5 }], 'EUR');
    expect(() => f.run({ type: 'order.merge', payload: { orderId: x, sourceOrderId: z, reason: '合并' } })).toThrow('币种');
    f.run({ type: 'order.merge', payload: { orderId: x, sourceOrderId: y, reason: '同一工厂一起下' } });
    expect(f.state.orderLines.filter(l => l.orderId === x).map(l => l.style).sort()).toEqual(['A', 'C']);
    expect((f.state.orders.find(o => o.id === y) as any).governance).toMatchObject({ status: 'void', termination: { kind: 'void' } });
    expect(f.state.orders.find(o => o.id === x)!.qty).toBe(30);
    f.state.invoices.push({ id: 'i1', code: 'CI-1', orderId: x, order: '', customer: '', due: '2026-12-01', amount: 1, open: 1, currency: 'USD' } as any);
    const line = f.state.orderLines.find(l => l.orderId === x)!;
    expect(() => f.run({ type: 'order.split', payload: { orderId: x, lines: [{ lineId: line.id }], reason: '拆' } })).toThrow('发票');
  });
});
