import { describe, expect, it } from 'vitest';
import { createMistState } from './mistWorkspace';
import { applyFulfillmentCommand, fulfillmentCommandPermission, shipmentCancelBlockers } from './mistFulfillment';
import { scopedReferenceViolation, scopedWriteViolation } from './mistDataScope';

const ctx = { id: () => crypto.randomUUID(), now: '2026-10-30T02:00:00Z', actorName: '仓库', actorId: 'warehouse', can: () => true };
function fixture() {
  const root = createMistState(ctx, 'empty');
  root.orders.push({ id: 'o', code: 'SO', type: 'fabric' } as any);
  root.orderLines.push({ id: 'l', orderId: 'o', name: '面料', unit: '米' } as any);
  root.fulfillment.purchases.push({ id: 'po', orderId: 'o', lineId: 'l', unit: '米', kind: 'finished' } as any);
  root.productions.push({ id: 'p', sourcePurchaseId: 'po', orderId: 'o', lineId: 'l' } as any);
  root.fulfillment.stock.push(...['a', 'b', 'c'].map(id => ({ id, purchaseId: 'po', orderId: 'o', lineId: 'l', name: '面料', unit: '米', quantity: 2500, available: 0, location: '仓库' } as any)));
  root.fulfillment.stockMovements.push(...['a', 'b', 'c'].map(id => ({ id: 'i' + id, stockId: id, kind: 'issue', quantity: 2500, location: '仓库', person: '后勤', note: '出库', at: ctx.now, actor: '仓库' } as any)));
  root.fulfillment.shipments.push({ id: 's', code: 'SHP', state: 'departed', lines: [{ orderId: 'o', lineId: 'l', productionId: 'p', quantity: 5000 }], booking: '' } as any);
  root.fulfillment.packing.push({ id: 'pack', shipmentId: 's', lineId: 'l', quantity: 5000 } as any);
  root.fulfillment.documents.push({ id: 'pl', shipmentId: 's', status: 'issued' } as any);
  const run = (command: any) => applyFulfillmentCommand(root, command, ctx);
  const link = (issueId: string, shipmentId = 's', evidence = '按出库与装箱单核对') => run({ type: 'fulfillment.inventory.shipment.link', payload: { issueId, shipmentId, evidence } });
  return { root, run, link };
}

