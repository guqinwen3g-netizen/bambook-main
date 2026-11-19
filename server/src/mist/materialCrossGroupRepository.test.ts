import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import * as contract from '../shared/mistWorkspace';
import {materialDeliveryFixture} from './__tests__/materialDelivery';
import {MemoryMistDatabase,testActor,testAuthority} from './__tests__/support';
import {MistPrivateFiles} from './files';
import {MistRepository} from './repository';
vi.mock('./context',()=>({mistApprovalAuthority:async()=>({supplier:{}})}));
let dir:string;beforeEach(async()=>{dir=await mkdtemp(path.join(tmpdir(),'material-scope-'));});afterEach(async()=>{await rm(dir,{recursive:true,force:true});});
it('allows only an allocated cross-group destination, without granting target order access',async()=>{
 const company='11111111-1111-4111-8111-111111111111',db=new MemoryMistDatabase(),auth=testAuthority(),f=materialDeliveryFixture(20),wid=randomUUID();
 const other=f.create('garment'),otherPurchase=f.purchase('processing',other),otherBranch=f.state.productions.find(p=>p.sourcePurchaseId===otherPurchase)!.id;
 auth.users.set('owner',{active:true,permissions:['inventory:read','inventory:write','orders:read','procurement:read']});auth.users.set('garment',{active:true,permissions:['orders:read','orders:write']});
 for(const id of ['owner','garment','reviewer','warehouse']){db.companyMembers.push({companyId:company,userId:id,status:'active'});db.accounts.set(id,{status:'active',displayName:id});}
 db.workspaces.set(wid,{id:wid,ownerId:'boss',companyId:company,slug:`company@${company}`,name:'公司',revision:0,state:structuredClone(f.state),createdAt:new Date(),updatedAt:new Date()});
 const repo=new MistRepository(db,contract,new MistPrivateFiles(dir),auth.authorize,()=>new Date(f.context.now));
 const actor={...testActor('owner'),roles:[],companyId:company};const before=await repo.get(actor,wid),stock=f.state.fulfillment.stock[0];
 expect(before.state.orders.some(o=>o.id===f.target.orderId)).toBe(false);
 expect(before.materialIssueTargets?.[stock.id]).toEqual([expect.objectContaining({value:f.productionId})]);
 const sourcePermissions=auth.users.get('owner')!.permissions;auth.users.get('owner')!.permissions=sourcePermissions.filter(p=>p!=='inventory:write');
 expect((await repo.get(actor,wid)).materialIssueTargets).toBeUndefined();
 auth.users.get('owner')!.permissions=sourcePermissions;
 const input={requestId:'cross-issue',expectedRevision:0,command:{type:'fulfillment.materials.issue' as const,payload:{id:stock.id,targetProductionId:f.productionId,quantity:5,location:'factory',person:'receiver',note:'dispatch'}}};
 await repo.execute(actor,wid,input);
 const after=await repo.get(actor,wid),movement=after.state.fulfillment.stockMovements.find(m=>m.kind==='issue');
 expect(movement).toMatchObject({stockId:stock.id,quantity:5});expect(movement?.materialDelivery).toBeUndefined();
 expect(JSON.stringify(movement)).not.toMatch(/factory|receiver|dispatch/);
 expect(after.state.orders.some(o=>o.id===f.target.orderId)).toBe(false);
 expect(after.state.fulfillment.purchases.some(p=>p.id===f.processingId)).toBe(false);
 await expect(repo.execute(actor,wid,{requestId:'bad-destination',expectedRevision:1,command:{...input.command,payload:{...input.command.payload,targetProductionId:otherBranch}}})).rejects.toMatchObject({status:404});
 expect((await repo.get(actor,wid)).state.fulfillment.stock.find(s=>s.id===stock.id)?.available).toBe(15);
});

