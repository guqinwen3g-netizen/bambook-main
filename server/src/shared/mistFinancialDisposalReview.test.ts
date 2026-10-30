import {expect,it} from 'vitest';
import {materialDeliveryFixture} from '../mist/__tests__/materialDelivery';
import {financialDisposalViews} from './mistPayables';
import {mistCommandPermission} from './mistWorkspace';

function fixture(){
 const f=materialDeliveryFixture(20);f.context.members!.push({id:'qc',name:'QC',active:true,groups:[]});const issue=f.issue(20);
 f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id:issue,acceptedQuantity:16,rejectedQuantity:4,expectedReceivingRevision:0,evidence:'Counted'}},'garment');
 const stock=f.state.fulfillment.stock[0],returned=f.run({type:'fulfillment.inventory.move',payload:{id:stock.id,kind:'return',issueId:issue,quantity:4,location:'Hold',person:'warehouse',note:'Rejected'}}).id!;
 const task=f.run({type:'fulfillment.inventory.quarantine.request',payload:{returnId:returned,due:'2026-10-24'}}).id!;
 f.run({type:'fulfillment.qc.claim',payload:{id:task,domain:'fabric'}},'qc');f.run({type:'fulfillment.qc.report',payload:{id:task,domain:'fabric',result:'reject',report:'Q-FAIL',opinion:'Defect',location:'Hold',reviewedAt:f.context.now,measurements:[],fileIds:[]}},'qc');
 f.run({type:'fulfillment.inventory.quarantine.dispose',payload:{returnId:returned,decision:'supplierReturn',evidence:'Supplier received'}});
 f.run({type:'fulfillment.inventory.quarantine.noRecovery',payload:{returnId:returned,evidence:'主管确认无补偿'}},'reviewer');
 f.state.payables!.settlements!.push({id:'st',purchaseId:f.purchaseId,state:'confirmed',receiptIds:[stock.receiptId]} as any);
 return {f,returned};
}
it('confirms no recovery once, without creating another expense or altering any paid financial facts',()=>{
 const {f,returned}=fixture(),view=()=>financialDisposalViews(f.state,new Set([f.purchaseId]));
 expect(view()).toMatchObject([{returnId:returned,referenceAmount:272,decision:'supplierReturn'}]);
 expect(financialDisposalViews(f.state,new Set())).toEqual([]);
 const before=structuredClone({payables:f.state.payables,payments:f.state.payments,receipts:f.state.fulfillment.receipts,stock:f.state.fulfillment.stock});
 expect(mistCommandPermission({type:'payable.disposal.review',payload:{returnId:returned,evidence:'No compensation agreed'}})).toBe('invoices:reconcile');
 expect(mistCommandPermission({type:'fulfillment.inventory.quarantine.noRecovery',payload:{returnId:returned,evidence:'manager'}})).toBe('aftersales:approve');
 f.run({type:'payable.disposal.review',payload:{returnId:returned,evidence:'No compensation agreed'}});
 expect(view()[0].review?.evidence).toBe('No compensation agreed');
 expect(()=>f.run({type:'fulfillment.inventory.quarantine.noRecovery.revoke',payload:{returnId:returned,reason:'误操作'}},'reviewer')).toThrow('请先撤回');
 expect({payables:f.state.payables,payments:f.state.payments,receipts:f.state.fulfillment.receipts,stock:f.state.fulfillment.stock}).toEqual(before);
 expect(()=>f.run({type:'payable.disposal.review',payload:{returnId:returned,evidence:'duplicate'}})).toThrow('已核对');
 const id=view()[0].review!.id;f.run({type:'payable.disposal.reverse',payload:{returnId:returned,reviewId:id,reason:'更正依据'}});
 expect(view()[0].review).toBeUndefined();f.run({type:'payable.disposal.review',payload:{returnId:returned,evidence:'Reviewed again'}});
 expect(f.state.fulfillment.stockMovements.find(m=>m.id===returned)?.quarantineDisposition?.financeReviews).toHaveLength(2);
});
it('requires actual disposition and an established settlement before financial review',()=>{
 const {f,returned}=fixture();f.state.payables!.settlements=[];
 expect(()=>f.run({type:'payable.disposal.review',payload:{returnId:returned,evidence:'No recovery'}})).toThrow('已确认结算');
});
it('requires a separate manager decision and disallows self-review',()=>{
 const {f,returned}=fixture();
 expect(()=>f.run({type:'payable.disposal.review',payload:{returnId:returned,evidence:'same actor'}},'reviewer')).toThrow('不能复核');
 f.run({type:'fulfillment.inventory.quarantine.noRecovery.revoke',payload:{returnId:returned,reason:'重新核实'}},'reviewer');
 expect(()=>f.run({type:'payable.disposal.review',payload:{returnId:returned,evidence:'missing decision'}})).toThrow('负责人');
});
