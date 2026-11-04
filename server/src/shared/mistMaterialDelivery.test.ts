import {scopedWriteViolation} from './mistDataScope';
import { expect, it } from 'vitest';
import { materialDeliveryFixture } from '../mist/__tests__/materialDelivery';
import { internalFabricCostShare, materialDeliveryRows, assertInternalFabricOrderChange } from './mistInternalFabric';
import { orderActualCost } from './mistOrderCost';

it('binds warehouse issue to the exact allocation and processing branch, then transfers cost only after the designated receiver confirms', () => {
  const f = materialDeliveryFixture(), id = f.issue();
  expect(f.state.fulfillment.stock[0].available).toBe(0);
  const row = materialDeliveryRows(f.state)[0]; expect(row.delivery).toMatchObject({ productionId: f.productionId, orderId: f.target.orderId, allocationRevision: 1, receiverId: 'garment', sourceQcReportIds: ['fabric-report'] });
  expect(internalFabricCostShare(f.state, f.purchaseId, f.target.orderId, 682040)).toBe(0);
  expect(() => f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'issue', id, evidence: 'Counted' } })).toThrow('指定接收负责人');
  f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'issue', id, evidence: 'Counted at factory' } }, 'garment');
  expect(internalFabricCostShare(f.state, f.purchaseId, f.source.orderId, 682040)).toBe(0);
  expect(internalFabricCostShare(f.state, f.purchaseId, f.target.orderId, 682040)).toBe(682040);
  expect(orderActualCost(f.state, f.target.orderId, 'period', '2026-10', '2026-10-24').purchaseCny).toBe(6840.4);
  expect(() => f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'issue', id, evidence: 'Again' } }, 'garment')).toThrow('请勿重复');
});

it.each(['cmt', 'trims_cmt'] as const)('dispatches allocated internal fabric to a %s processing branch', mode => {
  const f = materialDeliveryFixture();
  f.state.orderLines.find(line => line.id === f.target.lineId)!.fulfillmentMode = mode;
  f.state.orders.find(order => order.id === f.target.orderId)!.governance!.approvedSnapshot!.lines.find(line => line.id === f.target.lineId)!.fulfillmentMode = mode;
  const id = f.issue(20);
  f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'issue', id, evidence: 'Factory counted' } }, 'garment');
  expect(materialDeliveryRows(f.state)[0]).toMatchObject({ accepted: '20', pending: '0' });
  expect(internalFabricCostShare(f.state, f.purchaseId, f.target.orderId, 682040)).toBe(136000);
});

it('refuses an unlinked, wrong-branch, over-allocation or stale-QC issue without changing inventory', () => {
  const f = materialDeliveryFixture(), before = structuredClone(f.state);
  const payload = { id: f.state.fulfillment.stock[0].id, kind: 'issue' as const, quantity: 1, location: 'Factory', person: 'factory', note: 'Sent' };
  expect(() => f.run({ type: 'fulfillment.inventory.move', payload })).toThrow('接收加工单');
  expect(() => f.issue(1, 'owner', f.sourceProductionId)).toThrow('成衣加工分支');
  f.state.internalFabricAllocations![0].metres = '20'; expect(() => f.issue(20.0001)).toThrow('分配剩余');
  f.state.internalFabricAllocations![0].metres = '100.3'; f.state.fulfillment.qcReports[0].scopeRevision = 0;
  expect(() => f.issue()).toThrow('质量门禁');
  expect(f.state.fulfillment.stock).toEqual(before.fulfillment.stock); expect(materialDeliveryRows(f.state)).toEqual([]);
});

it('prevents cancel, supplier transfer and allocation changes while material is at the processing factory; returns restore available material and cost', () => {
  const f = materialDeliveryFixture(), id = f.issue(20);
  f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'issue', id, evidence: 'Counted' } }, 'garment');
  const allocation = f.state.internalFabricAllocations![0];
  expect(() => f.run({ type: 'order.fabric.cancel', payload: { id: allocation.id, expectedRevision: 1 } }, 'garment')).toThrow('实际交接');
  expect(() => f.run({ type: 'order.fabric.allocate', payload: { ...f.target, fabricOrderId: f.source.orderId, fabricLineId: f.source.lineId, metres: '90', expectedRevision: 1 } }, 'garment')).toThrow('不能改配');
  expect(() => f.run({ type: 'payable.purchase.cancel', payload: { purchaseId: f.processingId, reason: 'Cancel' } }, 'garment')).toThrow('物料');
  f.run({ type: 'fulfillment.inventory.move', payload: { id: f.state.fulfillment.stock[0].id, kind: 'return', quantity: 5, issueId: id, location: 'A-01', person: 'factory', note: 'Returned surplus' } });
  expect(materialDeliveryRows(f.state)[0].outstanding).toBe('15'); expect(f.state.fulfillment.stock[0].available).toBe(85.3);
  expect(internalFabricCostShare(f.state, f.purchaseId, f.target.orderId, 682040)).toBe(102000);
  expect(internalFabricCostShare(f.state, f.purchaseId, f.source.orderId, 682040)).toBe(580040);
});

