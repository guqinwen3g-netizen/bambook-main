import { describe, expect, it } from 'vitest';
import { createMistState, getMistReviewTasks } from './mistWorkspace';
import { applyFulfillmentCommand, fulfillmentCommandPermission, freeQuantity } from './mistFulfillment';
import { autoIssueForDeparture, stockAgeDays, stockInTransit, stockUnitCost } from './mistStockOperations';

let n = 0;
const ctx = { id: () => `op-${++n}`, now: '2026-11-03T02:00:00Z', actorName: '仓库陈晓', actorId: 'warehouse', can: () => true, authority: { supplier: {}, orderReviewerIds: { garment: ['reviewer'], fabric: ['reviewer'] } } };
const reviewer = { ...ctx, actorId: 'reviewer', actorName: '周敏' };
function fixture() {
  const root = createMistState(ctx, 'empty');
  root.customers.push({ id: 'c', name: '客户', code: 'C' } as any);
  root.orders.push({ id: 'o', code: 'SO-1', type: 'fabric', customerId: 'c' } as any, { id: 'o2', code: 'SO-2', type: 'fabric', customerId: 'c' } as any);
  root.orderLines.push({ id: 'l', orderId: 'o', name: '涤棉布', unit: '米' } as any, { id: 'l2', orderId: 'o2', name: '涤棉布', unit: '米' } as any);
  root.fulfillment.warehouses.push({ id: 'w1', code: 'SH', name: '上海仓', address: '', active: true } as any, { id: 'w2', code: 'NB', name: '宁波仓', address: '', active: true } as any);
  root.fulfillment.purchases.push({ id: 'po', orderId: 'o', lineId: 'l', unit: '米', kind: 'finished' } as any);
  root.productions.push({ id: 'p', sourcePurchaseId: 'po', orderId: 'o', lineId: 'l' } as any);
  root.fulfillment.stock.push({ id: 's', purchaseId: 'po', orderId: 'o', lineId: 'l', name: '涤棉布', unit: '米', quantity: 100, available: 100, warehouseId: 'w1', location: 'A-01', positions: [{ location: 'A-01', available: 60 }, { location: 'A-02', available: 40 }], owner: '公司', createdAt: '2026-10-01T02:00:00Z' } as any);
  const run = (command: any, c: any = ctx) => applyFulfillmentCommand(root, command, c);
  return { root, run, stock: () => root.fulfillment.stock.find(s => s.id === 's')! };
}

describe('stock reservation', () => {
  it('holds quantity for one order line and keeps it from other issues until released', () => {
    const f = fixture();
    const id = f.run({ type: 'fulfillment.stock.reserve', payload: { stockId: 's', orderId: 'o2', lineId: 'l2', quantity: 70, purpose: 'SO-2 大货' } }).id!;
    expect(freeQuantity(f.stock())).toBe(30);
    expect(() => f.run({ type: 'fulfillment.stock.reserve', payload: { stockId: 's', orderId: 'o', lineId: 'l', quantity: 31, purpose: '超量' } })).toThrow('可预留数量不足');
    expect(() => f.run({ type: 'fulfillment.inventory.move', payload: { id: 's', kind: 'issue', quantity: 50, sourceLocation: 'A-01', location: '外发', person: '工厂', note: '领料' } })).toThrow('已预留');
    expect(fulfillmentCommandPermission({ type: 'fulfillment.stock.reserve' } as any)).toBe('orders:write');
    f.run({ type: 'fulfillment.stock.release', payload: { stockId: 's', reservationId: id, reason: '客户取消' } });
    expect(freeQuantity(f.stock())).toBe(100);
    expect(f.stock().reservations![0]).toMatchObject({ releasedBy: '仓库陈晓', releaseReason: '客户取消' });
    expect(() => f.run({ type: 'fulfillment.stock.release', payload: { stockId: 's', reservationId: id, reason: '再次' } })).toThrow('没有有效预留');
    expect(f.root.fulfillment.stockMovements.map(m => m.kind)).toEqual(['reserve', 'release']);
  });
});

