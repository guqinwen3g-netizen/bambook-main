import {expect,it} from 'vitest';
import {materialDeliveryFixture} from '../mist/__tests__/materialDelivery';
import {disposalReviewBlocker,financialDisposalViews,openQuarantineRecoveries} from './mistPayables';
import {mistCommandPermission} from './mistWorkspace';

function fixture(recovery=false){
 const f=materialDeliveryFixture(20);f.context.members!.push({id:'qc',name:'QC',active:true,groups:[]});const issue=f.issue(20);
 f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id:issue,acceptedQuantity:16,rejectedQuantity:4,expectedReceivingRevision:0,evidence:'Counted'}},'garment');
 const stock=f.state.fulfillment.stock[0],returned=f.run({type:'fulfillment.inventory.move',payload:{id:stock.id,kind:'return',issueId:issue,quantity:4,location:'Hold',person:'warehouse',note:'Rejected'}}).id!;
 const task=f.run({type:'fulfillment.inventory.quarantine.request',payload:{returnId:returned,due:'2026-10-24'}}).id!;
 f.run({type:'fulfillment.qc.claim',payload:{id:task,domain:'fabric'}},'qc');f.run({type:'fulfillment.qc.report',payload:{id:task,domain:'fabric',result:'reject',report:'Q-FAIL',opinion:'Defect',location:'Hold',reviewedAt:f.context.now,measurements:[],fileIds:[]}},'qc');
 f.run({type:'fulfillment.inventory.quarantine.dispose',payload:{returnId:returned,decision:'supplierReturn',evidence:'Supplier received'}});
 if(!recovery)f.run({type:'fulfillment.inventory.quarantine.noRecovery',payload:{returnId:returned,evidence:'主管确认无补偿'}},'reviewer');
 f.state.payables!.settlements!.push({id:'st',purchaseId:f.purchaseId,state:'confirmed',disputes:[],receiptIds:[stock.receiptId]} as any);
 return {f,returned};
}
it('confirms no recovery once, without creating another expense or altering any paid financial facts',()=>{
 const {f,returned}=fixture(),view=()=>financialDisposalViews(f.state,new Set([f.purchaseId]));
 expect(view()).toMatchObject([{returnId:returned,referenceAmount:272,decision:'noRecovery',disposalDecision:'supplierReturn'}]);
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
 const row=f.state.fulfillment.stockMovements.find(r=>r.id===returned)!,stock=f.state.fulfillment.stock.find(s=>s.id===row.stockId)!;
 const record={purchaseId:f.purchaseId,receiptId:stock.receiptId};
 expect(disposalReviewBlocker(f.state,record)).toBe('待结算确认');
 expect(financialDisposalViews(f.state,new Set([f.purchaseId]))[0].settlementConfirmed).toBe(false);
 expect(()=>f.run({type:'payable.disposal.review',payload:{returnId:returned,evidence:'No recovery'}})).toThrow('已确认结算');
 f.state.payables.settlements!.push({id:'wrong',purchaseId:f.purchaseId,state:'confirmed',receiptIds:['other-batch']} as any);
 expect(disposalReviewBlocker(f.state,record)).toBe('待结算确认');
 f.state.payables.settlements![0].receiptIds=[stock.receiptId!];
 expect(disposalReviewBlocker(f.state,record)).toBe('');
 const projection=financialDisposalViews(f.state,new Set([f.purchaseId]))[0];
 expect(projection.settlementConfirmed).toBe(true);
 const hidden=structuredClone(f.state);hidden.fulfillment.stock=[];hidden.fulfillment.stockMovements=[];hidden.payables.settlements=[];
 expect(disposalReviewBlocker(hidden,projection)).toBe('');
 f.state.payables.settlements![0].state='reversed';expect(disposalReviewBlocker(f.state,record)).toBe('待结算确认');
});
it('requires a separate manager decision and disallows self-review',()=>{
 const {f,returned}=fixture();
 expect(()=>f.run({type:'payable.disposal.review',payload:{returnId:returned,evidence:'same actor'}},'reviewer')).toThrow('不能复核');
 f.run({type:'fulfillment.inventory.quarantine.noRecovery.revoke',payload:{returnId:returned,reason:'重新核实'}},'reviewer');
 expect(()=>f.run({type:'payable.disposal.review',payload:{returnId:returned,evidence:'missing decision'}})).toThrow('负责人');
});

