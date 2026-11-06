import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, type MistCommand, type MistContext } from './mistWorkspace';

function fixture() {
  let id = 0; const ctx = { id: () => `pq-${++id}`, now: '2026-10-14T02:00:00Z', actorId: 'sales', actorName: '顾言' } as MistContext;
  let state = createMistState(ctx, 'demo');
  const run = (command: MistCommand) => { const r = applyMistCommand(state, command, ctx); state = r.state; return r.result; };
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
});
