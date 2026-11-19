import type {TokenPayload} from '../auth/service';
import {hasScope} from '../auth/permissionService';
import type {MistState,MistWorkspaceEnvelope} from '../shared/mistWorkspace';
import {developmentReferenceLoans,developmentReferenceLoanRemaining,type DevelopmentSampleReference} from '../shared/mistDevelopmentSampleReferences';
export type ReferenceReadContext=Pick<MistWorkspaceEnvelope,'developmentReferenceAccess'>;
export type ReferenceRecordSource={referenceId:string;sampleId?:string;snapshotId?:string;readable:boolean;withdrawn:boolean;canRemove:boolean;canDispatch:boolean;canReturn:boolean};
export type ReferenceCommandSources={
 referenceRecords?:{references:ReferenceRecordSource[];readableCount:number;restrictedCount:number}|null;
 referenceCounts?:{readable:number;restricted:number}|null;
 referenceSource?:{devId:string;referenceId:string;sampleId:string;snapshotId:string;canDispatch:boolean;canRemove:boolean}|null;
 referenceReturnSource?:{devId:string;referenceId:string;sampleId:string;loanId:string;dispatchId:string;taskVersionId:string;snapshotId:string;unit:string;quantity:number;remaining:number}|null;
};
const exact=(v:unknown):v is string=>typeof v==='string'&&!!v&&v===v.trim()&&v.length<=200&&!v.startsWith('data:');
const findRef=(state:MistState,devId:string,referenceId:string)=>state.devs?.find(d=>d.id===devId)?.sampleReferences?.find(r=>r.id===referenceId);
/** Existing development record semantics stay unchanged except the new relation's unbounded nested history. */
export function developmentReferenceCaseReadRecord(row:any){
 if(!Array.isArray(row.sampleReferences))return row;
 return{...row,sampleReferences:row.sampleReferences.map((r:DevelopmentSampleReference)=>({referenceId:r.id,sampleId:r.sampleId,purpose:r.purpose,linkedAt:r.linkedAt,linkedBy:r.linkedBy,linkedById:r.linkedById,snapshotId:r.snapshots.at(-1)?.id,snapshotCount:r.snapshots.length,...(r.withdrawn?{withdrawn:r.withdrawn}:{})}))};
}
/** Each business reference is independently addressable; full history remains in the case archive. */
export function developmentReferenceReadRows(state:MistState){
 const samples=new Map((state.fulfillment?.samples||[]).map(s=>[s.id,s]));
 return(state.devs||[]).flatMap(dev=>(dev.sampleReferences||[]).flatMap(ref=>{
  const sample=samples.get(ref.sampleId),current=ref.snapshots.at(-1);if(!sample||!current||![dev.id,ref.id,sample.id,current.id].every(exact))return[];
  const history=ref.snapshots.slice(0,-1),loans=developmentReferenceLoans(state,dev.id,ref.id),open=loans.filter(loan=>developmentReferenceLoanRemaining(state,loan)>0);
  return[{id:ref.id,referenceId:ref.id,devId:dev.id,sampleId:sample.id,code:dev.code+' / '+sample.code,name:sample.name,purpose:ref.purpose,status:ref.withdrawn?'withdrawn':'active',linkedAt:ref.linkedAt,linkedBy:ref.linkedBy,linkedById:ref.linkedById,currentSnapshot:current,
   snapshotHistory:{total:history.length,records:history.slice(-3).map(s=>({snapshotId:s.id,at:s.at,by:s.by,byId:s.byId,unit:s.facts.unit,form:s.facts.form})),more:Math.max(0,history.length-3)},
   taskVersionIds:[...new Set(loans.map(l=>l.referenceTransfer!.taskVersionId))].filter(id=>state.versions.some(v=>v.id===id&&v.devId===dev.id)),withdrawalHistory:{total:ref.withdrawalHistory?.length||0,records:(ref.withdrawalHistory||[]).slice(-3)},loanIds:open.slice(0,20).map(l=>l.id),openLoanCount:open.length,loansTruncated:open.length>20,...(ref.withdrawn?{withdrawn:ref.withdrawn}:{})}];
 }));
}
function currentAccess(state:MistState,actor:TokenPayload,devId:string,referenceId:string,context:ReferenceReadContext){
 const access=context.developmentReferenceAccess;if(!hasScope(actor,'products:read')||!access?.readableDevIds.includes(devId))return;
 const entry=access.referencesByDev[devId]?.find(r=>r.referenceId===referenceId),ref=findRef(state,devId,referenceId);return entry&&ref?{access,entry,ref}:undefined;
}
/** Actionable sources are complete or null. A historical snapshot is never treated as a new sample/file read. */
export function developmentReferenceCommandSources(state:MistState,actor:TokenPayload,type:string,row:any,context:ReferenceReadContext):ReferenceCommandSources{
 if(type==='development'){
  if(!Array.isArray(row.sampleReferences))return{};
  const access=context.developmentReferenceAccess,entries=access?.referencesByDev[row.id];
  if(!hasScope(actor,'products:read')||!access?.readableDevIds.includes(row.id)||!entries)return{referenceRecords:null,referenceCounts:null};
  const records:ReferenceRecordSource[]=[];for(const e of entries){
   if(!exact(e.referenceId))return{referenceRecords:null,referenceCounts:null};
   const r=findRef(state,row.id,e.referenceId),sample=r&&state.fulfillment.samples.find(s=>s.id===r.sampleId),snapshot=r?.snapshots.at(-1);
   if(e.readable&&(!r||!sample||!snapshot||![sample.id,snapshot.id].every(exact)))return{referenceRecords:null,referenceCounts:null};
   const write=hasScope(actor,'products:write')&&access.writableDevIds.includes(row.id);
   records.push({referenceId:e.referenceId,...(e.readable?{sampleId:sample!.id,snapshotId:snapshot!.id}:{}),readable:e.readable,withdrawn:e.withdrawn,canRemove:write&&e.canRemove,canDispatch:write&&e.canDispatch,canReturn:write&&e.canReturn});
  }
  const counts={readable:records.filter(r=>r.readable).length,restricted:records.filter(r=>!r.readable).length},value={references:records,readableCount:counts.readable,restrictedCount:counts.restricted};
  return{referenceRecords:JSON.stringify(value).length<=6000?value:null,referenceCounts:counts};
 }
 if(type==='development_reference'){
  const unavailable={referenceSource:null};if(![row.devId,row.referenceId,row.sampleId].every(exact)||!hasScope(actor,'products:write'))return unavailable;
  const found=currentAccess(state,actor,row.devId,row.referenceId,context),snapshot=found?.ref.snapshots.at(-1);
  if(!found?.entry.readable||!found.access.writableDevIds.includes(row.devId)||!found.access.writableSampleIds.includes(row.sampleId)||found.ref.sampleId!==row.sampleId||!snapshot||!exact(snapshot.id))return unavailable;
  return{referenceSource:{devId:row.devId,referenceId:row.referenceId,sampleId:row.sampleId,snapshotId:snapshot.id,canDispatch:found.entry.canDispatch,canRemove:found.entry.canRemove}};
 }
 if(type!=='sample_movement'||!row.referenceTransfer)return{};
 const unavailable={referenceReturnSource:null},out=row.referenceTransfer;
 if(row.kind!=='lend'||out.direction!=='out'||!hasScope(actor,'products:write')||![row.id,row.sampleId,out.devId,out.referenceId,out.dispatchId,out.taskVersionId,out.snapshotId].every(exact))return unavailable;
 const found=currentAccess(state,actor,out.devId,out.referenceId,context),loan=(state.fulfillment.sampleMovements||[]).find(m=>m.id===row.id&&m.sampleId===row.sampleId),snapshot=found?.ref.snapshots.find(s=>s.id===out.snapshotId);
 if(!loan||!found?.entry.readable||!found.entry.canReturn||!found.access.writableDevIds.includes(out.devId)||!found.access.writableSampleIds.includes(row.sampleId)||found.ref.sampleId!==row.sampleId||!snapshot||!snapshot.facts.unit)return unavailable;
 const remaining=developmentReferenceLoanRemaining(state,loan);if(!Number.isFinite(remaining)||remaining<=0)return unavailable;
 return{referenceReturnSource:{devId:out.devId,referenceId:out.referenceId,sampleId:row.sampleId,loanId:loan.id,dispatchId:out.dispatchId,taskVersionId:out.taskVersionId,snapshotId:out.snapshotId,unit:snapshot.facts.unit,quantity:loan.quantity,remaining}};
}