it('supports supplier direct delivery with no company stock entry and preserves exact allocation capacity', () => {
  const f = materialDeliveryFixture(100.3, false);
  const payload = { id: f.purchaseId, quantity: 20, rejected: 0, location: 'Factory', date: '2026-10-24', evidence: 'Direct delivery', fileIds: [], targetProductionId: f.productionId };
  const id = f.run({ type: 'fulfillment.materials.deliver', payload }).id!;
  expect(f.state.fulfillment.stock).toHaveLength(0); expect(materialDeliveryRows(f.state)[0]).toMatchObject({ kind: 'direct', quantity: '20' });
  f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'direct', id, evidence: 'Factory counted' } }, 'garment');
  expect(internalFabricCostShare(f.state, f.purchaseId, f.target.orderId, 682040)).toBe(136000);
});

it('rejects a disabled receiving owner while allowing authorized central warehouse staff', () => {
  const f = materialDeliveryFixture();
  f.context.members!.find(m => m.id === 'garment')!.active = false; expect(() => f.issue(1)).toThrow('停用');
  f.context.members!.find(m => m.id === 'garment')!.active = true; f.issue(1, 'warehouse');
  expect(materialDeliveryRows(f.state)).toHaveLength(1);
});

it('apportions a cent across multiple garment orders without duplication and restores the source share after a return', () => {
  const f = materialDeliveryFixture(.3), allocation = f.state.internalFabricAllocations![0];
  f.run({ type: 'order.fabric.allocate', payload: { ...f.target, fabricOrderId: f.source.orderId, fabricLineId: f.source.lineId, metres: '0.1', expectedRevision: allocation.revision } }, 'garment');
  const other = f.create('garment');
  f.run({ type: 'order.fabric.allocate', payload: { ...other, fabricOrderId: f.source.orderId, fabricLineId: f.source.lineId, metres: '0.2', expectedRevision: 0 } }, 'garment');
  const po = f.purchase('processing', other), branch = f.state.productions.find(p => p.sourcePurchaseId === po)!.id;
  const a = f.issue(.1), b = f.issue(.2, 'owner', branch);
  for (const id of [a, b]) f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'issue', id, evidence: 'Counted' } }, 'garment');
  const shares = (minor: number) => [f.source.orderId, f.target.orderId, other.orderId].map(id => internalFabricCostShare(f.state, f.purchaseId, id, minor));
  expect(shares(1)).toEqual([0, 0, 1]); expect(shares(3).reduce((sum, n) => sum + n, 0)).toBe(3);
  f.run({ type: 'fulfillment.inventory.move', payload: { id: f.state.fulfillment.stock[0].id, kind: 'return', quantity: .1, issueId: a, location: 'A-01', person: 'factory', note: 'Returned' } });
  expect(shares(3)).toEqual([1, 0, 2]);
});

it('allows the current accountable owner to receive after a staff handover without rewriting the original delivery',()=>{
  const f=materialDeliveryFixture(),id=f.issue(20);
  f.state.orders.find(o=>o.id===f.target.orderId)!.ownerId='reviewer';
  f.context.members!.find(m=>m.id==='garment')!.active=false;
  f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id,evidence:'Received after ownership handover'}},'reviewer');
  const delivery=materialDeliveryRows(f.state)[0].delivery;expect(delivery.receiverId).toBe('garment');expect(delivery.confirmation?.actorId).toBe('reviewer');
});

