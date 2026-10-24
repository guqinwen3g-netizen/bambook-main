import {expect,it} from 'vitest';
import {applyMistCommand,createMistState,type MistContext,type MistCommand} from './mistWorkspace';
import {createClaimReturnReceipt,assertClaimGoodsInventorySettled} from './mistClaimInventory';
import type {PlatformClaimGoodsSource} from './mistPlatform';
import * as contract from './mistWorkspace';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MistRepository} from '../mist/repository';
import {MistPrivateFiles} from '../mist/files';
import {MemoryMistDatabase,testActor,testAuthority} from '../mist/__tests__/support';
import {projectState} from '../mist/access';
import {claimLedger} from './mistClaimCoordination';

function fixture(quantity=2,domain:'garment'|'fabric'='garment'){
 let sequence=0;const warehouse:MistContext={id:()=>`repair-${++sequence}`,now:'2026-10-13T08:00:00Z',actorId:'warehouse',actorName:'Warehouse',can:scope=>scope==='inventory:write',consumeBusinessNumber:prefix=>prefix+'-2026-0001'};
 const qc:MistContext={...warehouse,actorId:'qc',actorName:'QC',can:scope=>['qc:inspect',`qc:${domain}_chain:write`].includes(scope)};
 let state=createMistState(warehouse,'empty');state.orders.push({id:'order',type:domain} as any);state.customers.push({id:'customer',name:'Source customer'} as any);state.market.suppliers.push({id:'factory',name:'Repair factory'} as any);state.files.push({id:'proof',name:'repair.pdf',mimeType:'application/pdf',size:1,storageKey:'fixture/proof',createdAt:warehouse.now});
 const source:PlatformClaimGoodsSource={schemaVersion:1,claimId:'case',dispositionId:'disposition',invoiceId:'invoice',documentId:'document',orderId:'order',lineId:'line',shipmentId:'shipment',productionId:'production',customerId:'customer',currency:'USD',name:'Coat',style:'A',unit:'件',quantity,unitPrice:15,sourceQuantity:4,sourceAmount:60,orderApprovedVersion:1};
 state.platform.claims.push({id:'case',code:'CLM-REPAIR',orderId:'order',invoiceId:'invoice',problem:'Repair and return',fileIds:['proof'],state:'Processing',createdAt:warehouse.now,dispositions:[{id:'disposition',kind:'Repair',amount:0,quantity,unit:'件',returnDisposition:'Repair',basis:'Approved repair and handback',fileIds:['proof'],state:'Executed',reviewDecision:'approved',requesterId:'business',reviewerId:'leader',submittedAt:warehouse.now,goodsSource:structuredClone(source),snapshot:JSON.stringify({kind:'Repair',amount:0,quantity,unit:'件',destination:'Repair',basis:'Approved repair and handback',goodsSource:source}),goodsId:'goods'}]});
 state.platform.claimGoods.push({id:'goods',claimId:'case',dispositionId:'disposition',orderId:'order',quantity,unit:'件',destination:'Repair',source:structuredClone(source),state:'AwaitingReturn',events:[]});
 const run=(command:MistCommand,actor=warehouse)=>{const result=applyMistCommand(state,command,actor);state=result.state;return result.result;};
 const warehouseId=run({type:'fulfillment.claimInventory.warehouse.save',payload:{code:'WH',name:'Company warehouse',address:'Physical site',active:true}}).id!;createClaimReturnReceipt(state,'goods',warehouseId,warehouse);
 const receive=(amount=1,batch='LOT-A',ownership:'Owned'|'Transferred'='Transferred')=>run({type:'fulfillment.claimInventory.receive',payload:{goodsId:'goods',quantity:amount,unit:'件',warehouseId,location:'Repair area',batchNumber:batch,ownership,ownershipDate:'2026-10-13',ownershipEvidence:'Customer retains ownership',receivedAt:'2026-10-13',basis:'Actual count and receipt',fileIds:['proof']}});
 const repair=(receivedEventId:string,completedAt='2026-10-13')=>run({type:'fulfillment.claimInventory.repair.record',payload:{goodsId:'goods',receivedEventId,supplierId:'factory',technician:'Technician',completedAt,basis:'On-site seam repair completed',fileIds:['proof']}});
 const check=(repairId:string,result:'pass'|'fail'='pass',actor=qc)=>run({type:'fulfillment.claimInventory.repair.qc',payload:{goodsId:'goods',repairId,result,checkedAt:'2026-10-13',basis:'Inspect repaired seam and compare source specification',fileIds:['proof']}},actor);
 const handback=(repairId:string,date='2026-10-13')=>run({type:'fulfillment.claimInventory.repair.handback',payload:{goodsId:'goods',repairId,date,recipient:'Source customer agent',reference:'HANDOVER-1',basis:'Handed to the source customer agent at warehouse',fileIds:['proof']}});
 return{run,receive,repair,check,handback,qc,warehouse,get state(){return state;},get goods(){return state.platform.claimGoods[0];}};
}

