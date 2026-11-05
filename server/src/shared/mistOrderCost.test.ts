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
    expect(result).toMatchObject({revenueCny:0,expenseCny:462.67,marginEx:null,estimated:true,status:'nocost'});
    expect(result.expenses[0]).toMatchObject({amount:65,cny:462.67,estimated:true,fx:{rate:7.118,label:'2026-09 月末 7.1180（暂估）',estimated:true}});expect(state).toEqual(before);
  });

  it('does not report a margin for an external order without an approved purchase (fin37)', () => {
    const f = fixture(), s = structuredClone(f.state) as MistState & Record<string, any>;
    const o = s.orders.find(x => x.code === 'SO-G-2026-015')!, mine = s.fulfillment.purchases.filter(p => p.orderId === o.id);
    expect(mine.map(p => p.state).sort()).toEqual(['approved', 'draft']);
    expect(orderActualCost(s, o.id, 'period', '2026-10', '2026-10-18')).toMatchObject({ status: 'ok', pendingPurchases: 1 });
    for (const p of mine) p.state = 'pending';
    const r = orderActualCost(s, o.id, 'period', '2026-10', '2026-10-18');
    expect(r).toMatchObject({ status: 'nocost', marginEx: null, marginIn: null, purchaseCny: 0, pendingPurchases: 2 });
    expect(r.revenueCny).toBeGreaterThan(0);
  });

  it('keeps an internal budget out of external revenue while retaining its costs',()=>{
    const ctx={id:()=>'',now:'2026-10-24T00:00:00Z',actorName:'Finance'},state=createMistState(ctx,'empty') as MistState & Record<string,any>;
    state.orders.push({id:'internal',code:'INT-1',customer:'Production team',currency:'CNY',amount:500,governance:{contract:{kind:'internal'}}} as any);
    state.orderCosts={expenses:[{id:'expense',code:'EXP-1',category:'trucking',currency:'CNY',amount:50,shares:[{orderId:'internal',orderCode:'INT-1',basisValue:1,amount:50}],scope:'orders',basis:'manual',vendor:'Carrier'} as any]};
    const result=orderActualCost(state,'internal','period','2026-10','2026-10-24');
    expect(result.revenue).toEqual([]);expect(result.revenueCny).toBe(0);expect(result.expenseCny).toBe(50);expect(result.rateIn).toBeNull();
    // An internal budget has no sale: no margin and no export rebate, only its actual cost.
    expect(result).toMatchObject({internal:true,costCny:50,marginEx:null,marginIn:null,rebate:{expected:0,approved:0,received:0,used:0}});
  });
  it('does not attribute an export rebate to an internal order even when its purchase bill is in a rebate claim',()=>{
    const ctx={id:()=>'',now:'2026-10-24T00:00:00Z',actorName:'Finance'},state=createMistState(ctx,'empty') as MistState & Record<string,any>;
    state.orders.push({id:'internal',code:'INT-1',customer:'Production team',currency:'CNY',amount:500,governance:{contract:{kind:'internal'}}} as any);
    state.fulfillment.purchases.push({id:'po',orderId:'internal',currency:'CNY',amount:100} as any);
    state.payables={...(state.payables||{}),bills:[{id:'bill',amount:100,currency:'CNY',lines:[{purchaseId:'po',amount:100}]}]} as any;
    state.exportRebate={claims:[{id:'claim',state:'filed',expected:13,lines:[{billId:'bill',rebate:13}]}]} as any;
    const result=orderActualCost(state,'internal','period','2026-10','2026-10-24');
    expect(result.rebate.used).toBe(0);expect(result.marginIn).toBeNull();
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
  it('费用已部分付款时须先冲回付款、撤回申请、作废票据，才可作废费用', () => {
    const f = fixture(), supplier = f.state.market.suppliers[0];
    const expense = f.run('cost.expense.register', { category: 'freight', vendor: '模拟货代', ref: 'EXP-PARTIAL', date: '2026-10-15', currency: 'CNY', amount: 1000.01, scope: 'orders', orderIds: [f.o17.id], basis: 'equal' });
    const bill = f.run('cost.expense.payable', { id: expense.id, supplierId: supplier.id, due: '2026-11-15' });
    let s: MistState = f.state, n = 0;
    const run = (type: string, payload: Record<string, unknown>, actor = 'finance') => {
      const r = applyMistCommand(s, { type, payload } as MistCommand, { id: () => `expense-payment-${++n}`, now: '2026-10-18T02:00:00Z', actorId: actor, actorName: actor, authority: { supplier: {}, paymentTierReviewerIds: { pay_lt5: ['manager'], pay_gt5: ['manager'], pay_new_supplier: ['director'] } } } as MistContext);
      s = r.state; return r.result;
    };
    const request = run('payable.request.submit', { purpose: 'bill', supplierId: supplier.id, currency: 'CNY', lines: [{ billId: bill.id, amount: 600.01 }], reason: '按票分期付款' }, 'buyer');
    run('payable.request.decide', { id: request.id, decision: 'approved', note: '核对一致' }, 'manager');
    if (s.payables!.requests!.find(r => r.id === request.id)!.state === 'pending') run('payable.request.decide', { id: request.id, decision: 'approved', note: '首笔加签' }, 'director');
    const paid = run('payable.payment.register', { requestId: request.id, date: '2026-10-18', amount: 600.01, reference: 'EXP-BANK', allocations: [{ billId: bill.id, amount: 600.01 }] });
    const before = structuredClone(s);
    expect(() => run('cost.expense.void', { id: expense.id, reason: '更正' })).toThrow('请先在应付待办作废');
    expect(() => run('payable.bill.void', { id: bill.id, reason: '更正' })).toThrow('先冲回');
    expect(s).toEqual(before);
    run('payable.payment.reverse', { supplierPaymentId: paid.id, reason: '银行退回' });
    expect(() => run('payable.bill.void', { id: bill.id, reason: '更正' })).toThrow('先撤回申请');
    run('payable.request.cancel', { id: request.id, reason: '重新登记费用' }, 'buyer');
    run('payable.bill.void', { id: bill.id, reason: '更正' });
    run('cost.expense.void', { id: expense.id, reason: '更正' });
    expect(activeExpenses(s).some(e => e.id === expense.id)).toBe(false);
    expect(() => run('cost.expense.payable', { id: expense.id, supplierId: supplier.id, due: '2026-11-15' })).toThrow('已作废');
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
  it('短交结案后按已确认结算计采购成本，不再暂估未交部分；未最终结算的采购照旧暂估', () => {
    const build = (final: boolean) => {
      const state = createMistState({ id: () => '', now: '2026-10-24T00:00:00Z', actorName: '财务' }, 'empty') as MistState & Record<string, any>;
      state.orders.push({ id: 'o', code: 'SO-SHORT', customer: '客户', currency: 'CNY', amount: 2000 } as any);
      state.invoices.push({ id: 'i', code: 'CI-SHORT', orderId: 'o', order: 'SO-SHORT', customer: '客户', due: '2026-12-01', amount: 2000, open: 2000, currency: 'CNY', financeStatus: 'confirmed' } as any);
      // 合同 100 件 × 10 = 1000；实收 80 件已结算 800 并到票，供应商不再补交 20 件。
      state.fulfillment.purchases.push({ id: 'po', code: 'PO-SHORT', orderId: 'o', supplier: '面料厂', state: 'approved', quantity: 100, price: 10, currency: 'CNY', kind: 'material', domain: 'garment' } as any);
      state.payables = { ...(state.payables || {}), bills: [{ id: 'b', state: 'open', amount: 800, currency: 'CNY', lines: [{ purchaseId: 'po', amount: 800 }] }], deductions: [{ id: 'd', billId: 'b', amount: 50 }],
        settlements: [{ id: 's1', purchaseId: 'po', state: 'confirmed', amount: 800, final: false }, ...(final ? [{ id: 's2', purchaseId: 'po', state: 'confirmed', amount: 0, final: true }] : [])] } as any;
      return orderActualCost(state, 'o', 'period', '2026-10', '2026-10-24');
    };
    const closed = build(true);
    expect(closed.purchases.some(l => l.key === 'est:po')).toBe(false);
    expect(closed).toMatchObject({ status: 'ok', purchaseCny: 750, marginEx: 1250, estimated: false });
    const open = build(false);
    expect(open.purchases.find(l => l.key === 'est:po')).toMatchObject({ amount: 200, estimated: true });
    expect(open).toMatchObject({ purchaseCny: 950, marginEx: 1050, estimated: true });
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
