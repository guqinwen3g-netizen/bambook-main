import { expect, it } from 'vitest';
import { fabricStageLinks, fabricStageTermsText } from './mistFabricStage';
import { fabricStagedFixture } from '../mist/__tests__/fabricStaged';

it('names the receiving dyer on a greige contract and links greige and dyeing contracts both ways', () => {
  const f = fabricStagedFixture();
  const save = (stageTerms: Record<string, unknown>, kind: 'material' | 'processing' = 'material') => f.run({ type: 'fulfillment.procurement.save', payload: { orderId: f.orderId, lineId: f.lineId, kind, ...(kind === 'material' ? { materialKind: 'greige' as const } : {}), supplierId: kind === 'material' ? 'weaver' : 'finisher', supplier: '', description: '补单坯布', quantity: 500, unit: '米', price: 10, currency: 'CNY', due: '2026-11-20', terms: '月结', destination: '染厂', note: '', fileIds: [], stageTerms } as never }).id!;
  const id = save({ deliverToSupplierId: 'dyer' });
  const p = f.state.fulfillment.purchases.find(x => x.id === id)!;
  expect(p.stageTerms).toMatchObject({ deliverToSupplierId: 'dyer', deliverToSupplier: '盛泽染整' });
  expect(fabricStageTermsText(p)).toContain('交 盛泽染整 收货加工');
  expect(fabricStageLinks(f.state, id).feeds.map(x => x.id)).toContain(f.dyeing);
  expect(fabricStageLinks(f.state, f.dyeing).fedBy.map(x => x.id)).toContain(id);
  expect(() => save({ deliverToSupplierId: 'nobody' })).toThrow('供应商档案');
  expect(() => save({ deliverToSupplierId: 'dyer' }, 'processing')).toThrow('前道加工');
});