describe('warehouse transfer', () => {
  it('moves goods out, holds them in transit, and receives them into the new warehouse', () => {
    const f = fixture();
    expect(() => f.run({ type: 'fulfillment.stock.transfer', payload: { stockId: 's', quantity: 10, toWarehouseId: 'w1', toLocation: 'B', carrier: '自提', note: '调仓' } })).toThrow('请用移位');
    const id = f.run({ type: 'fulfillment.stock.transfer', payload: { stockId: 's', quantity: 40, sourceLocation: 'A-02', toWarehouseId: 'w2', toLocation: 'N-01', carrier: '顺丰物流', note: '宁波发货' } }).id!;
    expect(f.stock()).toMatchObject({ available: 60, warehouseId: 'w1' });
    expect(stockInTransit(f.root, 's')).toBe(40);
    expect(f.root.fulfillment.stockTransfers![0]).toMatchObject({ code: 'TR-2026-00001', state: 'inTransit', fromLocation: 'A-02' });
    f.run({ type: 'fulfillment.stock.transfer.receive', payload: { id, note: '点收无误' } });
    expect(f.stock()).toMatchObject({ available: 100, warehouseId: 'w1' });
    expect(stockInTransit(f.root, 's')).toBe(0);
    expect(f.stock().positions).toContainEqual({ location: '宁波仓 · N-01', available: 40 });
    expect(() => f.run({ type: 'fulfillment.stock.transfer.receive', payload: { id, note: '重复' } })).toThrow('没有在途调拨');
    const kinds = f.root.fulfillment.stockMovements.filter(m => m.transferId === id).map(m => m.kind);
    expect(kinds).toEqual(['transferOut', 'transferIn']);
  });
  it('keeps a lot without a registered warehouse split until all of it arrives', () => {
    const f = fixture();
    delete (f.stock() as any).warehouseId;
    const id = f.run({ type: 'fulfillment.stock.transfer', payload: { stockId: 's', quantity: 40, sourceLocation: 'A-02', toWarehouseId: 'w2', toLocation: 'N-01', carrier: '车队', note: '调仓' } }).id!;
    f.run({ type: 'fulfillment.stock.transfer.receive', payload: { id, note: '到仓' } });
    expect(f.stock().warehouseId).toBeUndefined();
    expect(f.stock().positions).toContainEqual({ location: '宁波仓 · N-01', available: 40 });
  });
  it('moves the lot to the new warehouse when all of it is transferred', () => {
    const f = fixture();
    const a = f.run({ type: 'fulfillment.stock.transfer', payload: { stockId: 's', quantity: 60, sourceLocation: 'A-01', toWarehouseId: 'w2', toLocation: 'N', carrier: '车队', note: '整批调仓' } }).id!;
    const b = f.run({ type: 'fulfillment.stock.transfer', payload: { stockId: 's', quantity: 40, sourceLocation: 'A-02', toWarehouseId: 'w2', toLocation: 'N', carrier: '车队', note: '整批调仓' } }).id!;
    f.run({ type: 'fulfillment.stock.transfer.receive', payload: { id: a, note: '到仓' } });
    f.run({ type: 'fulfillment.stock.transfer.receive', payload: { id: b, note: '到仓' } });
    expect(f.stock()).toMatchObject({ available: 100, warehouseId: 'w2', location: 'N' });
  });
});

describe('stock count', () => {
  it('records no-difference counts directly and sends differences to a reviewer before adjusting', () => {
    const f = fixture();
    const clean = f.run({ type: 'fulfillment.stock.count', payload: { lines: [{ stockId: 's', location: 'A-01', counted: 60 }], note: '月末盘点' } }).id!;
    expect(f.root.fulfillment.stockCounts!.find(c => c.id === clean)!.state).toBe('approved');
    const id = f.run({ type: 'fulfillment.stock.count', payload: { lines: [{ stockId: 's', location: 'A-01', counted: 57.5 }, { stockId: 's', location: 'A-02', counted: 41 }], note: '季度盘点' } }).id!;
    expect(f.stock().available).toBe(100);
    const review = getMistReviewTasks(f.root).find(t => t.entityId === id)!;
    expect(review).toMatchObject({ kind: 'stockCount', reviewerIds: ['reviewer'], status: 'pending' });
    expect(() => f.run({ type: 'fulfillment.stock.count.decide', payload: { id, decision: 'approved', note: '自批' } })).toThrow('审批名单');
    f.run({ type: 'fulfillment.stock.count.decide', payload: { id, decision: 'approved', note: '同意调整' } }, reviewer);
    expect(f.stock().available).toBe(98.5);
    const adjust = f.root.fulfillment.stockMovements.filter(m => m.kind === 'adjust');
    expect(adjust.map(m => m.quantity)).toEqual([-2.5, 1]);
    expect(adjust.every(m => m.countId === id)).toBe(true);
  });
  it('refuses to apply a count when the book changed after counting, and requires a reviewer', () => {
    const f = fixture();
    const id = f.run({ type: 'fulfillment.stock.count', payload: { lines: [{ stockId: 's', location: 'A-01', counted: 50 }], note: '盘点' } }).id!;
    f.run({ type: 'fulfillment.inventory.move', payload: { id: 's', kind: 'issue', quantity: 5, sourceLocation: 'A-01', location: '外发', person: '工厂', note: '领料' } });
    expect(() => f.run({ type: 'fulfillment.stock.count.decide', payload: { id, decision: 'approved', note: '同意' } }, reviewer)).toThrow('账面已变化');
    expect(() => f.run({ type: 'fulfillment.stock.count', payload: { lines: [{ stockId: 's', location: 'A-01', counted: 1 }], note: '盘点' } }, { ...ctx, authority: { supplier: {} } })).toThrow('尚无除盘点人外的审批人');
  });
});

