import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, mistReceiptSettledMinor, type MistCommand, type MistContext, type MistState } from './mistWorkspace';
import { fxOrderActual, fxRateFor, fxUnallocatedSettlements } from './mistFxRates';

function setup() {
  let n = 0; const ctx: MistContext = { id: () => `sl-${++n}`, now: '2026-10-17T04:00:00Z', actorName: '林舒', actorId: 'demo-finance' };
  let s: MistState = createMistState(ctx, 'empty');
  const run = (command: MistCommand) => { const out = applyMistCommand(s, command, ctx); s = out.state; return out.result as { id: string }; };
  run({ type: 'finance.account.save', payload: { name: '美元户', bankName: '中行', accountNo: '1111', currency: 'USD', openingDate: '2026-01-01', openingBalance: 0 } } as MistCommand);
  run({ type: 'finance.account.save', payload: { name: '人民币户', bankName: '中行', accountNo: '2222', currency: 'CNY', openingDate: '2026-01-01', openingBalance: 0 } } as MistCommand);
  run({ type: 'finance.account.save', payload: { name: '美元二户', bankName: '工行', accountNo: '3333', currency: 'USD', openingDate: '2026-01-01', openingBalance: 0 } } as MistCommand);
  const [usd, cny, usd2] = s.bankAccounts!;
  run({ type: 'finance.importReceipts', payload: { accountId: usd.id, receipts: [{ date: '2026-10-05', payer: 'Nordic', amount: 6000, currency: 'USD', ref: 'TT-1' }, { date: '2026-10-08', payer: 'Nordic', amount: 1000, currency: 'USD', ref: 'TT-2' }] } });
  run({ type: 'finance.importReceipts', payload: { accountId: usd2.id, receipts: [{ date: '2026-10-05', payer: 'Other', amount: 500, currency: 'USD', ref: 'TT-3' }] } });
  const [r1, r2] = s.receipts.filter(r => r.accountId === usd.id).sort((a, b) => a.date.localeCompare(b.date)), r3 = s.receipts.find(r => r.accountId === usd2.id)!;
  return { get s() { return s; }, run, usd, cny, r1, r2, r3 };
}
const settle = (f: ReturnType<typeof setup>, extra: Record<string, unknown>) => f.run({ type: 'finance.fx.settle', payload: { date: '2026-10-10', fromAccountId: f.usd.id, toAccountId: f.cny.id, amount: 6000, localAmount: 42600, ref: 'BK-1', ...extra } } as MistCommand);