describe('explicit stock issue and shipment reconciliation', () => {
  it('links two exact issues without rewriting physical facts or signed shipment records', () => {
    const f = fixture(), before = structuredClone(f.root.fulfillment);
    f.link('ia'); f.link('ib');
    expect(f.root.fulfillment.stock).toEqual(before.stock);
    expect(f.root.fulfillment.shipments).toEqual(before.shipments);
    expect(f.root.fulfillment.packing).toEqual(before.packing);
    expect(f.root.fulfillment.documents).toEqual(before.documents);
    expect(f.root.fulfillment.stockMovements[0].shipmentLink).toMatchObject({ shipmentId: 's', productionId: 'p', actor: '仓库' });
    expect(() => f.link('ia')).toThrow('尚未关联');
    expect(() => f.link('ic')).toThrow('超过本次出运');
  });
  it('rejects incorrect production, unit, material issues, missing evidence and cancelled shipments', () => {
    const f = fixture();
    expect(() => f.link('ia', 's', '')).toThrow('核对依据');
    f.root.fulfillment.shipments[0].lines[0].productionId = 'other';
    expect(() => f.link('ia')).toThrow('生产分支');
    f.root.fulfillment.shipments[0].lines[0].productionId = 'p';
    f.root.fulfillment.stock[0].unit = '件'; expect(() => f.link('ia')).toThrow('来源采购不一致');
    f.root.fulfillment.stock[0].unit = '米'; f.root.fulfillment.shipments[0].state = 'cancelled'; expect(() => f.link('ia')).toThrow('不可用');
    f.root.fulfillment.shipments[0].state = 'preparing'; f.root.fulfillment.stockMovements[0].materialDelivery = {} as any; expect(() => f.link('ia')).toThrow('普通出库');
  });
  it('blocks returns and cancellation while linked, and permits audited unlink before departure', () => {
    const f = fixture(); f.root.fulfillment.shipments[0].state = 'preparing'; f.link('ia');
    expect(shipmentCancelBlockers(f.root, f.root.fulfillment.shipments[0])).toContain('已关联库存出库，请先解除关联');
    expect(() => f.run({ type: 'fulfillment.inventory.move', payload: { id: 'a', kind: 'return', issueId: 'ia', quantity: 1, location: '仓库', person: '后勤', note: '退回' } })).toThrow('解除关联');
    f.run({ type: 'fulfillment.inventory.shipment.unlink', payload: { issueId: 'ia', reason: '改配另一票' } });
    expect(f.root.fulfillment.stockMovements[0].shipmentLink).toBeUndefined();
    expect(f.root.fulfillment.stockMovements[0].shipmentLinkHistory?.[0]).toMatchObject({ shipmentId: 's', unlinkReason: '改配另一票' });
    expect(shipmentCancelBlockers(f.root, f.root.fulfillment.shipments[0])).not.toContain('已关联库存出库，请先解除关联');
  });
  it('does not unlink or return an already departed shipment as ordinary warehouse stock', () => {
    const f = fixture(); f.link('ia');
    expect(() => f.run({ type: 'fulfillment.inventory.shipment.unlink', payload: { issueId: 'ia', reason: '更正' } })).toThrow('已出运');
    expect(() => f.run({ type: 'fulfillment.inventory.move', payload: { id: 'a', kind: 'return', issueId: 'ia', quantity: 1, location: '仓库', person: '后勤', note: '退回' } })).toThrow('售后');
    expect(fulfillmentCommandPermission({ type: 'fulfillment.inventory.shipment.link', payload: { issueId: 'ia', shipmentId: 's', evidence: 'x' } })).toBe('inventory:write');
  });
  it('corrects an already departed link atomically, preserving shipment, packing, documents and history', () => {
    const f=fixture(); f.link('ia');
    f.root.fulfillment.shipments.push({...structuredClone(f.root.fulfillment.shipments[0]),id:'s2',code:'SHP-2'});
    const before=structuredClone(f.root.fulfillment);
    expect(()=>f.run({type:'fulfillment.inventory.shipment.correct',payload:{issueId:'ia',shipmentId:'s2',reason:'',evidence:'核对'}})).toThrow('更正原因');
    f.run({type:'fulfillment.inventory.shipment.correct',payload:{issueId:'ia',shipmentId:'s2',reason:'对照实际交接更正',evidence:'核对出库单和装箱单'}});
    const issue=f.root.fulfillment.stockMovements[0];expect(issue.shipmentLink).toMatchObject({shipmentId:'s2',evidence:'核对出库单和装箱单'});
    expect(issue.shipmentLinkHistory?.[0]).toMatchObject({shipmentId:'s',unlinkReason:'对照实际交接更正',correctionEvidence:'核对出库单和装箱单',correctedShipmentId:'s2'});
    expect(f.root.fulfillment.stock).toEqual(before.stock);expect(f.root.fulfillment.shipments).toEqual(before.shipments);expect(f.root.fulfillment.packing).toEqual(before.packing);expect(f.root.fulfillment.documents).toEqual(before.documents);
  });
  it('keeps an unassigned correction on hold and cannot convert shipped goods into an ordinary return',()=>{
    const f=fixture();f.link('ia');f.run({type:'fulfillment.inventory.shipment.correct',payload:{issueId:'ia',shipmentId:'',reason:'原关联错误',evidence:'待核对原单'}});
    expect(f.root.fulfillment.stockMovements[0]).toMatchObject({shipmentCorrectionHold:{reason:'原关联错误 · 待核对原单'}});
    expect(()=>f.run({type:'fulfillment.inventory.move',payload:{id:'a',kind:'return',issueId:'ia',quantity:1,location:'仓库',person:'后勤',note:'退回'}})).toThrow('售后');
    f.root.fulfillment.shipments[0].state='preparing';expect(()=>f.link('ia')).toThrow('不可用');
    f.root.fulfillment.shipments[0].state='departed';f.link('ia');expect(f.root.fulfillment.stockMovements[0].shipmentCorrectionHold).toBeUndefined();expect(f.root.fulfillment.stockMovements[0].shipmentLinkHistory?.[0].correctionEvidence).toBe('待核对原单');
  });
  it('preserves evidence from an older pending correction when its hold is resolved',()=>{
    const f=fixture();f.link('ia');f.run({type:'fulfillment.inventory.shipment.correct',payload:{issueId:'ia',shipmentId:'',reason:'原关联错误',evidence:'原单仍待复核'}});
    delete f.root.fulfillment.stockMovements[0].shipmentLinkHistory![0].correctionEvidence;
    f.link('ia');expect(f.root.fulfillment.stockMovements[0].shipmentLinkHistory?.[0].correctionEvidence).toContain('原单仍待复核');
  });
  it('rejects a correction whose destination does not match or has insufficient capacity',()=>{
    const f=fixture();f.link('ia');f.root.fulfillment.shipments.push({...structuredClone(f.root.fulfillment.shipments[0]),id:'s2',lines:[{orderId:'o',lineId:'l',productionId:'wrong',quantity:5000}]} as any);
    expect(()=>f.run({type:'fulfillment.inventory.shipment.correct',payload:{issueId:'ia',shipmentId:'s2',reason:'更正',evidence:'核对'}})).toThrow('生产分支');
    expect(f.root.fulfillment.stockMovements[0].shipmentLink?.shipmentId).toBe('s');expect(f.root.fulfillment.stockMovements[0].shipmentLinkHistory).toBeUndefined();
  });
  it('requires visibility of the source issue and destination shipment in the caller scope', () => {
    const f = fixture(); f.root.orders[0].ownerId = 'sales';
    const own = { userIds: ['sales'], teamIds: [] }, outsider = { userIds: ['other'], teamIds: [] };
    expect(scopedReferenceViolation(f.root, own, { issueId: 'ia', shipmentId: 's' })).toBeNull();
    expect(scopedReferenceViolation(f.root, outsider, { issueId: 'ia', shipmentId: 's' })).not.toBeNull();
    const before = structuredClone(f.root); f.link('ia');
    expect(scopedWriteViolation(before, f.root, own)).toBeNull();
    expect(scopedWriteViolation(before, f.root, outsider)).toMatchObject({ path: 'fulfillment.stockMovements', id: 'ia' });
  });
});