describe('other receipts', () => {
  it('records customer-supplied material with its source, evidence, roll list and ownership', () => {
    const f = fixture();
    expect(() => f.run({ type: 'fulfillment.stock.receiveOther', payload: { orderId: 'o', lineId: 'l', reason: 'customer', source: '客户来料', name: '里布', unit: '米', quantity: 30, location: 'C-1', evidence: '送货单 88', rolls: [{ roll: 'R1', quantity: 10 }] } })).toThrow('码单合计');
    expect(() => f.run({ type: 'fulfillment.stock.receiveOther', payload: { orderId: 'o', lineId: 'l', reason: 'toString', source: 'x', name: 'x', unit: '米', quantity: 1, location: 'x', evidence: 'x' } })).toThrow('来源类型');
    const id = f.run({ type: 'fulfillment.stock.receiveOther', payload: { orderId: 'o', lineId: 'l', reason: 'customer', source: '客户来料 DN-88', name: '里布', unit: '米', quantity: 30, warehouseId: 'w1', location: 'C-1', evidence: '送货单 88', dyeLot: 'D-7', rolls: [{ roll: 'R1', quantity: 18 }, { roll: 'R2', quantity: 12 }] } }).id!;
    expect(f.root.fulfillment.stock.find(s => s.id === id)).toMatchObject({ sourceKind: 'other', ownership: 'Transferred', ownerCustomerId: 'c', available: 30, dyeLot: 'D-7', otherReceipt: { reason: 'customer', source: '客户来料 DN-88' } });
    expect(f.root.fulfillment.stockMovements.at(-1)).toMatchObject({ kind: 'receive', stockId: id, quantity: 30, warehouseId: 'w1' });
  });
});

describe('departure issue', () => {
  it('issues finished goods held in our warehouse once, after any quantity linked by hand', () => {
    const f = fixture();
    f.root.fulfillment.stockMovements.push({ id: 'manual', stockId: 's', kind: 'issue', quantity: 20, location: '码头', person: '货代', note: '先行出库', at: ctx.now, actor: '仓库', shipmentLink: { shipmentId: 'sh', productionId: 'p', evidence: '核对', actor: '仓库', at: ctx.now } } as any);
    const shipment = { id: 'sh', code: 'SHP-1', consignee: '收货人', state: 'departed', lines: [{ orderId: 'o', lineId: 'l', productionId: 'p', quantity: 70 }] } as any;
    f.root.fulfillment.shipments.push(shipment);
    autoIssueForDeparture(f.root, shipment, ctx);
    const auto = f.root.fulfillment.stockMovements.filter(m => m.id !== 'manual' && m.kind === 'issue');
    expect(auto.map(m => [m.sourceLocation, m.quantity])).toEqual([['A-01', 50]]);
    expect(auto[0].shipmentLink).toMatchObject({ shipmentId: 'sh', productionId: 'p' });
    expect(f.stock().available).toBe(50);
  });
  it('does not take stock reserved for another order', () => {
    const f = fixture();
    f.run({ type: 'fulfillment.stock.reserve', payload: { stockId: 's', orderId: 'o2', lineId: 'l2', quantity: 90, purpose: 'SO-2' } });
    const shipment = { id: 'sh', code: 'SHP-1', consignee: '收货人', state: 'departed', lines: [{ orderId: 'o', lineId: 'l', productionId: 'p', quantity: 70 }] } as any;
    autoIssueForDeparture(f.root, shipment, ctx);
    expect(f.stock().available).toBe(90);
  });
  it('uses its own line reservation for the shipment', () => {
    const f = fixture();
    f.run({ type: 'fulfillment.stock.reserve', payload: { stockId: 's', orderId: 'o', lineId: 'l', quantity: 70, purpose: 'SHP-1' } });
    const shipment = { id: 'sh', code: 'SHP-1', consignee: '收货人', state: 'departed', lines: [{ orderId: 'o', lineId: 'l', productionId: 'p', quantity: 70 }] } as any;
    autoIssueForDeparture(f.root, shipment, ctx);
    expect(f.stock().available).toBe(30);
    expect(f.stock().reservations![0].issued).toBe(70);
    expect(freeQuantity(f.stock())).toBe(30);
  });
});

it('book unit cost comes from a bought lot or an other receipt, not from a processing fee', () => {
  const f = fixture();
  Object.assign(f.root.fulfillment.purchases[0], { price: 3.2, currency: 'CNY' });
  expect(stockUnitCost(f.root, f.stock())).toEqual({ unitCost: 3.2, currency: 'CNY' });
  f.root.fulfillment.purchases[0].kind = 'processing';
  expect(stockUnitCost(f.root, f.stock())).toBeUndefined();
});
it('stock age counts Beijing business days since receipt', () => {
  expect(stockAgeDays({ createdAt: '2026-10-01T17:00:00Z' }, '2026-11-03T02:00:00Z')).toBe(32);
  expect(stockAgeDays({ createdAt: '' }, '2026-11-03T02:00:00Z')).toBe(0);
});