it.each(['fulfillment.materials.deliver','fulfillment.procurement.receive'] as const)('offers a minimal direct destination and accepts only that handoff through %s',async type=>{
 const company='11111111-1111-4111-8111-111111111111',db=new MemoryMistDatabase(),auth=testAuthority(),f=materialDeliveryFixture(20,false),wid=randomUUID();
 const other=f.create('garment'),otherPurchase=f.purchase('processing',other),otherBranch=f.state.productions.find(p=>p.sourcePurchaseId===otherPurchase)!.id;
 auth.users.set('owner',{active:true,permissions:['procurement:read','procurement:write','orders:read']});
 for(const id of ['owner','garment','reviewer','warehouse']){db.companyMembers.push({companyId:company,userId:id,status:'active'});db.accounts.set(id,{status:'active',displayName:id});}
 db.workspaces.set(wid,{id:wid,ownerId:'boss',companyId:company,slug:`company@${company}`,name:'公司',revision:0,state:structuredClone(f.state),createdAt:new Date(),updatedAt:new Date()});
 const repo=new MistRepository(db,contract,new MistPrivateFiles(dir),auth.authorize,()=>new Date(f.context.now)),actor={...testActor('owner'),roles:[],companyId:company};
 const before=await repo.get(actor,wid);expect((before as any).materialDeliveryTargets?.[f.purchaseId]).toEqual([{value:f.productionId,label:expect.any(String),remaining:'20'}]);
 for(const state of [before.state]){expect(state.orders.some(o=>o.id===f.target.orderId)).toBe(false);expect(state.productions.some(p=>p.id===f.productionId)).toBe(false);expect(state.fulfillment.purchases.some(p=>p.id===f.processingId)).toBe(false);}
 const permissions=auth.users.get('owner')!.permissions;auth.users.get('owner')!.permissions=permissions.filter(p=>p!=='procurement:write');expect((await repo.get(actor,wid) as any).materialDeliveryTargets).toBeUndefined();auth.users.get('owner')!.permissions=permissions;
 const uploadInput={requestId:'direct-proof-upload',expectedRevision:0},file={name:'handoff.txt',mimeType:'text/plain',bytes:Buffer.from('delivery proof')};const uploaded=await repo.upload(actor,wid,uploadInput,file);expect(uploaded.workspace.state.files.some(f=>f.name==='handoff.txt')).toBe(true);expect((await repo.upload(actor,wid,uploadInput,file)).workspace.revision).toBe(1);
 const command={type,payload:{id:f.purchaseId,quantity:5,rejected:0,destination:'supplier',targetProductionId:f.productionId,location:'factory',date:'2026-10-24',evidence:'Direct note',fileIds:[]}} as any;
 await repo.execute(actor,wid,{requestId:'direct',expectedRevision:1,command});const raw=db.workspaces.get(wid)!.state;
 expect(raw.fulfillment.receipts).toHaveLength(1);expect(raw.fulfillment.receipts[0]).toMatchObject({quantity:5,materialDelivery:{productionId:f.productionId,receiverId:'garment'}});expect(raw.fulfillment.stock).toHaveLength(0);
 const after=await repo.get(actor,wid);expect(after.state.orders.some(o=>o.id===f.target.orderId)).toBe(false);expect(after.state.fulfillment.purchases.some(p=>p.id===f.processingId)).toBe(false);expect((after as any).materialDeliveryTargets[f.purchaseId][0].remaining).toBe('15');
 expect((after as any).materialDeliveryTargets[f.purchaseId][0].blocker).toContain('质量门禁');await expect(repo.execute(actor,wid,{requestId:'quality-blocked',expectedRevision:2,command})).rejects.toMatchObject({status:422});expect(db.workspaces.get(wid)!.state.fulfillment.receipts).toHaveLength(1);
 await expect(repo.execute(actor,wid,{requestId:'not-allocated',expectedRevision:2,command:{...command,payload:{...command.payload,targetProductionId:otherBranch}}})).rejects.toMatchObject({status:404});
 db.workspaces.get(wid)!.state.internalFabricAllocations[0].status='cancelled';expect((await repo.get(actor,wid) as any).materialDeliveryTargets[f.purchaseId]).toEqual([]);await expect(repo.execute(actor,wid,{requestId:'stale-target',expectedRevision:2,command})).rejects.toMatchObject({status:404});expect(db.workspaces.get(wid)!.state.fulfillment.receipts).toHaveLength(1);
});

