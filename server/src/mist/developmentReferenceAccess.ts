import type {TokenPayload} from '../auth/service';
import {hasScope} from '../auth/permissionService';
import {scopedVisibility,type MistDataScope} from '../shared/mistDataScope';
import {shippingSampleMovementBlocker} from '../shared/mistShipmentSampleCustody';
import {stableJson} from '../shared/stableJson';
import {developmentReferenceLoans,developmentReferenceLoanRemaining,developmentReferenceSourceHash,type DevelopmentReferenceCommand,type DevelopmentReferenceAccess} from '../shared/mistDevelopmentSampleReferences';
import type {MistState} from '../shared/mistWorkspace';
/** Run before file collection and again after privacy filtering. Relations never become new source/file grants. */
export function sanitizeDevelopmentReferenceState(visible:MistState){
 if(!Array.isArray(visible.devs))return;
 const samples=new Map((visible.fulfillment?.samples||[]).map(s=>[s.id,s])),files=new Set((visible.files||[]).map(f=>f.id));
 visible.devs=(visible.devs||[]).map(dev=>{if(!dev.sampleReferences)return dev;return{...dev,sampleReferences:dev.sampleReferences.filter(ref=>samples.has(ref.sampleId)).map(ref=>{
  const sample=samples.get(ref.sampleId)!;return{...ref,snapshots:ref.snapshots.map(snapshot=>{
   const {source,...facts}=snapshot.facts;return{...snapshot,facts:{...facts,...(source&&stableJson(source)===stableJson(sample.source)?{source}:{}),fileIds:facts.fileIds.filter(id=>sample.fileIds.includes(id)&&files.has(id))}};
  })};
 })};});
}
function independentScope(full:MistState,visible:MistState,scope?:MistDataScope){const raw=scope?scopedVisibility(full,scope,false):undefined;return{devIds:new Set((visible.devs||[]).filter(d=>!raw||raw.get('devs')?.has(d.id)).map(d=>d.id)),sampleIds:new Set((visible.fulfillment?.samples||[]).filter(s=>!raw||raw.get('fulfillment.samples')?.has(s.id)).map(s=>s.id))};}
export function projectDevelopmentReferenceAccess(full:MistState,visible:MistState,actor:TokenPayload,scope?:MistDataScope):DevelopmentReferenceAccess{
 const canRead=hasScope(actor,'products:read'),canWrite=canRead&&hasScope(actor,'products:write'),eligible=independentScope(full,visible,scope),visibleSamples=new Map((visible.fulfillment?.samples||[]).map(s=>[s.id,s]));
 const readableDevIds=canRead?(visible.devs||[]).map(d=>d.id):[],writableDevIds=canWrite?[...eligible.devIds]:[],writableSampleIds=canWrite?[...eligible.sampleIds]:[];
 const referencesByDev=Object.fromEntries(readableDevIds.map(devId=>[devId,(full.devs.find(d=>d.id===devId)?.sampleReferences||[]).map(ref=>{
  const sample=visibleSamples.get(ref.sampleId),readable=!!sample,caseWritable=canWrite&&eligible.devIds.has(devId),writable=caseWritable&&eligible.sampleIds.has(ref.sampleId),loans=developmentReferenceLoans(full,devId,ref.id),outstanding=loans.some(l=>developmentReferenceLoanRemaining(full,l)>0),closed=!!full.devs.find(d=>d.id===devId)?.closure;
  const blocker=readable?(ref.withdrawn?'参考关系已撤回':sample!.source.kind==='developmentIncoming'?'请从原来样办理寄厂':ref.snapshots.at(-1)?.sourceHash!==developmentReferenceSourceHash(sample!)?'参考实物资料已变化，请重新核对引用':shippingSampleMovementBlocker(full,sample!,'lend')||undefined):undefined;
  return{referenceId:ref.id,readable,withdrawn:!!ref.withdrawn,canRemove:caseWritable&&!ref.withdrawn&&!outstanding,canDispatch:writable&&!closed&&!blocker,canReturn:writable&&outstanding,...(blocker?{blocker}:{})};
 })]));return{readableDevIds,writableDevIds,writableSampleIds,referencesByDev};
}
/** Fresh actor projection and original row scope are checked before domain errors can disclose a hidden source. */
export function developmentReferenceTargetViolation(full:MistState,visible:MistState,scope:MistDataScope|undefined,command:DevelopmentReferenceCommand):boolean{
 const p=command.payload;if(!p||typeof p!=='object'||Array.isArray(p))return true;
 const eligible=independentScope(full,visible,scope);if(!eligible.devIds.has(p.devId))return true;if(command.type==='development.reference.remove')return false;
 if(command.type!=='development.reference.add'&&(!Array.isArray(command.payload.items)||command.payload.items.some(item=>!item||typeof item!=='object')))return true;
 const dev=full.devs.find(d=>d.id===p.devId);let ids:string[];
 if(command.type==='development.reference.add')ids=[command.payload.sampleId];
 else if(command.type==='development.reference.dispatch')ids=command.payload.items.map(item=>dev?.sampleReferences?.find(r=>r.id===item.referenceId)?.sampleId||'');
 else ids=command.payload.items.map(item=>full.fulfillment.sampleMovements.find(m=>m.id===item.loanId&&m.kind==='lend'&&m.referenceTransfer?.devId===p.devId)?.sampleId||'');
 return ids.some(id=>!eligible.sampleIds.has(id));
}
/** One harmless relationship withdrawal may remain reviewable after source loss; never a stock/source write. */
export function developmentReferenceWithdrawalException(full:MistState,visible:MistState,actor:TokenPayload,scope:MistDataScope|undefined,command:unknown):{devId:string;referenceId:string}|undefined{
 const c=command as any,p=c?.payload;if(c?.type!=='development.reference.remove'||Object.keys(c).sort().join('|')!=='payload|type'||!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join('|')!=='devId|reason|referenceId'||typeof p.devId!=='string'||typeof p.referenceId!=='string'||typeof p.reason!=='string'||!p.reason.trim()||p.reason.trim().length>1000)return;
 const access=projectDevelopmentReferenceAccess(full,visible,actor,scope);if(access.writableDevIds.includes(p.devId)&&access.referencesByDev[p.devId]?.some(ref=>ref.referenceId===p.referenceId&&ref.canRemove))return{devId:p.devId,referenceId:p.referenceId};
}
