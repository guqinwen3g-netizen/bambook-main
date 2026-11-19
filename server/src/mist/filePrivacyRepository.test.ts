import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import * as contract from '../shared/mistWorkspace';
import {MistRepository} from './repository';
import {MistPrivateFiles} from './files';
import {MemoryMistDatabase,testActor,testAuthority} from './__tests__/support';
vi.mock('./context',()=>({mistApprovalAuthority:async()=>({supplier:{}})}));
const now='2026-11-13T12:00:00Z',bytes=Buffer.from('Invoice VAT 10123.89; gross88000.00');
let directory:string,db:MemoryMistDatabase,auth:ReturnType<typeof testAuthority>,files:MistPrivateFiles,repo:MistRepository,wid:string,original:any,copy:any,ordinary:any;
const core={...contract,getMistReviewTasks:(state:any)=>state.reviewTasks||[]};
const actor=(id='owner')=>({...testActor(id),roles:[]});
const state=()=>db.workspaces.get(wid).state as contract.MistState;
beforeEach(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'mist-file-private-repo-'));db=new MemoryMistDatabase();auth=testAuthority();
 auth.users.get('owner')!.permissions.push('products:read','invoices:read','vouchers:read');
 auth.users.set('reader',{active:true,permissions:['products:read','invoices:read','vouchers:read','approvals:write']});
 files=new MistPrivateFiles(directory);repo=new MistRepository(db,core,files,auth.authorize,()=>new Date(now));wid=(await repo.create(actor(),{name:'File privacy',seed:'empty'})).id;
 original=await files.write(wid,{bytes,name:'tax-source.txt',mimeType:'text/plain'},now);copy={...await files.write(wid,{bytes,name:'shared-proof.txt',mimeType:'text/plain'},now),uploadedBy:'owner'};ordinary=await files.write(wid,{bytes:Buffer.alloc(bytes.length,65),name:'contract.txt',mimeType:'text/plain'},now);
 const s=state();s.memberIds=['reader'];s.files=[original,copy,ordinary];s.market.products=[{id:'product',sku:'P',name:'Product',category:'garment',cost:'0',refPrice:'0',currency:'CNY',unit:'件',status:'active',supplierId:'',supplierCode:'',color:'',composition:'',specification:'',season:'',note:'',fileIds:[copy.id,ordinary.id],customerCodes:[],specs:{},createdAt:now,updatedAt:now}];
 s.payables!.bills=[{id:'bill',code:'AP',supplierId:'supplier',supplier:'Supplier',invoiceType:'vat-special',invoiceNo:'INV',invoiceDate:'2026-11-13',currency:'CNY',amount:88000,taxAmount:10123.89,taxRate:'13%',lines:[],terms:[],due:'2026-11-13',dueBasis:'Contract',fileIds:[original.id],note:'Tax10123.89',state:'open',registeredAt:now,registeredBy:'Finance'}];
 (s as any).reviewTasks=[{id:'review',kind:'quotation',entityId:'quote',title:'Review',requesterId:'owner',reviewerIds:['reader'],status:'pending',submittedAt:now,requiredPermission:'approvals:write',target:{view:'quotations',id:'quote'},details:[],fileIds:[copy.id,ordinary.id]}];(s as any).reviewerIds=['reader'];
});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});});
it('denies the original and uploaded alias in metadata, download and text, including a new storage/repository instance',async()=>{
 const fresh=new MistRepository(db,core,new MistPrivateFiles(directory),auth.authorize,()=>new Date(now));
 for(const repository of [repo,fresh]){
  const view=await repository.get(actor('reader'),wid);expect(view.state.files.map(f=>f.id)).not.toContain(copy.id);expect(view.state.files.map(f=>f.id)).toContain(ordinary.id);
  await expect(repository.download(actor('reader'),wid,original.id)).rejects.toMatchObject({status:404});await expect(repository.download(actor('reader'),wid,copy.id)).rejects.toMatchObject({status:404});await expect(repository.fileText(actor('reader'),wid,copy.id)).rejects.toMatchObject({status:404});
  expect((await repository.download(actor('reader'),wid,ordinary.id)).bytes).toEqual(Buffer.alloc(bytes.length,65));
 }
 expect(db.workspaces.get(wid).revision).toBe(0);expect(state().payables!.bills[0].note).toBe('Tax10123.89');
});
it('applies the same restriction to an assigned review while preserving its ordinary evidence',async()=>{
 const rows=await repo.listReviews(actor('reader'));expect(rows[0].files.map(f=>f.id)).toEqual([ordinary.id]);await expect(repo.reviewFile(actor('reader'),wid,'review',copy.id)).rejects.toMatchObject({status:404});expect((await repo.reviewFile(actor('reader'),wid,'review',ordinary.id)).bytes).toEqual(Buffer.alloc(bytes.length,65));
 auth.users.get('reader')!.permissions.push('sensitive:tax_base');expect((await repo.listReviews(actor('reader')))[0].files.map(f=>f.id)).toContain(copy.id);expect((await repo.reviewFile(actor('reader'),wid,'review',copy.id)).bytes).toEqual(bytes);
});
it('rejects restricted duplicate uploads before writing and preserves authorized upload/read access after a current grant change',async()=>{
 const count=(await readdir(path.join(directory,wid))).length;
 await expect(repo.upload(actor(),wid,{requestId:'denied-copy',expectedRevision:0},{bytes,name:'new-name.txt',mimeType:'text/plain'})).rejects.toMatchObject({status:403});expect((await readdir(path.join(directory,wid))).length).toBe(count);expect(db.workspaces.get(wid).revision).toBe(0);
 auth.users.get('owner')!.permissions.push('sensitive:tax_base');const added=await repo.upload(actor(),wid,{requestId:'allowed-copy',expectedRevision:0},{bytes,name:'new-name.txt',mimeType:'text/plain'});expect((await repo.download(actor(),wid,added.receipt.result.fileId as string)).bytes).toEqual(bytes);
 auth.users.get('owner')!.permissions=auth.users.get('owner')!.permissions.filter(p=>p!=='sensitive:tax_base');await expect(repo.download(actor(),wid,copy.id)).rejects.toMatchObject({status:404});
});
it('honors a bounded agent ceiling on the standard text path even when its underlying owner has tax permission',async()=>{
 auth.users.get('owner')!.permissions.push('sensitive:tax_base');const agent={...actor(),actorKind:'agent',agentSessionId:'agent-session',agentMode:'read',agentWorkspaceId:wid,permissionCeiling:['products:read','invoices:read']} as any;
 await expect(repo.fileText(agent,wid,copy.id)).rejects.toMatchObject({status:404});expect((await repo.download(actor(),wid,copy.id)).bytes).toEqual(bytes);expect(db.workspaces.get(wid).revision).toBe(0);
});
