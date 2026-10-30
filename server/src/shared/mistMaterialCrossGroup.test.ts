import { expect,it } from 'vitest';
import { materialDeliveryFixture } from '../mist/__tests__/materialDelivery';
import { applyDataScope,scopedReferenceViolation,scopedWriteViolation,scopedMaterialIssueTargets } from './mistDataScope';

it('exposes only an authorized source stock and exact allocated processing target to the source owner',()=>{
 const f=materialDeliveryFixture(20),scope={userIds:['owner'],teamIds:[]},stock=f.state.fulfillment.stock[0];
 const other=f.create('garment'),otherPo=f.purchase('processing',other),otherBranch=f.state.productions.find(p=>p.sourcePurchaseId===otherPo)!.id;
 const hints=scopedMaterialIssueTargets(f.state,scope);
 expect(hints[stock.id]).toEqual([expect.objectContaining({value:f.productionId,remaining:'20'})]);
 const projected=applyDataScope(f.state,scope,'owner');
 expect(projected.orders.some(o=>o.id===f.target.orderId)).toBe(false);
 expect(projected.fulfillment.purchases.some(p=>p.id===f.processingId)).toBe(false);
 expect(scopedReferenceViolation(f.state,scope,{id:stock.id,targetProductionId:f.productionId},false,new Set([f.productionId]))).toBeNull();
 expect(scopedReferenceViolation(f.state,scope,{id:stock.id,targetProductionId:otherBranch},false,new Set([f.productionId]))).toMatchObject({id:otherBranch});
 const before=structuredClone(f.state);f.issue(5);
 expect(scopedWriteViolation(before,f.state,scope)).toBeNull();
 const after=applyDataScope(f.state,scope,'owner'),issue=after.fulfillment.stockMovements.find(m=>m.kind==='issue')!;
 expect(issue.quantity).toBe(5);expect(issue.materialDelivery).toBeUndefined();expect(JSON.stringify(issue)).not.toContain(f.target.orderId);
 const forged=structuredClone(f.state);forged.orders.find(o=>o.id===f.target.orderId)!.customer='secret modified';
 expect(scopedWriteViolation(f.state,forged,scope)).toMatchObject({path:'orders',id:f.target.orderId});
});
