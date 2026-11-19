import {beforeEach,afterEach,it,expect} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {TokenPayload} from '../auth/service';
import {createMistState} from '../shared/mistWorkspace';
import {MistPrivateFiles} from './files';
import {prepareFilePrivacy,restrictedSensitiveFiles,restrictedUploadContent} from './filePrivacy';
import {projectState} from './access';
let directory:string,files:MistPrivateFiles;const workspaceId=randomUUID(),now='2026-11-13T12:00:00Z';
const actor=(id='reader',tax=false):TokenPayload=>({userId:id,displayName:id,roles:[],departmentIds:[],permissions:['products:read','invoices:read','vouchers:read',...(tax?['sensitive:tax_base']:[])]} as TokenPayload);
const empty=()=>createMistState({id:randomUUID,now,actorName:'owner'} as any,'empty');
beforeEach(async()=>{directory=await mkdtemp(path.join(tmpdir(),'mist-file-privacy-'));files=new MistPrivateFiles(directory);});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});});
it('computes new file identity from actual bytes, ignores a caller digest and retains it across a cold store',async()=>{
 const bytes=Buffer.from('ordinary source'),sha256=createHash('sha256').update(bytes).digest('hex');
 const file=await files.write(workspaceId,{bytes,name:'proof.txt',mimeType:'text/plain',sha256:'0'.repeat(64)} as any,now);
 expect(file.sha256).toBe(sha256);const cold=new MistPrivateFiles(directory);
 expect(await cold.digest(workspaceId,file)).toBe(sha256);expect(await cold.read(workspaceId,file)).toEqual(bytes);
});
it('rejects same-size source tampering before returning original bytes',async()=>{
 const file=await files.write(workspaceId,{bytes:Buffer.from('original'),name:'proof.txt',mimeType:'text/plain'},now);
 await writeFile(path.join(directory,workspaceId,file.id),'tampered');
 await expect(new MistPrivateFiles(directory).read(workspaceId,file)).rejects.toMatchObject({status:404,code:'FILE_NOT_FOUND'});
});
async function fixture(){
 const state=empty(),bytes=Buffer.from('VAT amount 10123.89; source invoice');
 const original=await files.write(workspaceId,{bytes,name:'vat.txt',mimeType:'text/plain'},now),copy=await files.write(workspaceId,{bytes,name:'payment-proof.pdf',mimeType:'application/pdf'},now),ordinary=await files.write(workspaceId,{bytes:Buffer.alloc(bytes.length,65),name:'contract.txt',mimeType:'text/plain'},now);
 const seal=await files.write(workspaceId,{bytes:Buffer.from('seal-image'),name:'seal.png',mimeType:'application/octet-stream'},now),sealCopy=await files.write(workspaceId,{bytes:Buffer.from('seal-image'),name:'logo.png',mimeType:'application/octet-stream'},now);
 state.files=[original,{...copy,uploadedBy:'reader'},ordinary,seal,sealCopy];state.market.products=[{id:'product',fileIds:[copy.id,ordinary.id,sealCopy.id]} as any];
 state.payables!.bills=[{id:'bill',code:'AP',supplierId:'supplier',supplier:'Supplier',invoiceType:'vat-special',invoiceNo:'INV',invoiceDate:'2026-11-13',currency:'CNY',amount:88000,taxAmount:10123.89,taxRate:'13%',lines:[],terms:[],due:'2026-11-13',dueBasis:'Contract',fileIds:[original.id],note:'Tax10123.89',state:'open',registeredAt:now,registeredBy:'Finance',invoiceTypeHistory:[{invoiceType:'vat-special',fileIds:[original.id],reason:'Tax10123.89',at:now,actor:'Finance',actorId:'finance'}]}];
 state.seals=[{id:'seal',fileId:seal.id,userIds:['signer'],name:'Company',kind:'company',state:'active',createdAt:now,createdBy:'owner'} as any];
 return{state,bytes,original,copy,ordinary,seal,sealCopy};
}
it('denies byte-identical renamed copies despite a visible reference/uploader, keeps unrelated same-size data, and does not rewrite state',async()=>{
 const f=await fixture();for(const file of f.state.files)delete file.sha256;
 const before=structuredClone(f.state),cold=new MistPrivateFiles(directory),privacy=await prepareFilePrivacy(cold,workspaceId,f.state);
 const projected=projectState(f.state,actor(),empty,'owner',undefined,privacy).state;
 expect(projected.files.map(x=>x.id)).not.toContain(f.original.id);expect(projected.files.map(x=>x.id)).not.toContain(f.copy.id);expect(projected.files.map(x=>x.id)).toContain(f.ordinary.id);
 expect(projected.payables!.bills[0]).toMatchObject({amount:88000,taxAmount:0,taxRate:'',note:'',taxMasked:true});expect(projected.payables!.bills[0].invoiceTypeHistory![0].reason).toBe('');expect(f.state).toEqual(before);
 expect(restrictedUploadContent(f.state,actor(),'owner',privacy,privacy.digests.get(f.copy.id)!,f.copy.size)).toBe(true);
 expect(restrictedUploadContent(f.state,actor(),'owner',privacy,privacy.digests.get(f.ordinary.id)!,f.ordinary.size)).toBe(false);
});
it('preserves authorized tax access and applies a lower current ceiling without caching a permission decision',async()=>{
 const f=await fixture(),privacy=await prepareFilePrivacy(files,workspaceId,f.state),finance=actor('finance',true);
 expect(restrictedSensitiveFiles(f.state,finance,'owner',privacy).has(f.copy.id)).toBe(false);
 expect(projectState(f.state,finance,empty,'owner',undefined,privacy).state.payables!.bills[0].note).toBe('Tax10123.89');
 expect(restrictedSensitiveFiles(f.state,{...finance,permissionCeiling:['products:read','invoices:read']},'owner',privacy).has(f.copy.id)).toBe(true);
});
it('inherits original-seal restrictions for copies, keeps designated users/maintainers, and never serves raw seals through an agent or review route',async()=>{
 const f=await fixture(),privacy=await prepareFilePrivacy(files,workspaceId,f.state);
 expect(restrictedSensitiveFiles(f.state,actor(),'owner',privacy).has(f.sealCopy.id)).toBe(true);
 expect(restrictedSensitiveFiles(f.state,actor('signer'),'owner',privacy).has(f.sealCopy.id)).toBe(false);
 expect(restrictedSensitiveFiles(f.state,actor('owner'),'owner',privacy).has(f.sealCopy.id)).toBe(false);
 expect(restrictedSensitiveFiles(f.state,{...actor('owner',true),actorKind:'agent'} as any,'owner',privacy).has(f.sealCopy.id)).toBe(true);
 expect(restrictedSensitiveFiles(f.state,actor('owner',true),'owner',privacy,true).has(f.sealCopy.id)).toBe(true);
});
it('uses current sensitivity when projecting older source snapshots',async()=>{
 const f=await fixture(),prior=structuredClone(f.state);prior.payables!.bills=[];prior.seals=[];
 const privacy=await prepareFilePrivacy(files,workspaceId,f.state);
 expect(restrictedSensitiveFiles(prior,actor(),'owner',{...privacy,current:f.state}).has(f.copy.id)).toBe(true);
});
it('hides tax-specific free-text explanations while retaining ordinary bill notes and operation identities',async()=>{
 const f=await fixture(),s=f.state;s.payables!.bills[0].state='void';s.payables!.bills[0].voided={at:now,actor:'Finance',reason:'Tax10123.89'};
 s.payables!.bills.push({...s.payables!.bills[0],id:'ordinary-bill',invoiceType:'commercial',taxAmount:0,taxRate:'',fileIds:[],note:'Delivery checked',voided:undefined});
 s.exportRebate={rates:[],claims:[{id:'claim',code:'RC',note:'Tax10123.89',taxable:77876.11,expected:10123.89,fileIds:[],lines:[],receipts:[],approved:{date:'2026-11-13',amount:10123.89,ref:'REF',reason:'Tax10123.89',at:now,actor:'Finance'},state:'approved'} as any]};
 const before=structuredClone(s),privacy=await prepareFilePrivacy(files,workspaceId,s),reader={...actor(),permissions:[...actor().permissions,'tax:read']};
 const next=projectState(s,reader,empty,'owner',undefined,privacy).state;
 expect(next.payables!.bills[0].voided).toEqual({at:now,actor:'Finance',reason:''});expect(next.payables!.bills[1].note).toBe('Delivery checked');
 expect(next.exportRebate!.claims[0]).toMatchObject({note:'',taxable:0,expected:0,approved:{amount:0,reason:'',actor:'Finance',ref:'REF'}});expect(s).toEqual(before);
});
it('does not fail open when a needed original cannot be verified, and does not deny different-size ordinary data',async()=>{
 const f=await fixture();for(const file of f.state.files)delete file.sha256;
 await files.remove(workspaceId,f.original);const cold=new MistPrivateFiles(directory),privacy=await prepareFilePrivacy(cold,workspaceId,f.state),denied=restrictedSensitiveFiles(f.state,actor(),'owner',privacy);
 expect(privacy.unavailable.has(f.original.id)).toBe(true);expect(denied.has(f.copy.id)).toBe(true);expect(denied.has(f.ordinary.id)).toBe(true);
 const small=await cold.write(workspaceId,{bytes:Buffer.from('ordinary'),name:'other.txt',mimeType:'text/plain'},now);f.state.files.push(small);expect(restrictedSensitiveFiles(f.state,actor(),'owner',privacy).has(small.id)).toBe(false);
});
