import { expect, it } from 'vitest';
import { materialDeliveryFixture } from '../mist/__tests__/materialDelivery';
import { assertMaterialReturnReversal, internalFabricCostShare, internalFabricDeliveryState, materialDeliveryRows } from './mistInternalFabric';

function fixture(quantity = 100.3) {
  const f = materialDeliveryFixture(quantity, false);
  const deliver = (amount: number, rejected = 0) => f.run({ type: 'fulfillment.materials.deliver', payload: { id: f.purchaseId, targetProductionId: f.productionId, quantity: amount, rejected, location: 'Factory', date: '2026-10-24', evidence: 'Dispatch note', fileIds: [] } }).id!;
  const receive = (id: string, acceptedQuantity: number, rejectedQuantity: number, expectedReceivingRevision = 0, actor = 'garment') => f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'direct', id, acceptedQuantity, rejectedQuantity, expectedReceivingRevision, evidence: 'Factory count' } }, actor);
  const returned = (id: string, amount: number) => f.run({ type: 'fulfillment.procurement.return', payload: { receiptId: id, quantity: amount, disposition: 'replace', date: '2026-10-24', evidence: 'Returned to mill' } }).id!;
  // Quantity tests resume after the independently tested source-QC recheck gate.
  const recheck = () => { f.state.fulfillment.qcTasks[0].state = 'reported'; f.state.fulfillment.qcReports[0].scopeRevision = f.state.fulfillment.productionFacts.find(row => row.productionId === f.sourceProductionId)!.revision; };
  return { ...f, get state() { return f.state; }, deliver, receive, returned, recheck };
}

it('supports partial warehouse receiving, actual return and reissue without changing the original supplier receipt', () => {
  const f = materialDeliveryFixture(20), id = f.issue(20);
  const originalReceipt = structuredClone(f.state.fulfillment.receipts);
  const count = (acceptedQuantity: number, rejectedQuantity: number, expectedReceivingRevision: number) => f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'issue', id, acceptedQuantity, rejectedQuantity, expectedReceivingRevision, evidence: 'Factory counted' } }, 'garment');
  count(10, 4, 0);
  expect(materialDeliveryRows(f.state)[0]).toMatchObject({ quantity:'20', accepted:'10', rejected:'4', pending:'6', returned:'0', outstanding:'20' });
  expect(internalFabricCostShare(f.state, f.purchaseId, f.target.orderId, 136000)).toBe(68000);
  expect(() => f.issue(1)).toThrow('分配剩余');
  const before = structuredClone(f.state);
  expect(() => count(7, 0, 1)).toThrow('超过待接收');
  expect(() => count(1, 0, 0)).toThrow('记录已变化');
  expect(() => f.run({ type:'fulfillment.materials.confirm', payload:{kind:'issue',id,evidence:'old caller'} }, 'garment')).toThrow('记录已变化');
  expect(() => f.run({ type:'fulfillment.materials.confirm', payload:{kind:'issue',id,acceptedQuantity:1,rejectedQuantity:0,expectedReceivingRevision:1,evidence:'wrong person'} }, 'owner')).toThrow('指定接收负责人');
  expect(() => f.run({type:'fulfillment.inventory.move',payload:{id:f.state.fulfillment.stock[0].id,kind:'return',issueId:id,quantity:15,location:'A-01',person:'factory',note:'return'}})).toThrow();
  expect(f.state).toEqual(before);
  count(6, 0, 1);
  f.run({type:'fulfillment.inventory.move',payload:{id:f.state.fulfillment.stock[0].id,kind:'return',issueId:id,quantity:4,location:'A-01',person:'factory',note:'Rejected returned'}});
  expect(materialDeliveryRows(f.state)[0]).toMatchObject({ accepted:'16', rejected:'4', pending:'0', returned:'4', outstanding:'16' });
  expect(f.state.fulfillment.stock[0]).toMatchObject({ available:0, locked:4 });
  expect(f.state.fulfillment.stockMovements.at(-1)).toMatchObject({kind:'return',quantity:4,quarantinedQuantity:4});
  expect(internalFabricCostShare(f.state, f.purchaseId, f.target.orderId, 136000)).toBe(108800);
  expect(internalFabricCostShare(f.state, f.purchaseId, f.source.orderId, 136000)).toBe(27200);
  expect(f.state.fulfillment.receipts).toEqual(originalReceipt);
  expect(() => f.issue(4)).toThrow('库存可用量不足');
});

