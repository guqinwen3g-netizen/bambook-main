import { expect, it } from 'vitest';
import { materialDeliveryFixture } from '../mist/__tests__/materialDelivery';

function fixture() {
  const f = materialDeliveryFixture(20, false);
  const warehouseId = f.run({ type: 'fulfillment.claimInventory.warehouse.save', payload: { code: 'WH', name: '仓库', address: '园区一号', active: true } }).id!;
  f.run({ type: 'fulfillment.procurement.receive', payload: { id: f.purchaseId, quantity: 20, rejected: 0, destination: 'warehouse', warehouseId, location: 'A-01', date: '2026-10-24', evidence: 'Delivery note', fileIds: [] } });
  const save = (active: boolean, supplierId?: string) => f.run({ type: 'fulfillment.claimInventory.warehouse.save', payload: { id: warehouseId, code: 'WH', name: '仓库', address: '园区一号', active, ...(supplierId ? { custodian: 'supplier' as const, supplierId } : {}) } });
  return { ...f, get state() { return f.state; }, warehouseId, save };
}

it('refuses to deactivate a warehouse with ordinary available purchase stock and permits it after a complete issue', () => {
  const f = fixture(), before = structuredClone(f.state);
  expect(f.state.fulfillment.stock[0]).toMatchObject({ available: 20, warehouseId: f.warehouseId });
  expect(f.state.fulfillment.stock[0].onHand).toBeUndefined();
  expect(() => f.save(false)).toThrow('仍有实际库存');
  expect(f.state).toEqual(before);
  // The extra receipt changed the source QC scope; use the current passing report.
  f.state.fulfillment.qcReports[0].scopeRevision = f.state.fulfillment.productionFacts.find(p => p.productionId === f.sourceProductionId)!.revision;
  f.state.fulfillment.qcTasks[0].state = 'reported';
  f.issue(20);
  f.save(false);
  expect(f.state.fulfillment.warehouses.find(w => w.id === f.warehouseId)?.active).toBe(false);
});

it('refuses to change custody while ordinary purchased goods remain in the warehouse', () => {
  const f = fixture(), before = structuredClone(f.state);
  expect(() => f.save(true, 'mill')).toThrow('不能变更保管单位');
  expect(f.state).toEqual(before);
});
