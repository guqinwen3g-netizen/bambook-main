import { expect,it } from 'vitest';
import { materialDeliveryFixture } from '../mist/__tests__/materialDelivery';
import { applyDataScope,scopedFabricAccess,scopedReferenceViolation,scopedWriteViolation,scopedMaterialIssueTargets } from './mistDataScope';

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

it('allows only the derived source status and receiving fields for a recipient handoff',()=>{
 const f=materialDeliveryFixture(20),scope={userIds:['garment'],teamIds:[]},id=f.issue(4);
 f.state.orders.find(o=>o.id===f.source.orderId)!.tone='bad';
 const before=structuredClone(f.state);
 f.run({type:'fulfillment.materials.confirm',payload:{id,kind:'issue',acceptedQuantity:4,rejectedQuantity:0,expectedReceivingRevision:0,evidence:'Counted'}},'garment');
 const allowed={issueId:id,sourceOrderId:f.source.orderId};expect(scopedWriteViolation(before,f.state,scope,allowed)).toBeNull();
 expect(f.state.orders.find(o=>o.id===f.source.orderId)!.tone).not.toBe('bad');
 const bad=structuredClone(f.state);bad.orders.find(o=>o.id===f.source.orderId)!.customer='tampered';expect(scopedWriteViolation(before,bad,scope,allowed)).toMatchObject({path:'orders',id:f.source.orderId});
 const badMovement=structuredClone(f.state);badMovement.fulfillment.stockMovements.find(m=>m.id===id)!.quantity=99;expect(scopedWriteViolation(before,badMovement,scope,allowed)).toMatchObject({path:'fulfillment.stockMovements',id});
});

it('projects current PP review for the exact recipient without exposing the hidden fabric order',()=>{
 const f=materialDeliveryFixture(20),scope={userIds:['garment'],teamIds:[]};
 const sample=f.run({type:'fulfillment.samples.create',payload:{name:'Jacket',category:'成衣',form:'产前样',unit:'件',quantity:1,location:'Sample room',size:'M',color:'Blue',source:{kind:'orderLine',...f.target,productionId:f.productionId},role:'pp',fileIds:[],note:''}},'garment').id!;
 const source={kind:'orderLine' as const,...f.target,productionId:f.productionId};
 f.state.fulfillment.qcTasks.push({id:'task-pp',code:'QC-PP',source,sampleId:sample,domain:'garment',kind:'sample',factory:'factory',location:'room',contact:'',due:'2026-10-24',requestedBy:'Garment',assignee:'QC',assigneeId:'qc',state:'reported',reportIds:['report-pp'],createdAt:f.context.now,businessConfirmation:{result:'approved',note:'Accepted',actor:'Garment',at:f.context.now},businessContinued:{reportId:'report-pp',actor:'Garment',at:f.context.now,note:'Continue'}});
 f.state.fulfillment.qcReports.push({id:'report-pp',taskId:'task-pp',result:'pass',report:'PP-OK',opinion:'Checked',measurements:[],fileIds:[],reviewer:'QC',reviewedAt:f.context.now,scopeRevision:1});
 expect(applyDataScope(f.state,scope,'garment').orders.some(o=>o.id===f.source.orderId)).toBe(false);
 expect(scopedFabricAccess(f.state,scope,'garment','Garment')[f.target.lineId].sampleRequirements).toEqual({});
 const checks=scopedFabricAccess(f.state,scope,'garment','Garment',true)[f.target.lineId].sampleRequirements;
 expect(checks?.[f.productionId]).toMatchObject([{ok:true,reason:'已确认'}]);
 expect(JSON.stringify(checks)).not.toContain('PP-OK');
 expect(scopedFabricAccess(f.state,{userIds:['warehouse'],teamIds:[]},'warehouse','Warehouse')[f.target.lineId]).toBeUndefined();
 f.state.fulfillment.qcReports.find(r=>r.id==='report-pp')!.result='conditional';
 expect(scopedFabricAccess(f.state,scope,'garment','Garment',true)[f.target.lineId].sampleRequirements[f.productionId]).toMatchObject([{ok:true,reason:'有保留通过'}]);
 f.state.orderLines.find(l=>l.id===f.target.lineId)!.cmtIncludedItems=['trims'];
 expect(scopedFabricAccess(f.state,scope,'garment','Garment',true)[f.target.lineId].sampleRequirements?.[f.productionId]).toMatchObject([{ok:false,reason:'未登记'}]);
});
