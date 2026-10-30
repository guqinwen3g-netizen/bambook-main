import { expect, it } from 'vitest';
import { materialDeliveryFixture } from '../mist/__tests__/materialDelivery';

function directFixture() {
  const f = materialDeliveryFixture(20, false);
  const deliver = (quantity: number) => f.run({ type: 'fulfillment.materials.deliver', payload: { id: f.purchaseId, targetProductionId: f.productionId, quantity, rejected: 0, location: 'Factory', date: '2026-10-24', evidence: 'Dispatch', fileIds: [] } }).id!;
  const receive = (id: string, acceptedQuantity: number, rejectedQuantity: number, expectedReceivingRevision = 0) => f.run({ type: 'fulfillment.materials.confirm', payload: { id, kind: 'direct', acceptedQuantity, rejectedQuantity, expectedReceivingRevision, evidence: 'Counted' } }, 'garment');
  const settle = (id: string) => f.run({ type: 'payable.settlement.submit', payload: { purchaseId: f.purchaseId, receiptIds: [id] } });
  return { ...f, get state() { return f.state; }, deliver, receive, settle };
}
function replacementPendingFixture() {
  const f = directFixture(), originalId = f.deliver(20);
  f.receive(originalId, 17, 3);
  f.run({ type: 'fulfillment.procurement.return', payload: { receiptId: originalId, quantity: 3, disposition: 'replace', date: '2026-10-24', evidence: 'Returned' } });
  f.state.fulfillment.qcTasks[0].state = 'reported';
  f.state.fulfillment.qcReports[0].scopeRevision = f.state.fulfillment.productionFacts.find(row => row.productionId === f.sourceProductionId)!.revision;
  const replacementId = f.deliver(3);
  return { ...f, get state() { return f.state; }, originalId, replacementId };
}

it('does not finalize a contract by omitting its uncounted replacement receipt', () => {
  const f = replacementPendingFixture(), before = structuredClone(f.state);
  expect(() => f.run({ type: 'payable.settlement.submit', payload: { purchaseId: f.purchaseId, receiptIds: [f.originalId], final: true } })).toThrow('最终结算');
  expect(f.state).toEqual(before);
  f.settle(f.originalId);
  expect(f.state.payables.settlements![0]).toMatchObject({ quantity: 17, final: false });
});

it('rechecks omitted replacement receipts before confirming a historical final settlement', () => {
  const f = replacementPendingFixture();
  f.state.payables.settlements!.push({ id: 'pending-final', purchaseId: f.purchaseId, purchaseCode: 'PO', state: 'pending', submitterId: 'owner', receiptIds: [f.originalId], quantity: 17, amount: 1156, final: true } as never);
  const before = structuredClone(f.state);
  expect(() => f.run({ type: 'payable.settlement.confirm', payload: { id: 'pending-final', prepaymentApplied: 0 } }, 'reviewer')).toThrow('最终结算');
  expect(f.state).toEqual(before);
});

it('finalizes accepted original and replacement quantities once the replacement is actually counted', () => {
  const f = replacementPendingFixture(); f.receive(f.replacementId, 3, 0);
  f.run({ type: 'payable.settlement.submit', payload: { purchaseId: f.purchaseId, receiptIds: [f.originalId, f.replacementId], final: true } });
  expect(f.state.payables.settlements![0]).toMatchObject({ quantity: 20, rejected: 3, amount: 1360, final: true });
});

it('does not omit an accepted but unsettled receipt from a final settlement', () => {
  const f = replacementPendingFixture(); f.receive(f.replacementId, 3, 0);
  const before = structuredClone(f.state);
  expect(() => f.run({ type: 'payable.settlement.submit', payload: { purchaseId: f.purchaseId, receiptIds: [f.originalId], final: true } })).toThrow('未纳入结算');
  expect(f.state).toEqual(before);
});

it('does not settle uncounted direct goods, and settles only accepted goods after count completion', () => {
  const f = directFixture(), id = f.deliver(20), before = structuredClone(f.state);
  expect(() => f.settle(id)).toThrow('待点收');
  expect(f.state).toEqual(before);
  f.receive(id, 10, 4);
  expect(() => f.settle(id)).toThrow('待点收');
  f.receive(id, 6, 0, 1);
  f.settle(id);
  expect(f.state.payables.settlements[0]).toMatchObject({ quantity: 16, rejected: 4, amount: 1088 });
});

it('keeps company warehouse receipt settlement independent from later processing receipt confirmation', () => {
  const f = materialDeliveryFixture(20);
  const receipt = f.state.fulfillment.receipts[0];
  f.issue(10);
  f.run({ type: 'payable.settlement.submit', payload: { purchaseId: f.purchaseId, receiptIds: [receipt.id] } });
  expect(f.state.payables.settlements[0]).toMatchObject({ quantity: 20, amount: 1360 });
});

it('rechecks an existing pending settlement before finance confirms it', () => {
  const f = directFixture(), id = f.deliver(20);
  f.state.payables.settlements!.push({ id: 'old-pending', purchaseId: f.purchaseId, purchaseCode: 'PO', state: 'pending', submitterId: 'owner', receiptIds: [id], quantity: 20, amount: 1360, final: false } as never);
  const before = structuredClone(f.state);
  expect(() => f.run({ type: 'payable.settlement.confirm', payload: { id: 'old-pending', prepaymentApplied: 0 } }, 'reviewer')).toThrow('待点收');
  expect(f.state).toEqual(before);
});

it('prevents reversing returned rejected goods after the capacity was consumed by a replacement', () => {
  const f = directFixture(), id = f.deliver(20);
  f.receive(id, 16, 4);
  const returnId = f.run({ type: 'fulfillment.procurement.return', payload: { receiptId: id, quantity: 4, disposition: 'replace', date: '2026-10-24', evidence: 'Returned' } }).id!;
  f.state.fulfillment.qcTasks[0].state = 'reported';
  f.state.fulfillment.qcReports[0].scopeRevision = f.state.fulfillment.productionFacts.find(row => row.productionId === f.sourceProductionId)!.revision;
  f.deliver(4);
  const before = structuredClone(f.state);
  expect(() => f.run({ type: 'fulfillment.procurement.return.reverse', payload: { receiptId: id, returnId, reason: 'Mistaken return' } })).toThrow('超过面料分配');
  expect(f.state).toEqual(before);
});