it.each([272,199.99])('records reference or adjusted recovery %s in the purchase currency, mutually exclusive with no recovery',amount=>{
 const {f,returned}=fixture(true),views=()=>financialDisposalViews(f.state,new Set([f.purchaseId]));
 expect(views()[0].referenceAmount).toBe(272);
 const cmd={type:'fulfillment.inventory.quarantine.recovery' as const,payload:{returnId:returned,amount,reason:'Supplier liable'}};
 expect(mistCommandPermission(cmd)).toBe('aftersales:approve');
 f.run(cmd,'reviewer');
 expect(views()[0]).toMatchObject({decision:'recovery',decisionAmount:amount,disposalDecision:'supplierReturn',recovery:{amount,currency:'CNY',actorId:'reviewer',reason:'Supplier liable'}});
 expect(()=>f.run(cmd,'reviewer')).toThrow('已有');
 expect(()=>f.run({type:'fulfillment.inventory.quarantine.noRecovery',payload:{returnId:returned,evidence:'Waived'}},'reviewer')).toThrow('已有追偿');
 const revoke={type:'fulfillment.inventory.quarantine.recovery.revoke' as const,payload:{returnId:returned,reason:'Correction'}};
 expect(mistCommandPermission(revoke)).toBe('aftersales:approve');f.run(revoke,'reviewer');
 expect(views()[0].recovery).toBeUndefined();
 expect(f.state.fulfillment.stockMovements.find(m=>m.id===returned)!.quarantineDisposition!.recoveryHistory).toMatchObject([{amount,revokeReason:'Correction'}]);
 f.run({type:'fulfillment.inventory.quarantine.noRecovery',payload:{returnId:returned,evidence:'Waived'}},'reviewer');
 expect(()=>f.run(cmd,'reviewer')).toThrow('已有');
});
it.each([0,-1,0.001,NaN,Infinity])('rejects invalid recovery amount %s',amount=>{
 const {f,returned}=fixture(true);
 expect(()=>f.run({type:'fulfillment.inventory.quarantine.recovery',payload:{returnId:returned,amount,reason:'Invalid'}},'reviewer')).toThrow();
 expect(openQuarantineRecoveries(f.state,f.purchaseId)).toEqual([]);
});
it.each(['cancel','return'] as const)('automatically carries recovery once and releases it on settlement %s',action=>{
 const {f,returned}=fixture(true);f.state.payables!.settlements=[];
 f.run({type:'fulfillment.inventory.quarantine.recovery',payload:{returnId:returned,amount:272,reason:'Defect cost'}},'reviewer');
 const recovery=openQuarantineRecoveries(f.state,f.purchaseId)[0];
 expect(openQuarantineRecoveries(f.state,f.processingId)).toEqual([]);
 const receiptId=f.state.fulfillment.stock[0].receiptId!;
 const submit=()=>f.run({type:'payable.settlement.submit',payload:{purchaseId:f.purchaseId,receiptIds:[receiptId],disputes:[{description:'Other',amount:1}]}}).id!;
 const id=submit();
 expect(f.state.payables!.settlements!.at(-1)!.disputes).toMatchObject([{description:'Other',amount:1},{amount:272,quarantineRecoveryId:recovery.id}]);
 expect(openQuarantineRecoveries(f.state,f.purchaseId)).toEqual([]);
 expect(()=>submit()).toThrow('待财务复核');
 expect(()=>f.run({type:'fulfillment.inventory.quarantine.recovery.revoke',payload:{returnId:returned,reason:'Correction'}},'reviewer')).toThrow('已带入结算');
 f.run({type:action==='cancel'?'payable.settlement.cancel':'payable.settlement.return',payload:{id,reason:'Recheck'}},action==='cancel'?'owner':'reviewer');
 expect(openQuarantineRecoveries(f.state,f.purchaseId)).toHaveLength(1);
 const next=submit();expect(f.state.payables!.settlements!.at(-1)!.disputes.filter(d=>d.quarantineRecoveryId===recovery.id)).toHaveLength(1);
 f.run({type:'payable.settlement.confirm',payload:{id:next,prepaymentApplied:0}},'reviewer');
 expect(openQuarantineRecoveries(f.state,f.purchaseId)).toEqual([]);
 expect(()=>f.run({type:'fulfillment.inventory.quarantine.recovery.revoke',payload:{returnId:returned,reason:'Correction'}},'reviewer')).toThrow('已带入结算');
});
it('requires independent finance to review recovery, and reversal before revocation',()=>{
 const {f,returned}=fixture(true);
 f.run({type:'fulfillment.inventory.quarantine.recovery',payload:{returnId:returned,amount:200,reason:'Supplier compensation'}},'reviewer');
 expect(()=>f.run({type:'payable.disposal.review',payload:{returnId:returned,evidence:'Self review'}},'reviewer')).toThrow('不能复核');
 const id=f.run({type:'payable.disposal.review',payload:{returnId:returned,evidence:'Recovery verified'}}).id!;
 expect(f.state.fulfillment.stockMovements.find(m=>m.id===returned)!.quarantineDisposition!.financeReviews).toMatchObject([{id,outcome:'recovery'}]);
 expect(()=>f.run({type:'fulfillment.inventory.quarantine.recovery.revoke',payload:{returnId:returned,reason:'Correction'}},'reviewer')).toThrow('财务核对');
 f.run({type:'payable.disposal.reverse',payload:{returnId:returned,reviewId:id,reason:'Recheck'}});
 f.run({type:'fulfillment.inventory.quarantine.recovery.revoke',payload:{returnId:returned,reason:'Correction'}},'reviewer');
 expect(openQuarantineRecoveries(f.state,f.purchaseId)).toEqual([]);
});

