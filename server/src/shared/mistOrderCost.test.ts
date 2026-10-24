import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, mistCommandPermission, type MistCommand, type MistContext, type MistState } from './mistWorkspace';
import { activeExpenses, orderActualCost, shipmentOrderBases, splitMinor } from './mistOrderCost';

function fixture() {
  let i = 0; const ctx = { id: () => `oc-${++i}`, now: '2026-10-18T02:00:00Z', actorName: '财务李', actorId: 'demo-reviewer' } as unknown as MistContext;
  let state = createMistState(ctx, 'demo') as MistState & Record<string, any>;
  const shipment = state.fulfillment.shipments[0];
  const o17 = state.orders.find(o => o.code === 'SO-G-2026-017')!, o18 = state.orders.find(o => o.code === 'SO-G-2026-018')!;
  // 拼一票：把 018 的一个条目也装进这票出运，并录装箱
  const l18 = state.orderLines.find(l => l.orderId === o18.id)!;
  shipment.lines.push({ lineId: l18.id, orderId: o18.id, quantity: 100, factoryConfirmedAt: '2026-10-10T00:00:00Z' });
  state.fulfillment.packing.push({ id: 'pk-x', shipmentId: shipment.id, lineId: l18.id, carton: '1-10', quantity: 100, netWeight: 90, grossWeight: 100, volume: 1, note: '' });
  state.fxPeriodRates = [{ id: 'fx1', currency: 'USD', month: '2026-10', rate: '7.100000' }];
  const run = (type: string, payload: Record<string, unknown>) => { const r = applyMistCommand(state, { type, payload } as unknown as MistCommand, ctx); state = r.state as typeof state; return r.result as { id: string }; };
  return { run, shipment, o17, o18, get state() { return state; } };
}

