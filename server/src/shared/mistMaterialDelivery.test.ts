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