it('quarantines only returned rejected material and leaves a returned accepted surplus available', () => {
  const f=materialDeliveryFixture(20),id=f.issue(20);
  f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id,acceptedQuantity:16,rejectedQuantity:4,expectedReceivingRevision:0,evidence:'Counted'}},'garment');
  f.run({type:'fulfillment.inventory.move',payload:{id:f.state.fulfillment.stock[0].id,kind:'return',issueId:id,quantity:5,location:'A-01',person:'factory',note:'Rejected and surplus'}});
  expect(f.state.fulfillment.stock[0]).toMatchObject({available:1,locked:4});
  expect(f.state.fulfillment.stockMovements.at(-1)).toMatchObject({quarantinedQuantity:4});
  expect(materialDeliveryRows(f.state)[0]).toMatchObject({accepted:'15',rejected:'4',pending:'0',returned:'5',outstanding:'15'});
});

it('keeps a legacy pre-count return eligible for full confirmation and refuses ambiguous partial conversion', () => {
  const f=materialDeliveryFixture(20), id=f.issue(20);
  f.run({type:'fulfillment.inventory.move',payload:{id:f.state.fulfillment.stock[0].id,kind:'return',issueId:id,quantity:4,location:'A-01',person:'factory',note:'Legacy return'}});
  expect(() => f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id,acceptedQuantity:10,rejectedQuantity:0,expectedReceivingRevision:0,evidence:'count'}},'garment')).toThrow('旧退回');
  f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id,evidence:'Counted remaining'}},'garment');
  expect(materialDeliveryRows(f.state)[0]).toMatchObject({accepted:'16',pending:'0',returned:'4'});
});

it('separates dispatch, accepted, rejected and still uncounted quantities and transfers only accepted cost', () => {
  const f = fixture(), id = f.deliver(20);
  f.receive(id, 10, 4);
  expect(materialDeliveryRows(f.state)[0]).toMatchObject({ quantity: '20', accepted: '10', rejected: '4', pending: '6', returned: '0', outstanding: '20' });
  const receipt = f.state.fulfillment.receipts.find(row => row.id === id)!;
  expect(receipt).toMatchObject({ quantity: 16, rejected: 4, evidence: 'Dispatch note' });
  expect(f.state.fulfillment.purchases.find(row => row.id === f.purchaseId)?.received).toBe(16);
  expect(receipt.materialDelivery).toMatchObject({ sentQuantity: '20', allocationRevision: 1, sourceQcReportIds: ['fabric-report'], receivingChecks: [{ acceptedQuantity: '10', rejectedQuantity: '4', previousQuantity: '20', previousRejected: '0', actorId: 'garment', evidence: 'Factory count' }] });
  expect(internalFabricCostShare(f.state, f.purchaseId, f.target.orderId, 682040)).toBe(68000);
  expect(internalFabricCostShare(f.state, f.purchaseId, f.source.orderId, 682040)).toBe(614040);
  expect(internalFabricDeliveryState(f.state, f.source.orderId)).toBe('部分交接');
  f.receive(id, 6, 0, 1);
  expect(materialDeliveryRows(f.state)[0]).toMatchObject({ accepted: '16', rejected: '4', pending: '0' });
  expect(internalFabricCostShare(f.state, f.purchaseId, f.target.orderId, 682040)).toBe(108800);
  expect(receipt.materialDelivery?.confirmation).toBeUndefined();
});

it('rejects repeated, stale, overflowing and malformed counts without changing any stored fact', () => {
  const f = fixture(), id = f.deliver(20); f.receive(id, 5, 2);
  const before = structuredClone(f.state);
  expect(() => f.receive(id, 5, 2)).toThrow('记录已变化');
  expect(() => f.receive(id, 14, 0, 1)).toThrow('超过待接收');
  for (const [accepted, rejected] of [[0, 0], [-1, 1], [NaN, 1], [Infinity, 0], [.00001, 0]]) expect(() => f.receive(id, accepted, rejected, 1)).toThrow();
  expect(() => f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'direct', id, evidence: 'Old caller after partial count' } }, 'garment')).toThrow('记录已变化');
  expect(f.state).toEqual(before);
});

it('requires the current receiver and active garment membership for partial counts', () => {
  const f = fixture(), id = f.deliver(20), before = structuredClone(f.state);
  expect(() => f.receive(id, 10, 0, 0, 'owner')).toThrow('指定接收负责人');
  expect(() => f.receive(id, 10, 0, 0, 'reviewer')).toThrow('指定接收负责人');
  f.context.members!.find(member => member.id === 'garment')!.active = false;
  expect(() => f.receive(id, 10, 0)).toThrow('停用');
  expect(f.state).toEqual(before);
});

