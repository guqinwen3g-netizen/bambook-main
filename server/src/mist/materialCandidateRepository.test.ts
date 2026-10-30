import {afterEach,beforeEach,expect,it,vi} from 'vitest';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import * as contract from '../shared/mistWorkspace';import {materialDeliveryFixture} from './__tests__/materialDelivery';import {MemoryMistDatabase,testActor,testAuthority} from './__tests__/support';import {MistPrivateFiles} from './files';import {MistRepository} from './repository';
vi.mock('./context',()=>({mistApprovalAuthority:async()=>({supplier:{}})}));let dir:string;beforeEach(async()=>{dir=await mkdtemp(path.join(tmpdir(),'fabric-candidate-'));});afterEach(async()=>{await rm(dir,{recursive:true,force:true});});
it('lets the exact recipient allocate and receive a hidden source without exposing its order or other targets',async()=>{
 const company='11111111-1111-4111-8111-111111111111',db=new MemoryMistDatabase(),auth=testAuthority(),f=materialDeliveryFixture(20),wid=randomUUID();
 const source=f.create('fabric'),secret=f.create('fabric');f.state.orders.find(o=>o.id===secret.orderId)!.governance!.contract.internalSupply!.receiverId='warehouse';
 const purchaseId=f.purchase('finished',source),production=f.state.productions.find(p=>p.sourcePurchaseId===purchaseId)!;
 f.run({type:'fulfillment.procurement.receive',payload:{id:purchaseId,quantity:20,rejected:0,destination:'warehouse',location:'New warehouse',date:'2026-10-24',evidence:'Received',fileIds:[]}});
 const stock=f.state.fulfillment.stock.find(s=>s.purchaseId===purchaseId)!,fact=f.state.fulfillment.productionFacts.find(x=>x.productionId===production.id)!;
 f.state.fulfillment.qcTasks.push({id:'new-qc',code:'NEW-QC',source:{kind:'orderLine',...source,productionId:production.id},domain:'fabric',kind:'production',factory:'mill',location:'warehouse',contact:'',due:'2026-10-24',requestedBy:'Fabric',assignee:'QC',assigneeId:'qc',state:'reported',reportIds:['new-report'],createdAt:f.context.now});
 f.state.fulfillment.qcReports.push({id:'new-report',taskId:'new-qc',result:'pass',report:'NEW-PASS',opinion:'Checked',measurements:[],fileIds:[],reviewer:'QC',reviewedAt:f.context.now,scopeRevision:fact.revision});
 auth.users.set('owner',{active:true,permissions:['inventory:read','inventory:write','orders:read','procurement:read']});auth.users.set('garment',{active:true,permissions:['orders:read','orders:write','procurement:read']});
 for(const id of ['owner','garment','reviewer','warehouse']){db.companyMembers.push({companyId:company,userId:id,status:'active'});db.accounts.set(id,{status:'active',displayName:id});}
 db.workspaces.set(wid,{id:wid,ownerId:'boss',companyId:company,slug:`company@${company}`,name:'公司',revision:0,state:structuredClone(f.state),createdAt:new Date(),updatedAt:new Date()});
 const repo=new MistRepository(db,contract,new MistPrivateFiles(dir),auth.authorize,()=>new Date(f.context.now)),buyer={...testActor('garment'),roles:[],companyId:company},sender={...testActor('owner'),roles:[],companyId:company};
 const before=await repo.get(buyer,wid);expect(before.state.orders.some(o=>o.id===source.orderId)).toBe(false);expect(before.scopedFabricAccess?.[f.target.lineId].candidates).toEqual(expect.arrayContaining([expect.objectContaining({fabricOrderId:source.orderId,fabricLineId:source.lineId})]));
 expect(before.scopedFabricAccess?.[f.target.lineId].sampleRequirements).toEqual({});
 auth.users.set('garment',{active:true,permissions:['orders:read','orders:write','procurement:read','production:read','products:read','qc:read']});
 expect((await repo.get(buyer,wid)).scopedFabricAccess?.[f.target.lineId].sampleRequirements[f.productionId]).toMatchObject([{ok:false,reason:'未登记'}]);
 auth.users.set('garment',{active:true,permissions:['orders:read','orders:write','procurement:read']});
 expect(before.scopedFabricAccess?.[f.target.lineId].candidates.some(c=>c.fabricOrderId===secret.orderId)).toBe(false);
 const allocation=f.state.internalFabricAllocations![0];await expect(repo.execute(buyer,wid,{requestId:'allocate-forged',expectedRevision:0,command:{type:'order.fabric.allocate',payload:{...f.target,fabricOrderId:secret.orderId,fabricLineId:secret.lineId,metres:'4',expectedRevision:allocation.revision}}})).rejects.toMatchObject({status:404});
 await repo.execute(buyer,wid,{requestId:'allocate-new',expectedRevision:0,command:{type:'order.fabric.allocate',payload:{...f.target,fabricOrderId:source.orderId,fabricLineId:source.lineId,metres:'4',expectedRevision:allocation.revision}}});
 const sent=await repo.execute(sender,wid,{requestId:'send-new',expectedRevision:1,command:{type:'fulfillment.materials.issue',payload:{id:stock.id,targetProductionId:f.productionId,quantity:4,location:'Factory',person:'receiver',note:'handover'}}});
 const issueId=sent.receipt.result.id,withIncoming=await repo.get(buyer,wid);expect(withIncoming.state.fulfillment.stock.some(s=>s.id===stock.id)).toBe(false);expect(withIncoming.scopedFabricAccess?.[f.target.lineId].deliveries).toEqual([expect.objectContaining({id:issueId,sourcePurchaseCode:expect.any(String)})]);
 await repo.execute(buyer,wid,{requestId:'receive-new',expectedRevision:2,command:{type:'fulfillment.materials.confirm',payload:{id:issueId,kind:'issue',acceptedQuantity:4,rejectedQuantity:0,expectedReceivingRevision:0,evidence:'Counted'}}});
 expect((await repo.get(buyer,wid)).scopedFabricAccess?.[f.target.lineId].deliveries[0]).toMatchObject({accepted:'4',pending:'0'});
});