it('locks physical source changes after issue but permits an internal budget update',()=>{
  const f=materialDeliveryFixture();f.issue(20);
  const order=f.state.orders.find(o=>o.id===f.source.orderId)!,line=f.state.orderLines.find(l=>l.id===f.source.lineId)!;
  expect(()=>assertInternalFabricOrderChange(f.state,order,[{...line,price:101} as never],order.governance!.contract)).not.toThrow();
  expect(()=>assertInternalFabricOrderChange(f.state,order,[{...line,unit:'m'} as never],order.governance!.contract)).toThrow('面料来源或规格');
});

it('uses explicit record scope rather than a business-group name for cross-group material writes',()=>{
 const isolated=materialDeliveryFixture(),before=structuredClone(isolated.state);
 isolated.issue(1,'garment');
 expect(scopedWriteViolation(before,isolated.state,{userIds:['garment'],teamIds:[]})).not.toBeNull();
 const shared=materialDeliveryFixture();
 shared.state.teamScopes=[{teamId:'material-team',conditions:[],picks:[{kind:'order',id:shared.source.orderId}],exclusions:[],history:[]} as any];
 const sharedBefore=structuredClone(shared.state);shared.issue(1,'garment');
 expect(scopedWriteViolation(sharedBefore,shared.state,{userIds:['garment'],teamIds:['material-team']})).toBeNull();
});

it('prices internal fabric at cost plus the agreed markup: garment cost includes it, the fabric order books internal revenue and profit', () => {
  const f = materialDeliveryFixture(), id = f.issue();
  f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'issue', id, evidence: 'Counted at factory' } }, 'garment');
  const plain = orderActualCost(f.state, f.target.orderId, 'period', '2026-10', '2026-10-24');
  expect(plain.purchaseCny).toBe(6840.4);
  f.state.orders.find(o => o.id === f.source.orderId)!.governance!.contract.internalSupply!.markupPercent = 10;
  const garment = orderActualCost(f.state, f.target.orderId, 'period', '2026-10', '2026-10-24');
  expect(garment.purchases.find(r => r.key.startsWith('mk:'))).toMatchObject({ amount: 682.04 });
  expect(garment.purchaseCny).toBe(7522.44);
  const fabric = orderActualCost(f.state, f.source.orderId, 'period', '2026-10', '2026-10-24');
  expect(fabric.internalSale).toEqual({ revenueCny: 7502.44, profitCny: 682.04, markupPercent: 10 });
});


it('reconciles marked-up internal revenue to the actual final settlement and supplier deduction, not the original contract', () => {
  const f = materialDeliveryFixture(10), id = f.issue();
  f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'issue', id, evidence: 'Counted' } }, 'garment');
  f.state.orders.find(o => o.id === f.source.orderId)!.governance!.contract.internalSupply!.markupPercent = 15;
  f.state.payables!.settlements.push({ id: 'final', purchaseId: f.purchaseId, state: 'confirmed', final: true, quantity: 10, amount: 600 } as any);
  f.state.payables!.bills.push({ id: 'fabric-bill', state: 'open', currency: 'CNY', amount: 600, lines: [{ purchaseId: f.purchaseId, amount: 600 }] } as any);
  f.state.payables!.deductions.push({ id: 'deduction', billId: 'fabric-bill', amount: 20 } as any);
  const cost = (orderId: string) => orderActualCost(f.state, orderId, 'period', '2026-10', '2026-10-24');
  expect(cost(f.target.orderId).purchaseCny).toBe(687); // (600 - 20) × 1.15 + garment processing 20
  expect(cost(f.source.orderId).internalSale).toEqual({ revenueCny: 667, profitCny: 87, markupPercent: 15 });
});