it('lets the exact cross-group receiver inspect only the delivery proof and count partial accepted and rejected quantities',async()=>{
 const company='11111111-1111-4111-8111-111111111111',db=new MemoryMistDatabase(),auth=testAuthority(),f=materialDeliveryFixture(20,false),wid=randomUUID();
 auth.users.set('owner',{active:true,permissions:['procurement:read','procurement:write','orders:read']});auth.users.set('garment',{active:true,permissions:['orders:read','orders:write']});auth.users.set('other',{active:true,permissions:['orders:read','orders:write']});
 for(const id of ['owner','garment','reviewer','warehouse','other']){db.companyMembers.push({companyId:company,userId:id,status:'active'});db.accounts.set(id,{status:'active',displayName:id});}
 db.workspaces.set(wid,{id:wid,ownerId:'boss',companyId:company,slug:`company@${company}`,name:'公司',revision:0,state:structuredClone(f.state),createdAt:new Date(),updatedAt:new Date()});
 const repo=new MistRepository(db,contract,new MistPrivateFiles(dir),auth.authorize,()=>new Date(f.context.now)),actor=(id:string)=>({...testActor(id),roles:[],companyId:company});
 const quote=await repo.upload(actor('owner'),wid,{requestId:'quote',expectedRevision:0},{name:'private-quote.txt',mimeType:'text/plain',bytes:Buffer.from('supplier price 68')});const quoteId=quote.workspace.state.files.find(x=>x.name==='private-quote.txt')!.id;
 const proof=await repo.upload(actor('owner'),wid,{requestId:'proof',expectedRevision:1},{name:'delivery-note.txt',mimeType:'text/plain',bytes:Buffer.from('20 metres delivery proof')});const proofId=proof.workspace.state.files.find(x=>x.name==='delivery-note.txt')!.id;db.workspaces.get(wid)!.state.fulfillment.purchases.find(p=>p.id===f.purchaseId)!.fileIds=[quoteId];
 await repo.execute(actor('owner'),wid,{requestId:'dispatch',expectedRevision:2,command:{type:'fulfillment.materials.deliver',payload:{id:f.purchaseId,quantity:20,rejected:0,targetProductionId:f.productionId,location:'factory',date:'2026-10-24',evidence:'DO-1',fileIds:[proofId]}}});const receipt=db.workspaces.get(wid)!.state.fulfillment.receipts[0];
 const before=await repo.get(actor('garment'),wid),delivery=before.scopedFabricAccess?.[f.target.lineId]?.deliveries.find(d=>d.id===receipt.id);expect(delivery).toMatchObject({kind:'direct',pending:'20',fileIds:[proofId]});expect(before.state.orders.some(o=>o.id===f.source.orderId)).toBe(false);expect(before.state.fulfillment.purchases.some(p=>p.id===f.purchaseId)).toBe(false);expect(before.state.files.map(x=>x.id)).toContain(proofId);expect(before.state.files.map(x=>x.id)).not.toContain(quoteId);
 expect((await repo.download(actor('garment'),wid,proofId)).bytes.toString()).toBe('20 metres delivery proof');await expect(repo.download(actor('garment'),wid,quoteId)).rejects.toMatchObject({status:404});await expect(repo.download(actor('other'),wid,proofId)).rejects.toMatchObject({status:404});
 const confirm={type:'fulfillment.materials.confirm' as const,payload:{id:receipt.id,kind:'direct' as const,acceptedQuantity:8,rejectedQuantity:2,expectedReceivingRevision:0,evidence:'Counted first 10'}};
 await repo.execute(actor('garment'),wid,{requestId:'first-count',expectedRevision:3,command:confirm});let raw=db.workspaces.get(wid)!.state;expect(raw.fulfillment.receipts[0]).toMatchObject({quantity:18,rejected:2,materialDelivery:{sentQuantity:'20'}});expect(raw.fulfillment.purchases.find(p=>p.id===f.purchaseId)?.received).toBe(18);expect((await repo.get(actor('garment'),wid)).scopedFabricAccess?.[f.target.lineId]?.deliveries[0]).toMatchObject({accepted:'8',rejected:'2',pending:'10'});
 await repo.execute(actor('garment'),wid,{requestId:'second-count',expectedRevision:4,command:{...confirm,payload:{...confirm.payload,acceptedQuantity:10,rejectedQuantity:0,expectedReceivingRevision:1,evidence:'Counted remaining 10'}}});raw=db.workspaces.get(wid)!.state;expect(raw.fulfillment.receipts[0].materialDelivery?.receivingChecks).toHaveLength(2);expect(raw.fulfillment.purchases.find(p=>p.id===f.purchaseId)?.price).toBe(68);expect(raw.fulfillment.purchases.find(p=>p.id===f.purchaseId)?.fileIds).toEqual([quoteId]);
 auth.users.get('garment')!.permissions=['orders:read'];expect((await repo.get(actor('garment'),wid)).scopedFabricAccess).toBeUndefined();await expect(repo.download(actor('garment'),wid,proofId)).rejects.toMatchObject({status:404});
});
