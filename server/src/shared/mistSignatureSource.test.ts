import {expect,it} from 'vitest';
import {createMistState} from './mistWorkspace';
import {decisionSignatureVisible,type MistDecisionSignature} from './mistSignatures';
import {projectState} from '../mist/access';

const empty=()=>createMistState({id:()=>'',now:'2026-11-18T04:00:00Z',actorName:'Fixture'},'empty');
function fixture(){
 const s=empty();
 s.orders.push({id:'order-A',ownerId:'owner',type:'garment',governance:{cancellation:{id:'cancel-A',status:'approved'}}}as any);
 s.orderLines.push({id:'line-A',orderId:'order-A',closure:{id:'close-A',status:'closed'},overShips:[{id:'over-A',status:'approved'}]}as any);
 return s;
}
const signature=(entityId:string):MistDecisionSignature=>({id:'sig-'+entityId,commandType:'order.governance.decide',entityId,fileId:'file-'+entityId,actorId:'reviewer',actor:'Reviewer',at:'2026-11-18T04:00:00Z',requestId:'request-'+entityId,decision:'approved'});
it.each(['order-A#cancel:cancel-A','order-A#close:line-A','order-A#overship:over-A'])('allows the exact visible order review source %s',entity=>{
 expect(decisionSignatureVisible(fixture(),signature(entity),'owner')).toBe(true);
});
it.each(['order-A#cancel:unknown','order-A#close:unknown','order-A#overship:unknown','order-A#cancel:cancel-A#extra','order-A-extra#cancel:cancel-A'])('does not grant an arbitrary composite prefix %s',entity=>{
 expect(decisionSignatureVisible(fixture(),signature(entity),'owner')).toBe(false);
});
it('requires the visible parent and its exact child relationship while retaining signer access',()=>{
 const s=fixture();s.orders=[];const row=signature('order-A#cancel:cancel-A');expect(decisionSignatureVisible(s,row,'owner')).toBe(false);expect(decisionSignatureVisible(s,row,'reviewer')).toBe(true);
 const wrong=fixture();wrong.orderLines[0].orderId='another-order';expect(decisionSignatureVisible(wrong,signature('order-A#close:line-A'),'owner')).toBe(false);expect(decisionSignatureVisible(wrong,signature('order-A#overship:over-A'),'owner')).toBe(false);
});
it('projects the cancellation signature and its private file only with the actual order read scope',()=>{
 const s=fixture(),row=signature('order-A#cancel:cancel-A');s.decisionSignatures=[row];s.files.push({id:row.fileId,name:'signature.svg',mimeType:'image/svg+xml',size:20,storageKey:'fixture/signature',uploadedBy:'reviewer',createdAt:row.at}as any);
 const actor:any={userId:'owner',roles:[],departmentIds:[],authorizationLoaded:true,permissions:['orders:read']};
 const own=projectState(s,actor,empty,undefined,{userIds:['owner'],teamIds:[]}).state;expect(own.decisionSignatures).toEqual([row]);expect(own.files.map(f=>f.id)).toContain(row.fileId);
 const unrelated=projectState(s,{...actor,userId:'unrelated'},empty,undefined,{userIds:['unrelated'],teamIds:[]}).state;expect(unrelated.decisionSignatures).toEqual([]);expect(unrelated.files.map(f=>f.id)).not.toContain(row.fileId);
 const revoked=projectState(s,{...actor,permissions:[]},empty,undefined,{userIds:['owner'],teamIds:[]}).state;expect(revoked.decisionSignatures).toEqual([]);expect(revoked.files.map(f=>f.id)).not.toContain(row.fileId);
});
