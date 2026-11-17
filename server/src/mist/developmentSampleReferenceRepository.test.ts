import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {MistRepository} from './repository';
import {MistPrivateFiles} from './files';
import {MemoryMistDatabase,testAuthority} from './__tests__/support';
import {applyMistCommand,createMistState,mistCommandPermission,type DevelopmentValues} from '../shared/mistWorkspace';
import {withTestFactories} from '../shared/__tests__/utils/devFactories';
import {retainFixtureFactoryTasks} from '../shared/__tests__/utils/devClose';
const company='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222';
const original=Buffer.from('Local fictional colour/handle comparison original. No QC conclusion.\n');
let directory:string,db:MemoryMistDatabase,repo:MistRepository,auth:ReturnType<typeof testAuthority>,workspaceId:string,devId:string,taskId:string,sampleId:string,otherSampleId:string,fileId:string;
const actor=(userId='sales',companyId=company):any=>({userId,displayName:userId==='other'?'工厂收件人':'业务员',roles:[],departmentIds:[],companyId,authorizationLoaded:true});
const row=()=>db.workspaces.get(workspaceId)!;
const cmd=(command:any,who=actor(),requestId=randomUUID(),expectedRevision=row().revision)=>repo.execute(who,workspaceId,{requestId,expectedRevision,command});
const link=(extra:Record<string,unknown>={})=>({type:'development.reference.add',payload:{devId,sampleId,purpose:'颜色和手感对照，不作主料',fileIds:[fileId],...extra}});
const outgoing=(referenceId:string)=>({type:'development.reference.dispatch',payload:{devId,taskVersionId:taskId,items:[{referenceId,quantity:.25,sourceLocation:'C03'}],sentAt:'2026-11-18',expectedReturn:'2026-11-22',delivery:{kind:'handover',recipient:'工厂收件人',address:'工厂样品室',carrier:'',trackingNo:'',evidence:'工厂领取完整参考段'},postage:{amount:0,currency:'CNY',zeroReason:'供方自提，我方不垫付'},note:'整段归还'}});
const returning=(dispatchId:string,loanId:string,quantity=.25)=>({type:'development.reference.return',payload:{devId,dispatchId,items:[{loanId,quantity,location:'C03'}],receivedAt:'2026-11-18',delivery:{kind:'handover',recipient:'业务员',address:'公司样品室',carrier:'',trackingNo:'',evidence:'工厂交回同一完整参考段'},note:'按原借出归还'}});
const edit=(over:Record<string,unknown>)=>{const sample=row().state.fulfillment.samples.find((s:any)=>s.id===sampleId);return{type:'fulfillment.samples.edit',payload:{id:sampleId,location:sample.location,note:sample.note,fileIds:sample.fileIds,...over}};};
beforeEach(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'development-reference-'));db=new MemoryMistDatabase();auth=testAuthority();workspaceId=randomUUID();
 for(const id of ['sales','other','reader']){auth.users.set(id,{active:true,permissions:['products:read','relations:read','suppliers:read',...(id==='reader'?[]:['products:write'])]});db.companyMembers.push({companyId:company,userId:id,status:'active'});db.accounts.set(id,{displayName:id==='other'?'工厂收件人':'业务员'});}
 db.companyMembers.push({companyId:foreign,userId:'sales',status:'active'});
 const state=withTestFactories(createMistState({id:randomUUID,now:'2026-11-18T04:00:00.000Z',actorName:'业务员'},'empty'));state.customers.push({id:'customer',name:'客户',code:'C',country:'',city:'',industry:'',owner:'业务员',ownerId:'sales',grade:'',currency:'USD',terms:'',incoterm:'',categories:'',creditLimit:0,since:''});
 db.workspaces.set(workspaceId,{id:workspaceId,ownerId:'admin',companyId:company,slug:'company@'+company,name:'模拟公司',revision:0,state,createdAt:new Date(),updatedAt:new Date()});repo=new MistRepository(db,{createMistState,applyMistCommand,mistCommandPermission},new MistPrivateFiles(directory),auth.authorize,()=>new Date('2026-11-18T04:00:00.000Z'));
 const upload=await repo.upload(actor(),workspaceId,{requestId:randomUUID(),expectedRevision:row().revision},{bytes:original,name:'对照样说明.txt',mimeType:'text/plain'});fileId=String(upload.receipt.result.fileId||upload.receipt.result.id);
 const sample=(files:string[])=>({type:'fulfillment.samples.create',payload:{name:'棉斜纹',category:'面料',form:'米样',quantity:1.25,unit:'米',location:'C03',size:'150cm',color:'灰',note:'完整对照段，不裁切',fileIds:files,source:{kind:'manual',description:'公司留样'}}});
 sampleId=String((await cmd(sample([fileId]))).receipt.result.id);otherSampleId=String((await cmd(sample([]),actor('other'))).receipt.result.id);
 const values:DevelopmentValues={domain:'garment',name:'短外套',customer:'customer',style:'ST-REF',season:'AW27',category:'外套',kind:'new',requestType:'replicate',fabric:'羊毛混纺待分析',color:'灰',target:'',sizeBase:'M',goal:'比较颜色和结构',factories:['A厂'],due:'2026-11-22',collaborators:[],sampleQuantity:1};
 devId=String((await cmd({type:'development.submit',payload:{values,fileIds:[]}})).receipt.result.devId);taskId=row().state.devs.find((d:any)=>d.id===devId).versionIds[0];
});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});});
it('persists one reference, exposes only independently writable samples, uses the exact original loan and source bytes, and replays no duplicate business',async()=>{
 const before=structuredClone(row().state.fulfillment),linked=await cmd(link()),ref=String(linked.receipt.result.referenceId),view=await repo.get(actor(),workspaceId);expect(row().state.fulfillment).toEqual(before);
 expect(view.developmentReferenceAccess?.writableSampleIds).toContain(sampleId);expect(view.developmentReferenceAccess?.writableSampleIds).not.toContain(otherSampleId);expect(view.developmentReferenceAccess?.referencesByDev[devId]).toEqual([expect.objectContaining({referenceId:ref,readable:true,canDispatch:true})]);
 const outgoingId=randomUUID(),expectedRevision=row().revision,body=outgoing(ref),sent=await cmd(body,actor(),outgoingId,expectedRevision),dispatchId=String(sent.receipt.result.dispatchId),loanId=sent.receipt.result.movementIds![0];
 const loan=row().state.fulfillment.sampleMovements.find((m:any)=>m.id===loanId);expect(loan.borrowerId).toBe('');expect(loan.referenceTransfer.supplierId).toBe(row().state.versions.find((v:any)=>v.id===taskId).factoryId);
 const stable=structuredClone(row()),receipts=db.receipts.size;expect((await cmd(body,actor(),outgoingId,expectedRevision)).replayed).toBe(true);expect(row()).toEqual(stable);expect(db.receipts.size).toBe(receipts);
 const bytes=await repo.download(actor(),workspaceId,fileId);expect(bytes.bytes).toEqual(original);
 await cmd(returning(dispatchId,loanId,.1));await cmd(returning(dispatchId,loanId,.15));expect(row().state.fulfillment.samples.find((s:any)=>s.id===sampleId).available).toBe(1.25);expect(row().state.fulfillment.samples).toHaveLength(2);expect(row().state.fulfillment.qcTasks).toHaveLength(0);
 const other=await repo.get(actor('other'),workspaceId);expect(other.state.fulfillment.samples.some(s=>s.id===sampleId)).toBe(false);await expect(repo.download(actor('other'),workspaceId,fileId)).rejects.toMatchObject({status:404});
});
it('rejects hidden/cross-company/readonly and forged identities with no receipt or state change',async()=>{
 for(const [command,who,status] of [[link({sampleId:otherSampleId,fileIds:[]}),actor(),404],[link(),actor('sales',foreign),404],[link(),actor('reader'),403],[link({registeredById:'other'}),actor(),422]] as const){const before=structuredClone(row()),receipts=db.receipts.size,id=randomUUID();await expect(cmd(command,who,id)).rejects.toMatchObject({status});expect(row()).toEqual(before);expect(db.receipts.size).toBe(receipts);await expect(repo.receipt(actor(),workspaceId,id)).rejects.toMatchObject({status:404});}
});
it('rechecks current products read and write permissions for old tokens before accepting any new reference action',async()=>{
 const old=actor();for(const revoked of ['products:read','products:write']){const user=auth.users.get('sales')!,permissions=[...user.permissions!];user.permissions=permissions.filter(x=>x!==revoked);const before=structuredClone(row()),receipts=db.receipts.size;await expect(cmd(link({fileIds:[]}),old)).rejects.toMatchObject({status:403});expect(row()).toEqual(before);expect(db.receipts.size).toBe(receipts);user.permissions=permissions;}
});
it('requires explicit source recheck, appends a readable snapshot without replacing history, and retains the original parcel after source changes',async()=>{
 const first=await cmd(link()),ref=String(first.receipt.result.referenceId),snapshot=structuredClone(row().state.devs.find((d:any)=>d.id===devId).sampleReferences[0].snapshots[0]);
 await cmd(edit({color:'深灰'}));const before=structuredClone(row()),receipts=db.receipts.size;await expect(cmd(outgoing(ref))).rejects.toMatchObject({status:409});expect(row()).toEqual(before);expect(db.receipts.size).toBe(receipts);
 const updated=await cmd(link());expect(updated.receipt.result.referenceId).toBe(ref);const relation=row().state.devs.find((d:any)=>d.id===devId).sampleReferences[0];expect(relation.snapshots).toHaveLength(2);expect(relation.snapshots[0]).toEqual(snapshot);expect(relation.snapshots[1].facts.color).toBe('深灰');
 const sent=await cmd(outgoing(ref));expect(row().state.fulfillment.sampleMovements.find((m:any)=>m.id===sent.receipt.result.movementIds![0]).referenceTransfer.snapshotId).toBe(relation.snapshots[1].id);
});
it('keeps the real outstanding loan in the close plan and returns after closure and changed comparison specifications, without reopening work',async()=>{
 const linked=await cmd(link()),ref=String(linked.receipt.result.referenceId),sent=await cmd(outgoing(ref)),dispatchId=String(sent.receipt.result.dispatchId),loanId=sent.receipt.result.movementIds![0];
 expect((await repo.get(actor(),workspaceId)).developmentTaskClosePlans?.[devId].followups.originalLoanCount).toBe(1);
 await cmd({type:'development.close',payload:{devId,kind:'archived',reason:'阶段收口，保留参考段归还',...retainFixtureFactoryTasks(row().state,devId)}});await cmd(edit({color:'深灰',fileIds:[]}));
 await cmd(returning(dispatchId,loanId));expect(row().state.fulfillment.samples.find((s:any)=>s.id===sampleId).available).toBe(1.25);expect(row().state.devs.find((d:any)=>d.id===devId).closure.kind).toBe('archived');
 await expect(cmd(outgoing(ref))).rejects.toMatchObject({status:422});await cmd({type:'development.reference.remove',payload:{devId,referenceId:ref,reason:'实物已归还，本阶段不再引用'}});expect(row().state.devs.find((d:any)=>d.id===devId).sampleReferences[0].withdrawn.reason).toBeTruthy();expect(row().state.devs.find((d:any)=>d.id===devId).sampleReferences[0].snapshots).toHaveLength(1);
});
it('allows withdrawal of a visible case relation after its independent source scope is lost without exposing the sample or granting its history',async()=>{
 db.departments.push({id:'ref-department',companyId:company,parentId:null,headId:'sales'});db.userDepartments.set('other','ref-department');
 const linked=await cmd(link({sampleId:otherSampleId,fileIds:[]})),ref=String(linked.receipt.result.referenceId);
 db.departments.find(d=>d.id==='ref-department')!.headId=null;
 const view=await repo.get(actor(),workspaceId);expect(view.state.devs.find(d=>d.id===devId)?.sampleReferences).toEqual([]);expect(view.developmentReferenceAccess?.referencesByDev[devId]).toEqual([expect.objectContaining({referenceId:ref,readable:false,canRemove:true,canDispatch:false,canReturn:false})]);expect(JSON.stringify(view)).not.toContain(otherSampleId);
 await cmd({type:'development.reference.remove',payload:{devId,referenceId:ref,reason:'停止引用不可读实物'}});expect(row().state.devs.find((d:any)=>d.id===devId).sampleReferences[0].withdrawn.reason).toBe('停止引用不可读实物');expect(row().state.fulfillment.samples.find((s:any)=>s.id===otherSampleId).registeredById).toBe('other');
});
it('does not turn an order-readonly upstream development specimen into a maintainable reference source',async()=>{
 row().state.customers.push({id:'other-customer',name:'他组客户',code:'OC',country:'',city:'',industry:'',owner:'工厂收件人',ownerId:'other',grade:'',currency:'USD',terms:'',incoterm:'',categories:'',creditLimit:0,since:''});
 const values:DevelopmentValues={domain:'garment',name:'他组短外套',customer:'other-customer',style:'OTHER-REF',season:'AW27',category:'外套',kind:'new',requestType:'replicate',fabric:'羊毛',color:'蓝',target:'',sizeBase:'M',goal:'独立打样',factories:['A厂'],due:'2026-11-22',collaborators:[],sampleQuantity:1};
 const otherDevId=String((await cmd({type:'development.submit',payload:{values,fileIds:[]}},actor('other'))).receipt.result.devId),otherVersionId=row().state.devs.find((d:any)=>d.id===otherDevId).versionIds[0];
 await cmd({type:'development.recordSample',payload:{devId:otherDevId,versionId:otherVersionId,sample:'OTHER-PHYSICAL',quantity:1,returnedAt:'2026-11-18T04:00:00.000Z'}},actor('other'));
 const sourceId=row().state.fulfillment.samples.find((s:any)=>s.source.kind==='version'&&s.source.versionId===otherVersionId).id;
 row().state.orders.push({id:'owned-read-order',code:'SO-REF',name:'本人订单',type:'garment',owner:'业务员',ownerId:'sales',customerId:'customer',customer:'客户',currency:'USD',status:'draft',lineIds:['owned-read-line']});row().state.orderLines.push({id:'owned-read-line',orderId:'owned-read-order',name:'他组开发来源',qty:1,unit:'件',price:0,sourceDevId:otherDevId,sourceVersionId:otherVersionId});auth.users.get('sales')!.permissions!.push('orders:read');
 const view=await repo.get(actor(),workspaceId);expect(view.state.fulfillment.samples.some(s=>s.id===sourceId)).toBe(true);
 const before=structuredClone(row()),receipts=db.receipts.size;await expect(cmd(link({sampleId:sourceId,fileIds:[]}))).rejects.toMatchObject({status:404});expect(row()).toEqual(before);expect(db.receipts.size).toBe(receipts);expect(view.developmentReferenceAccess?.writableSampleIds).not.toContain(sourceId);
});