it('requires fresh professional inspection and actual handback for every received lot, preserving ownership, source and money',()=>{
 const f=fixture(),first=f.receive(),second=f.receive(1,'LOT-B');const source=structuredClone(f.goods.source),dispositions=structuredClone(f.state.platform.claims[0].dispositions),cash=structuredClone([f.state.receipts,f.state.payments,f.state.invoices,f.state.payables]);
 const a=f.repair(first.receivedEventId!).id!,b=f.repair(second.receivedEventId!).id!;expect(f.goods.state).toBe('Repairing');expect(claimLedger(f.state,f.state.platform.claims[0]).customerSettled).toBe(false);expect(()=>f.handback(a)).toThrow(/复检合格/);expect(()=>f.run({type:'platform.claim.close',payload:{id:'case'}})).toThrow(/真实放行/);
 f.check(a);f.handback(a);expect(()=>assertClaimGoodsInventorySettled(f.state,'goods')).toThrow(/真实放行/);expect(f.goods.state).not.toBe('HandedBack');
 f.check(b);expect(f.goods.state).toBe('Ready');expect(claimLedger(f.state,f.state.platform.claims[0]).customerSettled).toBe(false);expect(f.state.fulfillment.stock[1]).toMatchObject({onHand:1,locked:1,available:0});f.handback(b);assertClaimGoodsInventorySettled(f.state,'goods');expect(f.goods.state).toBe('HandedBack');expect(claimLedger(f.state,f.state.platform.claims[0]).customerSettled).toBe(true);
 expect(f.state.fulfillment.stock.map(r=>[r.onHand,r.locked,r.available,r.ownership,r.ownerCustomerId])).toEqual([[0,0,0,'Transferred','customer'],[0,0,0,'Transferred','customer']]);expect(f.goods.source).toEqual(source);expect(f.state.platform.claims[0].dispositions).toEqual(dispositions);expect([f.state.receipts,f.state.payments,f.state.invoices,f.state.payables]).toEqual(cash);
 expect(f.state.tasks.filter(t=>t.kind?.startsWith('claim-')).every(t=>t.done)).toBe(true);f.run({type:'platform.claim.close',payload:{id:'case'}});expect(f.state.platform.claims[0].state).toBe('Closed');
});
it('keeps a failed repair isolated, preserves its QC evidence and requires a new inspected repair',()=>{
 const f=fixture(1),received=f.receive(),a=f.repair(received.receivedEventId!).id!;f.check(a,'fail');const old=structuredClone(f.goods.repairs![0]);expect(()=>f.handback(a)).toThrow(/复检合格/);expect(f.state.fulfillment.stock[0]).toMatchObject({onHand:1,locked:1,available:0});
 const b=f.repair(received.receivedEventId!).id!;expect(()=>f.handback(a)).toThrow(/最新维修/);expect(()=>f.handback(b)).toThrow(/复检合格/);f.check(b);f.handback(b);expect(f.goods.repairs![0]).toEqual(old);expect(f.goods.repairs![1].handback?.customerId).toBe('customer');
});
it.each(['fabric','garment'] as const)('lets only the corresponding %s QC inspect, and cannot overwrite an existing verdict',domain=>{
 const f=fixture(1,domain),received=f.receive(),id=f.repair(received.receivedEventId!).id!,before=structuredClone(f.state);
 expect(()=>f.check(id,'pass',f.warehouse)).toThrow(/对应业务线QC/);expect(f.state).toEqual(before);
 const wrong={...f.qc,can:(scope:string)=>['qc:inspect',`qc:${domain==='fabric'?'garment':'fabric'}_chain:write`].includes(scope)};expect(()=>f.check(id,'pass',wrong)).toThrow(/对应业务线QC/);expect(f.state).toEqual(before);
 f.check(id);expect(()=>f.check(id,'fail')).toThrow(/不能覆盖/);expect(f.goods.repairs![0].qc?.result).toBe('pass');
});
it('refuses future dates, wrong batches, duplicate handback and uninspected replacement attempts atomically',()=>{
 const f=fixture(1),received=f.receive(),before=structuredClone(f.state);expect(()=>f.repair(received.receivedEventId!,'2026-10-14')).toThrow(/业务日期/);expect(()=>f.repair('foreign')).toThrow(/真实返修批次/);expect(f.state).toEqual(before);
 const id=f.repair(received.receivedEventId!).id!;expect(()=>f.repair(received.receivedEventId!)).toThrow(/尚待复检/);f.check(id);expect(()=>f.handback(id,'2026-10-12')).toThrow(/业务日期/);f.handback(id);const after=structuredClone(f.state);expect(()=>f.handback(id)).toThrow(/不能重复/);expect(()=>f.repair(received.receivedEventId!)).toThrow(/不能重复/);expect(f.state).toEqual(after);
});
it('does not hand company-owned goods to a customer through the customer-custody repair path',()=>{const f=fixture(1),before=structuredClone(f.state);expect(()=>f.receive(1,'OWNED','Owned')).toThrow(/来源客户货权/);expect(f.state).toEqual(before);});
it('invalidates an earlier passing inspection when another repair is recorded, without overwriting that inspection',()=>{
 const f=fixture(1),received=f.receive(),first=f.repair(received.receivedEventId!).id!;f.check(first);const old=structuredClone(f.goods.repairs![0]),next=f.repair(received.receivedEventId!).id!;expect(()=>f.handback(first)).toThrow(/最新维修/);expect(()=>f.handback(next)).toThrow(/复检合格/);expect(f.goods.repairs![0]).toEqual(old);f.check(next);f.handback(next);assertClaimGoodsInventorySettled(f.state,'goods');
});
it('refuses a company file from another case as repair evidence without changing the job or stock',()=>{
 const f=fixture(1),received=f.receive();f.state.files.push({id:'foreign-case-proof',name:'other.pdf',mimeType:'application/pdf',size:1,storageKey:'fixture/other',createdAt:f.warehouse.now});const before=structuredClone(f.state);expect(()=>f.run({type:'fulfillment.claimInventory.repair.record',payload:{goodsId:'goods',receivedEventId:received.receivedEventId!,supplierId:'factory',technician:'Technician',completedAt:'2026-10-13',basis:'Repair',fileIds:['foreign-case-proof']}})).toThrow(/归入本案件/);expect(f.state).toEqual(before);
});
it.each(['movement','qc','customer','source','link'] as const)('fails closed on damaged %s handback facts',damage=>{
 const f=fixture(1),received=f.receive(),id=f.repair(received.receivedEventId!).id!;f.check(id);f.handback(id);const job=f.goods.repairs![0];if(damage==='movement')f.state.fulfillment.stockMovements.pop();if(damage==='qc')job.qc!.result='fail';if(damage==='customer')job.handback!.customerId='foreign';if(damage==='source')job.stockId='foreign';if(damage==='link')delete f.state.fulfillment.receivedRecords[0].releasedRepairId;expect(()=>assertClaimGoodsInventorySettled(f.state,'goods')).toThrow();
});
it('lets QC read the repair job and inspect through the repository without granting warehouse reads or writes',async()=>{
 const f=fixture(1),received=f.receive(),id=f.repair(received.receivedEventId!).id!,directory=await mkdtemp(path.join(tmpdir(),'mist-repair-access-'));
 const actor={...testActor(),roles:[],authorizationLoaded:true};
 try{
  const db=new MemoryMistDatabase(),auth=testAuthority();auth.users.get('owner')!.permissions=['aftersales:read','qc:inspect','qc:garment_chain:write'];
  const repo=new MistRepository(db,{...contract,createMistState:()=>structuredClone(f.state)},new MistPrivateFiles(directory),auth.authorize),workspace=await repo.create(actor,{name:'Repair access',seed:'empty'});
  const raw=(await repo.get(actor,workspace.id)).state,projected=projectState(raw,{...testActor(),roles:[],permissions:auth.users.get('owner')!.permissions,authorizationLoaded:true},()=>createMistState(f.warehouse,'empty')).state;expect(projected.platform.claimGoods[0].repairs![0].id).toBe(id);expect(projected.fulfillment.stock).toEqual([]);expect(projected.fulfillment.receivedRecords).toEqual([]);
  const command:MistCommand={type:'fulfillment.claimInventory.repair.qc',payload:{goodsId:'goods',repairId:id,result:'pass',checkedAt:'2026-10-13',basis:'Actual QC inspection',fileIds:['proof']}};
  const accepted=await repo.execute(actor,workspace.id,{requestId:'qc-repair',expectedRevision:0,command});expect(accepted.workspace.state.platform.claimGoods[0].repairs![0].qc?.result).toBe('pass');
  expect((await repo.execute(actor,workspace.id,{requestId:'qc-repair',expectedRevision:0,command})).replayed).toBe(true);
  await expect(repo.execute(actor,workspace.id,{requestId:'warehouse-denied',expectedRevision:1,command:{type:'fulfillment.claimInventory.repair.handback',payload:{goodsId:'goods',repairId:id,date:'2026-10-13',recipient:'Agent',reference:'DOC',basis:'Actual handover',fileIds:[]}}})).rejects.toMatchObject({status:403});
  auth.users.get('owner')!.permissions=['aftersales:read','qc:inspect','qc:fabric_chain:write'];await expect(repo.execute(actor,workspace.id,{requestId:'wrong-domain',expectedRevision:1,command})).rejects.toMatchObject({status:403});
 }finally{await rm(directory,{recursive:true,force:true});}
});
