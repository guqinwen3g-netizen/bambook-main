import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import * as contract from '../shared/mistWorkspace';
import {materialDeliveryFixture} from './__tests__/materialDelivery';
import {MemoryMistDatabase,testActor,testAuthority} from './__tests__/support';
import {MistPrivateFiles} from './files';import {MistRepository} from './repository';
vi.mock('./context',()=>({mistApprovalAuthority:async()=>({supplier:{}})}));
let dir:string;beforeEach(async()=>{dir=await mkdtemp(path.join(tmpdir(),'disposal-finance-'));});afterEach(async()=>{await rm(dir,{recursive:true,force:true});});
it.each([false,true])('shares a minimal financial handoff (recovery=%s) and checks current write permission',async recovery=>{
 const db=new MemoryMistDatabase(),auth=testAuthority(),f=materialDeliveryFixture(20);f.context.members!.push({id:'qc',name:'QC',active:true,groups:[]});const issue=f.issue(20);
 f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id:issue,acceptedQuantity:16,rejectedQuantity:4,expectedReceivingRevision:0,evidence:'counted'}},'garment');
 const stock=f.state.fulfillment.stock[0],returned=f.run({type:'fulfillment.inventory.move',payload:{id:stock.id,kind:'return',issueId:issue,quantity:4,location:'private warehouse',person:'factory',note:'private movement'}}).id!;
 const task=f.run({type:'fulfillment.inventory.quarantine.request',payload:{returnId:returned,due:'2026-10-24'}}).id!;
 f.run({type:'fulfillment.qc.claim',payload:{id:task,domain:'fabric'}},'qc');f.run({type:'fulfillment.qc.report',payload:{id:task,domain:'fabric',result:'reject',report:'R1',opinion:'Failed',location:'private warehouse',reviewedAt:f.context.now,measurements:[],fileIds:[]}},'qc');
 f.run({type:'fulfillment.inventory.quarantine.dispose',payload:{returnId:returned,decision:'scrap',evidence:'Disposed'}});
 if(recovery)f.run({type:'fulfillment.inventory.quarantine.recovery',payload:{returnId:returned,amount:272,reason:'Supplier liable'}},'reviewer');
 else f.run({type:'fulfillment.inventory.quarantine.noRecovery',payload:{returnId:returned,evidence:'manager confirmed'}},'reviewer');
 f.state.payables!.settlements!.push({id:'settlement',purchaseId:f.purchaseId,state:'confirmed',receiptIds:[stock.receiptId]} as any);
 f.state.memberIds!.push('finance');auth.users.set('finance',{active:true,permissions:['invoices:read','vouchers:read','procurement:read']});
 const repo=new MistRepository(db,contract,new MistPrivateFiles(dir),auth.authorize,()=>new Date(f.context.now));const wid=(await repo.create(testActor(),{name:'test',seed:'empty'})).id;db.workspaces.get(wid).state=structuredClone(f.state);
 for(const type of ['fulfillment.inventory.quarantine.recovery','fulfillment.inventory.quarantine.recovery.revoke'] as const){
  const command=type==='fulfillment.inventory.quarantine.recovery'?{type,payload:{returnId:returned,amount:272,reason:'Supplier liable'}}:{type,payload:{returnId:returned,reason:'Recheck'}};
  const request={requestId:type,expectedRevision:0,command};
  // The ordinary write scope and the existing inventory-read compound gate both remain mandatory.
  auth.users.get('owner')!.permissions.push('inventory:read');
  await expect(repo.execute(testActor(),wid,request)).rejects.toMatchObject({status:403});
  auth.users.get('owner')!.permissions.push('aftersales:approve');
  auth.users.get('owner')!.permissions=auth.users.get('owner')!.permissions.filter(p=>p!=='inventory:read');
  await expect(repo.execute(testActor(),wid,request)).rejects.toMatchObject({status:403});
  auth.users.get('owner')!.permissions=auth.users.get('owner')!.permissions.filter(p=>p!=='aftersales:approve');
 }
 const a={...testActor('finance'),roles:[]},before=await repo.get(a,wid);expect(before.state.fulfillment.stockMovements).toEqual([]);expect(before.financialDisposals).toMatchObject([{returnId:returned,decision:recovery?'recovery':'noRecovery',disposalDecision:'scrap',referenceAmount:272,settlementConfirmed:true,...(recovery?{recovery:{amount:272,currency:'CNY',actorId:'reviewer'}}:{noRecovery:{actorId:'reviewer'}})}]);
 expect(JSON.stringify(before.financialDisposals)).not.toContain('private warehouse');
 const cmd={requestId:'review-disposal',expectedRevision:0,command:{type:'payable.disposal.review' as const,payload:{returnId:returned,evidence:'No recovery agreed'}}};
 await expect(repo.execute(a,wid,cmd)).rejects.toMatchObject({status:403});auth.users.get('finance')!.permissions.push('invoices:reconcile');
 await repo.execute(a,wid,cmd);expect((await repo.execute(a,wid,cmd)).replayed).toBe(true);
 expect((await repo.get(a,wid)).financialDisposals?.[0].review?.evidence).toBe('No recovery agreed');
 auth.users.get('owner')!.permissions.push('inventory:read');const warehouse=await repo.get({...testActor(),roles:[]},wid);
 expect(warehouse.state.fulfillment.stockMovements.find(m=>m.id===returned)?.quarantineDisposition?.financeReviews).toBeUndefined();
 auth.users.get('finance')!.permissions=auth.users.get('finance')!.permissions.filter(p=>p!=='vouchers:read');expect((await repo.get(a,wid)).financialDisposals).toBeUndefined();
 await expect(repo.execute(a,wid,{requestId:'blind-review',expectedRevision:1,command:{type:'payable.disposal.review',payload:{returnId:returned,evidence:'blind'}}})).rejects.toMatchObject({status:403});
});
