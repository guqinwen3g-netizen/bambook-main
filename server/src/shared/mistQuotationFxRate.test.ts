import { describe, expect, it } from 'vitest';
import { createMistState, type MistContext, type MistState } from './mistWorkspace';
import { applyMarketCommand, createMarketState, type MarketCommand, type MarketState } from './mistMarket';
import { fxQuoteRateFor, fxRateFor } from './mistFxRates';

const setup = () => { let n = 0; const ctx: MistContext = { id: () => `qfx-${++n}`, now: '2026-10-13T08:00:00.000Z', actorName: '业务员', actorId: 'sales', authority: { supplier: {}, businessReviewerId: 'leader' } }; const s = createMistState(ctx) as MistState & { market: MarketState }; s.market = createMarketState(ctx, s); return { ctx, s }; };
const run = (s: MistState, c: MarketCommand, ctx: MistContext) => applyMarketCommand(s, c, ctx);
let sku = 0;
function quote(s: MistState & { market: MarketState }, ctx: MistContext, extra: Record<string, unknown>, price = '2.50') {
  const p = run(s, { type: 'market.product.save', payload: { input: { sku: 'P-FX-' + (++sku), name: '面料', category: 'fabric', season: 'AW26', supplierId: '', supplierCode: '', composition: '棉', specification: '150cm', color: '蓝', unit: '米', cost: '1.00', currency: 'USD', sourceDevId: '', sourceVersionId: '' } } } as MarketCommand, ctx).id!;
  const lines = [{ productId: p, sourceDevId: '', sourceVersionId: '', name: '面料', style: 'P-FX-' + price, specification: '150cm', qty: '100', unit: '米', price, cost: '1.00' }];
  return run(s, { type: 'market.quotation.save', payload: { input: { customerId: s.customers[0].id, currency: 'USD', season: 'AW26', validUntil: '2026-11-01', deliveryTerms: 'FOB', paymentTerms: 'T/T', lines, ...extra } } } as MarketCommand, ctx).id!;
}
const accept = (s: MistState & { market: MarketState }, ctx: MistContext, id: string) => {
  run(s, { type: 'market.quotation.submit', payload: { id } }, ctx); if (s.market.quotations.find(q => q.id === id)!.approval?.status === 'pending') run(s, { type: 'market.quotation.decide', payload: { id, decision: 'approved', note: 'ok' } }, { ...ctx, actorId: 'leader' });
  run(s, { type: 'market.quotation.status', payload: { id, status: 'Sent', evidence: '交付' } }, ctx); run(s, { type: 'market.quotation.status', payload: { id, status: 'Accepted', evidence: '接受' } }, ctx);
};

describe('报价汇率冻结在报价版本（§17.6 Q2）', () => {
  it('外币报价可填报价汇率并校验格式；人民币报价不记；新版本另记，不改旧版本', () => {
    const { ctx, s } = setup();
    expect(() => quote(s, ctx, { fxRate: '7.1234567' })).toThrow('报价汇率');
    expect(() => quote(s, ctx, { fxRate: '0' })).toThrow('报价汇率');
    const id = quote(s, ctx, { fxRate: ' 7.10 ' }), q = () => s.market.quotations.find(x => x.id === id)!;
    expect(q().fxRate).toBe('7.10');
    accept(s, ctx, id);
    const v2 = quote(s, ctx, { fxRate: '7.05', previousId: id });
    expect(s.market.quotations.find(x => x.id === v2)).toMatchObject({ fxRate: '7.05', revision: 2 });
    expect(q().fxRate).toBe('7.10');
    const cny = run(s, { type: 'market.quotation.save', payload: { input: { customerId: s.customers[0].id, currency: 'CNY', season: '', validUntil: '2026-11-01', deliveryTerms: 'EXW', paymentTerms: '月结', lines: q().lines.map(({ id: _id, amount: _a, ...l }) => l), fxRate: '7.1' } } } as MarketCommand, ctx);
    expect(s.market.quotations.find(x => x.id === cny.id)!.fxRate).toBeUndefined();
  });

  it('报价预计口径取订单来源报价版本的汇率，多个版本按条目金额加权；未填报价汇率则缺汇率，不用定价试算', () => {
    const { ctx, s } = setup();
    const a = quote(s, ctx, { fxRate: '7.10' }, '2.00'), b = quote(s, ctx, { fxRate: '7.30' }, '6.00'), c = quote(s, ctx, {}, '3.00');
    for (const id of [a, b, c]) accept(s, ctx, id);
    const convert = (id: string) => run(s, { type: 'market.quotation.convert', payload: { id, type: 'fabric', due: '2026-12-01', ownerId: 'sales' } }, ctx).orderId as string;
    const oa = convert(a), ob = convert(b), oc = convert(c);
    expect(fxQuoteRateFor(s, oa, 'USD')).toMatchObject({ rate: 7.1, estimated: true });
    expect(fxQuoteRateFor(s, oa, 'USD')!.label).toContain('汇率 7.10');
    // 把 B 的条目并入 A 的订单：200 × 7.10 与 600 × 7.30 加权 = 7.25
    for (const l of s.orderLines.filter(l => l.orderId === ob)) l.orderId = oa;
    expect(fxQuoteRateFor(s, oa, 'USD')!.rate).toBeCloseTo(7.25, 6);
    expect(fxQuoteRateFor(s, oa, 'EUR')).toBeUndefined();
    s.platform.pricing = [{ id: 'p', orderId: oc, exchangeRate: 7.2, createdAt: '2026-10-13T00:00:00Z' } as any];
    expect(fxRateFor(s, 'USD', 'quote', { month: '2026-10', asOf: '2026-10-13', orderId: oc })).toBeUndefined();
  });
});