describe('订单实际成本与费用分摊', () => {
  it('exposes the actual-basis fallback exchange source and marks the foreign expense estimate without changing money or state',()=>{
    const state=createMistState({id:()=>'',now:'2026-10-08T00:18:00Z',actorName:'财务'},'empty') as MistState & Record<string,any>;
    state.orders.push({id:'free',code:'SO-FREE',customer:'客户',currency:'USD',amount:0} as any);
    state.fxPeriodRates=[{id:'period',currency:'USD',month:'2026-09',rate:'7.1180'}];
    state.orderCosts={expenses:[{id:'freight',code:'FY-1',category:'freight',currency:'USD',amount:65,shares:[{orderId:'free',orderCode:'SO-FREE',basisValue:1,amount:65}],scope:'orders',basis:'equal',vendor:'物流'} as any]};
    const before=structuredClone(state),result=orderActualCost(state,'free','actual','2026-10','2026-10-08');
    expect(result).toMatchObject({revenueCny:0,expenseCny:462.67,marginEx:-462.67,estimated:true,status:'ok'});
    expect(result.expenses[0]).toMatchObject({amount:65,cny:462.67,estimated:true,fx:{rate:7.118,label:'2026-09 月末 7.1180（暂估）',estimated:true}});expect(state).toEqual(before);
  });

  it('keeps an internal budget out of external revenue while retaining its costs',()=>{
    const ctx={id:()=>'',now:'2026-10-24T00:00:00Z',actorName:'Finance'},state=createMistState(ctx,'empty') as MistState & Record<string,any>;
    state.orders.push({id:'internal',code:'INT-1',customer:'Production team',currency:'CNY',amount:500,governance:{contract:{kind:'internal'}}} as any);
    state.orderCosts={expenses:[{id:'expense',code:'EXP-1',category:'trucking',currency:'CNY',amount:50,shares:[{orderId:'internal',orderCode:'INT-1',basisValue:1,amount:50}],scope:'orders',basis:'manual',vendor:'Carrier'} as any]};
    const result=orderActualCost(state,'internal','period','2026-10','2026-10-24');
    expect(result.revenue).toEqual([]);expect(result.revenueCny).toBe(0);expect(result.expenseCny).toBe(50);expect(result.marginEx).toBe(-50);expect(result.rateIn).toBeNull();
  });
  it('费用转应付票据：按票付款，不重复计成本；已转的费用须先作废票据', () => {
    const f = fixture();
    const supplier = f.state.market.suppliers[0];
    const { id } = f.run('cost.expense.register', { category: 'freight', vendor: '某货代', ref: 'FW-881', date: '2026-10-15', currency: 'USD', amount: 1000, scope: 'shipment', shipmentId: f.shipment.id, basis: 'volume' });
    const before = orderActualCost(f.state, f.o17.id, 'period', '2026-10', '2026-10-18').purchaseCny;
    expect(() => f.run('cost.expense.payable', { id, supplierId: 'nope', due: '2026-11-15' })).toThrow('已建档的供应商');
    expect(() => f.run('cost.expense.payable', { id, supplierId: supplier.id, due: '2026-10-01' })).toThrow('早于费用日期');
    const bill = f.run('cost.expense.payable', { id, supplierId: supplier.id, due: '2026-11-15', taxAmount: '60' });
    const row = f.state.payables.bills.find((b: any) => b.id === bill.id);
    expect(row).toMatchObject({ supplierId: supplier.id, invoiceNo: 'FW-881', invoiceDate: '2026-10-15', currency: 'USD', amount: 1000, taxAmount: 60, lines: [], expenseId: id, state: 'open' });
    expect(orderActualCost(f.state, f.o17.id, 'period', '2026-10', '2026-10-18').purchaseCny).toBe(before);
    expect(() => f.run('cost.expense.payable', { id, supplierId: supplier.id, due: '2026-11-15' })).toThrow('已转应付票据');
    expect(() => f.run('cost.expense.void', { id, reason: '重开' })).toThrow('请先在应付待办作废');
    f.run('payable.bill.void', { id: bill.id, reason: '货代重开发票' });
    f.run('cost.expense.void', { id, reason: '货代重开发票' });
    expect(activeExpenses(f.state).some(x => x.id === id)).toBe(false);
  });
  it('最大余数法分摊到分，合计不差一分', () => {
    expect(splitMinor(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitMinor(1001, [2, 1]).reduce((a, b) => a + b, 0)).toBe(1001);
    expect(() => splitMinor(100, [0, 0])).toThrow('合计为 0');
  });
  it('按出运体积分摊海运费，并冻结每单金额；作废保留记录', () => {
    expect(mistCommandPermission({ type: 'cost.expense.register', payload: {} } as unknown as MistCommand)).toBe('invoices:write');
    const f = fixture();
    const bases = shipmentOrderBases(f.state, f.shipment.id).rows;
    const v17 = bases.find(b => b.orderId === f.o17.id)!.volume, v18 = bases.find(b => b.orderId === f.o18.id)!.volume;
    expect(v18).toBe(1); expect(v17).toBeGreaterThan(0);
    const { id } = f.run('cost.expense.register', { category: 'freight', vendor: '某货代', date: '2026-10-15', currency: 'USD', amount: 1000, scope: 'shipment', shipmentId: f.shipment.id, basis: 'volume' });
    const e = activeExpenses(f.state).find(x => x.id === id)!;
    expect(e.code).toBe('FY-2026-0001');
    expect(e.shares.reduce((n, s) => n + Math.round(s.amount * 100), 0)).toBe(100000);
    expect(e.shares.find(s => s.orderId === f.o18.id)!.amount).toBeCloseTo(1000 * v18 / (v17 + v18), 1);
    // 装箱变化不改历史
    f.state.fulfillment.packing.find(p => p.id === 'pk-x')!.volume = 50;
    expect(activeExpenses(f.state).find(x => x.id === id)!.shares).toEqual(e.shares);
    expect(() => f.run('cost.expense.void', { id, reason: '' })).toThrow('作废原因');
    f.run('cost.expense.void', { id, reason: '货代重开发票' });
    expect(activeExpenses(f.state)).toHaveLength(0);
    expect(() => f.run('cost.expense.void', { id, reason: '再次' })).toThrow('已作废');
  });
  it('校验：日期、金额、口径与币种；手工分摊须等于总额', () => {
    const f = fixture(), base = { category: 'commission', date: '2026-10-15', currency: 'USD', amount: 300, scope: 'orders', orderIds: [f.o17.id, f.o18.id] };
    expect(() => f.run('cost.expense.register', { ...base, basis: 'volume' })).toThrow('不能按体积');
    expect(() => f.run('cost.expense.register', { ...base, basis: 'value', date: '2026-10-19' })).toThrow('不能晚于今天');
    expect(() => f.run('cost.expense.register', { ...base, basis: 'value', amount: 0 })).toThrow('大于 0');
    expect(() => f.run('cost.expense.register', { ...base, basis: 'manual', manual: [{ orderId: f.o17.id, amount: 100 }] })).toThrow('不一致');
    const eur = f.state.orders.find(o => o.currency === 'EUR')!;
    expect(() => f.run('cost.expense.register', { ...base, orderIds: [f.o17.id, eur.id], basis: 'value' })).toThrow('币种不同');
    const { id } = f.run('cost.expense.register', { ...base, basis: 'manual', manual: [{ orderId: f.o17.id, amount: 100 }, { orderId: f.o18.id, amount: 200 }] });
    expect(activeExpenses(f.state).find(x => x.id === id)!.shares.map(s => s.amount)).toEqual([100, 200]);
  });
  it('订单实际核算：发票收入、已到票采购 + 暂估、分摊费用、退税；缺汇率不出结果', () => {
    const f = fixture();
    f.run('cost.expense.register', { category: 'freight', date: '2026-10-15', currency: 'USD', amount: 1000, scope: 'shipment', shipmentId: f.shipment.id, basis: 'volume' });
    f.run('cost.expense.register', { category: 'bank', date: '2026-10-15', currency: 'CNY', amount: 50, scope: 'orders', orderIds: [f.o17.id], basis: 'equal' });
    const r = orderActualCost(f.state, f.o17.id, 'period', '2026-10', '2026-10-18');
    expect(r.status).toBe('ok');
    expect(r.expenses).toHaveLength(2);
    expect(r.purchases.length).toBeGreaterThan(0);
    const sumCny = (rows: { cny: number | null }[]) => Math.round(rows.reduce((n, x) => n + x.cny! * 100, 0)) / 100;
    expect(r.revenueCny).toBeCloseTo(sumCny(r.revenue), 2);
    expect(r.marginEx).toBeCloseTo(r.revenueCny! - r.purchaseCny! - r.expenseCny!, 1);
    expect(r.marginIn).toBeCloseTo(r.marginEx! + r.rebate.used, 1);
    const bank = r.expenses.find(x => x.currency === 'CNY')!;
    expect(bank).toMatchObject({ amount: 50, cny: 50 });
    f.state.fxPeriodRates = [];
    const n = orderActualCost(f.state, f.o17.id, 'period', '2026-10', '2026-10-18');
    expect(n).toMatchObject({ status: 'norate', marginEx: null, missing: ['USD'] });
  });
});