describe('结汇对应到账（§17.6 Q3）', () => {
  it('登记结汇时可分配到卖出账户的到账；校验账户、日期、未结汇余额与合计；冲回即释放', () => {
    const f = setup();
    expect(() => settle(f, { receipts: [{ receiptId: f.r3.id, amount: 100 }] })).toThrow('未归属卖出账户');
    expect(() => settle(f, { date: '2026-10-06', receipts: [{ receiptId: f.r2.id, amount: 100 }] })).toThrow('晚于结汇日期');
    expect(() => settle(f, { receipts: [{ receiptId: f.r1.id, amount: 6000.01 }] })).toThrow('未结汇余额');
    expect(() => settle(f, { amount: 500, localAmount: 3550, receipts: [{ receiptId: f.r1.id, amount: 600 }] })).toThrow('合计超过');
    expect(() => settle(f, { receipts: [{ receiptId: f.r1.id, amount: 100 }, { receiptId: f.r1.id, amount: 100 }] })).toThrow('重复');
    const id = settle(f, { receipts: [{ receiptId: f.r1.id, amount: 5000 }] }).id;
    expect(f.s.fxRecords!.find(r => r.id === id)!.receipts).toEqual([{ receiptId: f.r1.id, amount: 5000 }]);
    expect(f.s.events[0].text).toContain('对应到账 ' + f.r1.code);
    expect(mistReceiptSettledMinor(f.s, f.r1.id)).toBe(500000);
    expect(fxUnallocatedSettlements(f.s, '2026-10-17')).toEqual([{ currency: 'USD', count: 1, amount: 1000 }]);
    // 补登：只追加，合计不超过卖出金额；同一到账合并
    expect(() => f.run({ type: 'finance.fx.allocate', payload: { id, receipts: [{ receiptId: f.r1.id, amount: 1000.01 }] } })).toThrow('未结汇余额');
    expect(() => f.run({ type: 'finance.fx.allocate', payload: { id, receipts: [{ receiptId: f.r1.id, amount: 1000 }, { receiptId: f.r2.id, amount: 1 }] } })).toThrow('合计超过');
    f.run({ type: 'finance.fx.allocate', payload: { id, receipts: [{ receiptId: f.r1.id, amount: 1000 }] } });
    expect(f.s.fxRecords!.find(r => r.id === id)!.receipts).toEqual([{ receiptId: f.r1.id, amount: 6000 }]);
    expect(fxUnallocatedSettlements(f.s, '2026-10-17')).toEqual([]);
    expect(() => f.run({ type: 'finance.account.assign', payload: { kind: 'receipt', id: f.r1.id, accountId: null, reason: '归错' } })).toThrow('已有结汇分配');
    f.run({ type: 'finance.fx.reverse', payload: { id, reason: '水单录错' } });
    expect(mistReceiptSettledMinor(f.s, f.r1.id)).toBe(0);
    expect(() => f.run({ type: 'finance.fx.allocate', payload: { id, receipts: [{ receiptId: f.r1.id, amount: 1 }] } })).toThrow('未冲回');
  });

  it('订单实际口径：已收已结汇按结汇实际汇率，已收未结汇与未收按月末汇率暂估；缺月末汇率不出数', () => {
    const f = setup(), s = f.s as MistState & { fxPeriodRates?: unknown[] };
    s.orders.push({ id: 'o1', code: 'SO-1', customer: 'Nordic', currency: 'USD', amount: 10000 } as any);
    s.invoices.push({ id: 'i1', code: 'INV-1', orderId: 'o1', order: 'SO-1', customer: 'Nordic', due: '2026-11-01', amount: 10000, open: 4000, currency: 'USD' } as any);
    s.allocations = [{ id: 'a1', receiptId: f.r1.id, invoiceId: 'i1', amount: 6000, currency: 'USD', createdAt: '', actor: '' }];
    const order = s.orders.find(o => o.id === 'o1')!;
    // 未结汇且无月末汇率：不出数
    expect(fxOrderActual(s, order, '2026-10', '2026-10-17')).toBeUndefined();
    s.fxPeriodRates = [{ id: 'p', code: 'FXM-1', month: '2026-09', currency: 'USD', rate: '7.05', source: '人行中间价', createdAt: '', actor: '' }];
    // 到账只结了一半：核销到本单的 6,000 按到账已结汇比例拆分
    settle(f, { amount: 3000, localAmount: 21300, receipts: [{ receiptId: f.r1.id, amount: 3000 }] });
    let a = fxOrderActual(f.s as any, order, '2026-10', '2026-10-17')!;
    expect(a).toMatchObject({ settledMinor: 300000, settledCnyMinor: 2130000, estimatedMinor: 700000, estimated: true, settledRate: '7.1000', period: { month: '2026-09', rate: '7.05' } });
    expect(a.cnyMinor).toBe(2130000 + 4935000);
    // 补结剩余 3,000 @7.2：已收 6,000 全部按实际（7.10 / 7.20 加权），未收 4,000 暂估 7.05
    f.run({ type: 'finance.fx.settle', payload: { date: '2026-10-12', fromAccountId: f.usd.id, toAccountId: f.cny.id, amount: 3000, localAmount: 21600, ref: 'BK-2', receipts: [{ receiptId: f.r1.id, amount: 3000 }] } } as MistCommand);
    a = fxOrderActual(f.s as any, order, '2026-10', '2026-10-17')!;
    expect(a).toMatchObject({ settledMinor: 600000, settledCnyMinor: 4290000, estimatedMinor: 400000, estimated: true });
    expect(a.cnyMinor).toBe(4290000 + 2820000);
    expect(a.label).toContain('暂估 4000.00 @7.05');
    // 截至结汇之前：全部暂估
    expect(fxOrderActual(f.s as any, order, '2026-10', '2026-10-09')).toMatchObject({ settledMinor: 0, estimatedMinor: 1000000 });
    // 非订单收入的外币（如外币采购）在实际口径下按月末汇率暂估
    expect(fxRateFor(f.s as any, 'USD', 'actual', { month: '2026-10', asOf: '2026-10-17' })).toMatchObject({ rate: 7.05, estimated: true });
  });
});