it('does not carry an already confirmed recovery into the following partial settlement',()=>{
 const {f,returned}=fixture(true);f.state.payables!.settlements=[];
 // Split the in-memory accepted receipt into two batches of the same approved purchase.
 const receipt=f.state.fulfillment.receipts.find(r=>r.id===f.state.fulfillment.stock[0].receiptId)!;
 receipt.quantity=10;f.state.fulfillment.receipts.push({...structuredClone(receipt),id:'second-receipt',quantity:10});
 const reference=financialDisposalViews(f.state,new Set([f.purchaseId]))[0].referenceAmount;
 f.run({type:'fulfillment.inventory.quarantine.recovery',payload:{returnId:returned,amount:reference,reason:'Defect cost'}},'reviewer');
 const first=f.run({type:'payable.settlement.submit',payload:{purchaseId:f.purchaseId,receiptIds:[receipt.id]}}).id!;
 f.run({type:'payable.settlement.confirm',payload:{id:first,prepaymentApplied:0}},'reviewer');
 f.run({type:'payable.settlement.submit',payload:{purchaseId:f.purchaseId,receiptIds:['second-receipt']}});
 expect(f.state.payables!.settlements![0].disputes.filter(d=>d.quarantineRecoveryId)).toHaveLength(1);
 expect(f.state.payables!.settlements![1].disputes.filter(d=>d.quarantineRecoveryId)).toHaveLength(0);
});
it('releases a returned settlement recovery for revocation and a new decision',()=>{
 const {f,returned}=fixture(true);f.state.payables!.settlements=[];
 const decide=()=>f.run({type:'fulfillment.inventory.quarantine.recovery',payload:{returnId:returned,amount:272,reason:'Supplier liable'}},'reviewer');
 decide();const previous=openQuarantineRecoveries(f.state,f.purchaseId)[0].id;
 const id=f.run({type:'payable.settlement.submit',payload:{purchaseId:f.purchaseId,receiptIds:[f.state.fulfillment.stock[0].receiptId!]}}).id!;
 f.run({type:'payable.settlement.return',payload:{id,reason:'Reassess amount'}},'reviewer');
 f.run({type:'fulfillment.inventory.quarantine.recovery.revoke',payload:{returnId:returned,reason:'Reassess'}},'reviewer');
 decide();expect(openQuarantineRecoveries(f.state,f.purchaseId)[0].id).not.toBe(previous);
});
