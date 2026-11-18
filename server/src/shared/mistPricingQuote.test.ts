import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, getMistReviewTasks, type MistCommand, type MistContext } from './mistWorkspace';

function fixture() {
  let id = 0; const ctx = { id: () => `pq-${++id}`, now: '2026-10-14T02:00:00Z', actorId: 'sales', actorName: '顾言' } as MistContext;
  let state = createMistState(ctx, 'demo');
  const authority = { businessReviewerId: 'reviewer' } as NonNullable<MistContext['authority']>;
  const run = (command: MistCommand, actorId = 'sales') => { const r = applyMistCommand(state, command, { ...ctx, authority, actorId }); state = r.state; return r.result; };
  return { run, get state() { return state; } };
}
const trial = { purchaseCostCny: 70, refundRate: 13, exchangeRate: 7.8, profitMargin: 20, commissionRate: 0, basis: '工厂报价 70 元 / 米；EUR 月末汇率' };

describe('pricing on a quotation line', () => {
  it('prices in the quotation currency and writes the price back to the draft line, resetting approval', () => {
    const f = fixture(), q = f.state.market.quotations.find(x => x.status === 'Draft' && x.currency !== 'CNY' && x.approval?.status !== 'pending' && !x.convertedOrderId)!;
    const line = q.lines[0];
    expect(() => f.run({ type: 'platform.pricing.save', payload: { ...trial, quotationId: q.id, lineId: line.id, currency: 'GBP' } })).toThrow('同一币种');
    const id = f.run({ type: 'platform.pricing.save', payload: { ...trial, quotationId: q.id, lineId: line.id, currency: q.currency, deviationReason: '客户长期合作' } }).id!;
    const row = f.state.platform.pricing.find(r => r.id === id)!;
    expect(row).toMatchObject({ quotationId: q.id, lineId: line.id, orderId: '' });
    f.run({ type: 'platform.pricing.apply', payload: { id, note: '按试算报价' } });
    const after = f.state.market.quotations.find(x => x.id === q.id)!;
    expect(after.lines[0].price).toBe((Math.round(row.finalUnitPrice * 100) / 100).toFixed(2));
    expect(after.requiresApproval).toBe(true);
    expect(f.state.platform.pricing.find(r => r.id === id)!.appliedBy).toBe('顾言');
    expect(() => f.run({ type: 'platform.pricing.save', payload: { ...trial } })).toThrow('之一');
  });
  it('anchors reference costs to a product file and keeps order-only records valid', () => {
    const f = fixture(), product = f.state.market.products[0];
    const id = f.run({ type: 'platform.bom.save', payload: { productId: product.id, unit: '件', description: '羊毛大衣参考成本', currency: 'CNY', lines: [{ description: '面料', quantity: 2.2, unit: '米', wastagePercent: 3, unitCost: 68 }], labor: 45, overhead: 8 } }).id!;
    expect(f.state.platform.boms.find(b => b.id === id)).toMatchObject({ productId: product.id, unit: '件', orderId: '' });
    expect(() => f.run({ type: 'platform.bom.save', payload: { description: 'x', currency: 'CNY', lines: [{ description: 'a', quantity: 1, unit: '米', wastagePercent: 0, unitCost: 1 }], labor: 0, overhead: 0 } })).toThrow('来源');
  });
  it('shows the applied pricing basis in the exact review, preserving each round after repricing', () => {
    const f = fixture();
    const q = f.state.market.quotations.find(quote => quote.status === 'Draft' && quote.currency !== 'CNY' && !quote.approval)!;
    const [line] = q.lines;
    const family = line.family === 'fabric' ? 'fabric' : 'garment';
    f.run({type:'platform.pricingParams.set', payload:{family, profitMargin:25, commissionRate:1.5,
      effectiveFrom:'2026-10-14', reason:'原标准'}});
    const price = (basis: string, deviationReason: string) => f.run({type:'platform.pricing.save', payload:{
      ...trial, quotationId:q.id, lineId:line.id, currency:q.currency, commissionRate:1.5, basis, deviationReason,
    }}).id!;
    const original = price('原试算依据', '原折让理由');
    const newer = price('新试算依据', '新折让理由');
    f.run({type:'platform.pricing.apply', payload:{id:original, note:'采用原试算'}});
    const firstReview = f.run({type:'market.quotation.submit',payload:{id:q.id}}).reviewId;
    const details = (id: string | undefined) => getMistReviewTasks(f.state).find(review=>review.id===id)!.details;
    const first = details(firstReview);
    expect(first).toEqual(expect.arrayContaining([expect.objectContaining({label:'定价试算 · 第 1 行',
      value:expect.stringMatching(/佣金 1\.5%.*标准参数 V2.*原试算依据.*原折让理由/),
    })]));
    expect(JSON.stringify(first)).not.toContain('新试算依据');
    f.run({type:'market.quotation.decide', payload:{id:q.id, decision:'rejected', note:'复核新依据'}},'reviewer');
    f.run({type:'platform.pricing.apply', payload:{id:newer, note:'采用新试算'}});
    const secondReview = f.run({type:'market.quotation.submit',payload:{id:q.id}}).reviewId;
    expect(secondReview).not.toBe(firstReview);
    expect(details(firstReview)).toEqual(first);
    expect(JSON.stringify(details(secondReview))).toContain('新折让理由');
    expect(JSON.stringify(details(secondReview))).not.toContain('原折让理由');
    expect(f.state.market.quotations.find(quote=>quote.id===q.id)?.approval?.details)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({label:'定价试算 · 第 1 行'})]));
  });
});