describe('订单核算 · 实际结汇口径', () => {
  it('收入拆为“已收已结汇”与“未结汇 / 未收（暂估）”两行', async () => {
    const { orderActualCost } = await import('./mistOrderCost');
    const f = setup(), s = f.s as any;
    s.orders.push({ id: 'o1', code: 'SO-1', customer: 'Nordic', currency: 'USD', amount: 10000 });
    s.invoices.push({ id: 'i1', code: 'INV-1', orderId: 'o1', order: 'SO-1', customer: 'Nordic', due: '2026-11-01', amount: 10000, open: 4000, currency: 'USD' });
    s.allocations = [{ id: 'a1', receiptId: f.r1.id, invoiceId: 'i1', amount: 6000, currency: 'USD', createdAt: '', actor: '' }];
    s.fxPeriodRates = [{ id: 'p', code: 'FXM-1', month: '2026-09', currency: 'USD', rate: '7.05', source: '人行中间价', createdAt: '', actor: '' }];
    settle(f, { receipts: [{ receiptId: f.r1.id, amount: 6000 }] });
    const cost = orderActualCost(f.s, 'o1', 'actual', '2026-10', '2026-10-17');
    expect(cost.revenue.map(l => [l.key, l.amount, l.cny, !!l.estimated])).toEqual([['rev:settled', 6000, 42600, false], ['rev:unsettled', 4000, 28200, true]]);
    expect(cost).toMatchObject({ revenueCny: 70800, estimated: true, status: 'ok' });
    (f.s as any).fxPeriodRates = [];
    expect(orderActualCost(f.s, 'o1', 'actual', '2026-10', '2026-10-17')).toMatchObject({ status: 'norate', revenueCny: null, missing: ['USD'] });
  });
});

 it('rejects a second active settlement for the same dated bank slip and debit account, even with different amounts or receipt links',()=>{
  const f=setup();settle(f,{amount:1000,localAmount:7100,receipts:[{receiptId:f.r1.id,amount:1000}]});const before=JSON.stringify(f.s);
  expect(()=>settle(f,{amount:500,localAmount:3550,receipts:[{receiptId:f.r2.id,amount:500}]})).toThrow('该银行水单已登记结汇');expect(JSON.stringify(f.s)).toBe(before);
 });
 it('retains the reversed original while allowing a corrected bank slip, and scopes daily slip numbers to the debit account and date',()=>{
  const f=setup();const first=settle(f,{amount:1000,localAmount:7100});f.run({type:'finance.fx.reverse',payload:{id:first.id,reason:'水单金额录入错误'}});settle(f,{amount:2000,localAmount:14240});expect(f.s.fxRecords!.find(r=>r.id===first.id)?.reversed?.reason).toBe('水单金额录入错误');
  expect(()=>settle(f,{date:'2026-10-11',amount:1000,localAmount:7100})).not.toThrow();expect(()=>settle(f,{fromAccountId:f.r3.accountId,amount:100,localAmount:710})).not.toThrow();
 });