it('preserves every cent of internal revenue across destinations and foreign-currency cost components', () => {
  const f = materialDeliveryFixture(2), allocation = f.state.internalFabricAllocations![0];
  f.run({ type: 'order.fabric.allocate', payload: { ...f.target, fabricOrderId: f.source.orderId, fabricLineId: f.source.lineId, metres: '1', expectedRevision: allocation.revision } }, 'garment');
  const other = f.create('garment');
  f.run({ type: 'order.fabric.allocate', payload: { ...other, fabricOrderId: f.source.orderId, fabricLineId: f.source.lineId, metres: '1', expectedRevision: 0 } }, 'garment');
  const po = f.purchase('processing', other), branch = f.state.productions.find(p => p.sourcePurchaseId === po)!.id;
  for (const id of [f.issue(1), f.issue(1, 'owner', branch)]) f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'issue', id, evidence: 'Counted' } }, 'garment');
  const purchase = f.state.fulfillment.purchases.find(p => p.id === f.purchaseId)!;
  purchase.price = .03; purchase.currency = 'USD';
  f.state.orders.find(o => o.id === f.source.orderId)!.governance!.contract.internalSupply!.markupPercent = 15;
  f.state.fxPeriodRates = [{ id: 'usd', currency: 'USD', month: '2026-10', rate: '7.10' } as any];
  const costs = [f.target.orderId, other.orderId].map(id => orderActualCost(f.state, id, 'period', '2026-10', '2026-10-24'));
  const internalMinor = costs.flatMap(c => c.purchases).filter(l => l.key.endsWith(':' + f.purchaseId)).reduce((sum, l) => sum + Math.round(l.cny! * 100), 0);
  const sale = orderActualCost(f.state, f.source.orderId, 'period', '2026-10', '2026-10-24').internalSale!;
  expect(internalMinor).toBe(42); // each destination: USD .03, markup rounds to zero cents
  expect(Math.round(sale.revenueCny * 100)).toBe(internalMinor);
  expect(sale.profitCny).toBe(0);
  f.state.fxPeriodRates = [];
  expect(orderActualCost(f.state, f.source.orderId, 'period', '2026-10', '2026-10-24')).toMatchObject({ status: 'norate', missing: ['USD'], internalSale: null });
});


it('keeps both groups separate through partial receipt, rejected return, replacement and accepted surplus return', () => {
  const f = materialDeliveryFixture(10);
  const contract = structuredClone(f.state.orders.find(o => o.id === f.source.orderId)!.governance!.contract);
  contract.internalSupply!.markupPercent = 15;
  f.run({ type: 'order.governance.saveDraft', payload: { orderId: f.source.orderId, input: contract, reason: 'Agree internal price' } });
  f.run({ type: 'order.governance.submit', payload: { orderId: f.source.orderId } });
  f.run({ type: 'order.governance.decide', payload: { id: f.source.orderId, decision: 'approved', note: 'Checked internal markup' } }, 'reviewer');
  const id = f.issue();
  const cost = (orderId: string) => orderActualCost(f.state, orderId, 'period', '2026-10', '2026-10-24');
  const reconcile = (accepted: number) => {
    const fabric = cost(f.source.orderId), garment = cost(f.target.orderId);
    const internalMinor = garment.purchases.filter(l => l.key.endsWith(':' + f.purchaseId)).reduce((n, l) => n + Math.round(l.cny! * 100), 0);
    expect(internalMinor).toBe(Math.round(accepted * 68 * 1.15 * 100));
    expect(Math.round((fabric.internalSale?.revenueCny || 0) * 100)).toBe(internalMinor);
    expect(fabric.purchaseCny).toBe((10 - accepted) * 68);
    expect(fabric.revenueCny).toBe(0); expect(fabric.marginIn).toBeNull();
  };
  reconcile(0);
  f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'issue', id, acceptedQuantity: 4, rejectedQuantity: 2, expectedReceivingRevision: 0, evidence: 'First count' } }, 'garment');
  reconcile(4);
  f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'issue', id, acceptedQuantity: 4, rejectedQuantity: 0, expectedReceivingRevision: 1, evidence: 'Remaining count' } }, 'garment');
  reconcile(8);
  const returned = (quantity: number, issueId = id) => f.run({ type: 'fulfillment.inventory.move', payload: { id: f.state.fulfillment.stock[0].id, kind: 'return', quantity, issueId, location: 'A-01', person: 'factory', note: 'Actual return' } });
  returned(2); reconcile(8);
  expect(f.state.fulfillment.stock[0]).toMatchObject({ available: 0, locked: 2 });
  // An accepted surplus return, unlike the earlier rejected return, rolls back the cost transfer.
  returned(1); reconcile(7);
  const replacement = f.issue(1);
  f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'issue', id: replacement, evidence: 'Replacement counted' } }, 'garment');
  reconcile(8);
  const target = f.state.orders.find(o => o.id === f.target.orderId)!;
  target.governance!.contract.kind = 'external'; target.amount = 1000;
  const fabric = cost(f.source.orderId), garment = cost(f.target.orderId);
  expect(garment.marginEx).toBe(354.4); // 1000 - 625.60 internal price - 20 processing
  expect(Math.round((garment.marginEx! + fabric.internalSale!.profitCny - fabric.costCny!) * 100)).toBe(30000);
});