it('retains all-rejected dispatches and their physical allocation until the supplier return is recorded', () => {
  const f = fixture(20), id = f.deliver(20); f.receive(id, 0, 20);
  expect(materialDeliveryRows(f.state)[0]).toMatchObject({ quantity: '20', accepted: '0', rejected: '20', pending: '0', outstanding: '20' });
  expect(internalFabricCostShare(f.state, f.purchaseId, f.target.orderId, 136000)).toBe(0);
  expect(() => f.deliver(1)).toThrow('分配剩余');
  const returnId = f.returned(id, 20);
  expect(materialDeliveryRows(f.state)[0]).toMatchObject({ returned: '20', outstanding: '0' });
  expect(() => assertMaterialReturnReversal(f.state, id, returnId)).not.toThrow();
  f.recheck(); f.deliver(20);
  expect(() => assertMaterialReturnReversal(f.state, id, returnId)).toThrow('超过面料分配');
});

it('keeps sender rejection separate from receiver rejection when reserving physical capacity', () => {
  const f = fixture(20), id = f.deliver(20, 2); f.receive(id, 16, 4);
  f.returned(id, 2);
  expect(materialDeliveryRows(f.state)[0]).toMatchObject({ quantity: '20', rejected: '4', returned: '0', outstanding: '20' });
  expect(() => f.deliver(1)).toThrow('分配剩余');
  f.returned(id, 4);
  expect(materialDeliveryRows(f.state)[0]).toMatchObject({ returned: '4', outstanding: '16' });
  f.recheck(); f.deliver(4);
});

it('preserves a legacy 180m full confirmation byte for byte and derives its existing acceptance', () => {
  const f = fixture(180), id = f.deliver(180);
  f.run({ type: 'fulfillment.materials.confirm', payload: { id, kind: 'direct', evidence: 'Original signed confirmation' } }, 'garment');
  const before = structuredClone(f.state), row = materialDeliveryRows(f.state)[0];
  expect(row).toMatchObject({ quantity: '180', accepted: '180', rejected: '0', pending: '0' });
  expect(internalFabricDeliveryState(f.state, f.source.orderId)).toBe('已交接');
  expect(internalFabricCostShare(f.state, f.purchaseId, f.target.orderId, 1224000)).toBe(1224000);
  expect(() => f.receive(id, 170, 10)).toThrow('请勿重复');
  expect(f.state).toEqual(before);
  expect(row.delivery.sentQuantity).toBeUndefined(); expect(row.delivery.receivingChecks).toBeUndefined();
});

it('does not revise source receipt quantities already included in a pending or confirmed settlement', () => {
  const f = fixture(), id = f.deliver(20);
  f.state.payables.settlements.push({ purchaseId: f.purchaseId, state: 'pending', final: false, receiptIds: [id] } as never);
  const before = structuredClone(f.state);
  expect(() => f.receive(id, 10, 2)).toThrow('对应结算');
  expect(f.state).toEqual(before);
});

it('requires supplier invoice correction before recipient rejection', () => {
  const f = fixture(), id = f.deliver(20);
  f.state.payables.bills.push({ state: 'open', lines: [{ purchaseId: f.purchaseId }] } as never);
  const before = structuredClone(f.state);
  expect(() => f.receive(id, 10, 2)).toThrow('供应商票据');
  expect(f.state).toEqual(before);
});

it('permits receiver rejection after source completion without rewriting source completion or QC', () => {
  const f = fixture(), fact = f.state.fulfillment.productionFacts.find(row => row.productionId === f.sourceProductionId)!;
  fact.completion = { id: 'completed-source', quantity: 100.3, sizeQuantities: [], date: '2026-10-24', at: f.context.now, actor: 'Fabric', evidence: 'Mill completion', fileIds: [] };
  const id = f.deliver(20), before = structuredClone({ facts: f.state.fulfillment.productionFacts, reports: f.state.fulfillment.qcReports, tasks: f.state.fulfillment.qcTasks });
  f.receive(id, 18, 2);
  expect({ facts: f.state.fulfillment.productionFacts, reports: f.state.fulfillment.qcReports, tasks: f.state.fulfillment.qcTasks }).toEqual(before);
});
