import {MistCommandError,type MistCommandResult,type MistContext,type MistDev,type MistState} from './mistWorkspace';
import {applyFulfillmentCommand,sampleLoanRemaining,type FulfillmentSample,type FulfillmentSampleSource,type FulfillmentSizeQuantity,type IncomingDelivery,type SampleMovement} from './mistFulfillment';
import {developmentFactoryWorkBlocker} from './mistDevelopmentTaskLifecycle';
import {creditDocumentFingerprint} from './mistCreditDocuments';
import {productionSupplierUnavailableReason} from './mistSupplierStatus';
import {platformBusinessDate} from './mistPlatform';
import {isCalendarDay} from './mistBusinessClock';
import {notifyMist,notificationOwners} from './mistNotifications';
import {normalizeDevelopmentDelivery,normalizeDevelopmentPostage,type IncomingPostage} from './mistDevelopmentIncoming';
export type DevelopmentReferenceFacts={source?:FulfillmentSampleSource;code:string;name:string;category:string;form:string;quantity:number;unit:string;size:string;color:string;sizeQuantities?:FulfillmentSizeQuantity[];registeredById?:string;fileIds:string[]};
export type DevelopmentReferenceSnapshot={id:string;facts:DevelopmentReferenceFacts;purpose:string;sourceHash:string;hash:string;at:string;by:string;byId:string};
export type DevelopmentSampleReference={id:string;sampleId:string;purpose:string;linkedAt:string;linkedBy:string;linkedById:string;snapshots:DevelopmentReferenceSnapshot[];withdrawn?:{at:string;by:string;byId:string;reason:string};withdrawalHistory?:Array<{at:string;by:string;byId:string;reason:string}>};
export type DevelopmentReferenceTransfer={devId:string;taskVersionId:string;referenceId:string;snapshotId:string;dispatchId:string;supplierId:string;supplierName:string;direction:'out'|'return';occurredAt:string;delivery:IncomingDelivery;returnBatchId?:string;postage?:IncomingPostage;expenseId?:string};
export type DevelopmentReferenceAccess={readableDevIds:string[];writableDevIds:string[];writableSampleIds:string[];referencesByDev:Record<string,Array<{referenceId:string;readable:boolean;canRemove:boolean;canDispatch:boolean;canReturn:boolean;blocker?:string}>>};
export type DevelopmentReferenceCommand=
 |{type:'development.reference.add';payload:{devId:string;sampleId:string;purpose:string;fileIds?:string[]}}
 |{type:'development.reference.remove';payload:{devId:string;referenceId:string;reason:string}}
 |{type:'development.reference.dispatch';payload:{devId:string;taskVersionId:string;items:Array<{referenceId:string;quantity:number;sourceLocation:string}>;sentAt:string;expectedReturn?:string;delivery:IncomingDelivery;postage:IncomingPostage;note:string}}
 |{type:'development.reference.return';payload:{devId:string;dispatchId:string;items:Array<{loanId:string;quantity:number;location:string}>;receivedAt:string;delivery:IncomingDelivery;note:string}};
const fail=(message:string,code='VALIDATION',status=422):never=>{throw new MistCommandError(code,message,status);};
const text=(v:unknown,label:string,required=true,max=1000)=>typeof v==='string'&&(!required||v.trim())&&v.trim().length<=max?v.trim():fail('请填写'+label);
const qty=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0?v:fail('请填写正数数量');
const day=(v:unknown,label:string,ctx:MistContext)=>{const s=text(v,label,true,10);if(!isCalendarDay(s)||s>platformBusinessDate(ctx.now))fail(label+'无效或在未来');return s;};
const exact=(value:object,keys:string[])=>{if(!value||typeof value!=='object'||Array.isArray(value))fail('参考实物字段格式无效');if(Object.keys(value).some(k=>!keys.includes(k)))fail('参考实物来源、身份与历史由服务端记录');};
const list=<T,>(items:T[],key:(v:T)=>string)=>{if(!Array.isArray(items)||!items.length||items.length>100||items.some(v=>!v||typeof v!=='object'||Array.isArray(v)))fail('请选择1至100条准确实物');if(new Set(items.map(key)).size!==items.length)fail('同一实物位置不能重复选择');return items;};
export function developmentReferenceFacts(sample:FulfillmentSample,fileIds=sample.fileIds):DevelopmentReferenceFacts{return{source:structuredClone(sample.source),code:sample.code,name:sample.name,category:sample.category,form:sample.form,quantity:sample.quantity,unit:sample.unit,size:sample.size,color:sample.color,...(sample.sizeQuantities?{sizeQuantities:structuredClone(sample.sizeQuantities)}:{}),...(sample.registeredById?{registeredById:sample.registeredById}:{}),fileIds:[...fileIds].sort()};}
/** Original identity/specification hash excludes live balance and location. A reference never reserves inventory. */
export const developmentReferenceSourceHash=(sample:FulfillmentSample)=>creditDocumentFingerprint({facts:developmentReferenceFacts(sample),sourceFileOrder:[...sample.fileIds],qualityRevision:sample.qualityRevision,sourceSampleCode:sample.sourceSampleCode,materialPlan:sample.materialPlan,role:sample.role,shipmentId:sample.shipmentId,...(sample.shippingQuantityBasis?{shippingBasis:{id:sample.shippingQuantityBasis.id,kind:sample.shippingQuantityBasis.kind,sourceSnapshot:sample.shippingQuantityBasis.sourceSnapshot,evidence:sample.shippingQuantityBasis.evidence,independentSource:sample.shippingQuantityBasis.independentSource,fileIds:sample.shippingQuantityBasis.fileIds}}:{})});
export function developmentReferenceLoans(state:MistState,devId:string,referenceId?:string){return(state.fulfillment.sampleMovements||[]).filter(m=>m.kind==='lend'&&m.referenceTransfer?.devId===devId&&(!referenceId||m.referenceTransfer.referenceId===referenceId));}
export function developmentReferenceLoanRemaining(state:MistState,loan:SampleMovement){return Math.max(0,sampleLoanRemaining(state,loan.id));}
function refOf(dev:MistDev,id:string){const ref=dev.sampleReferences?.find(r=>r.id===id);return ref||fail('参考关系不存在','NOT_FOUND',404);}
function sampleOf(state:MistState,id:string){return state.fulfillment.samples.find(s=>s.id===id)||fail('参考实物不可读取','NOT_FOUND',404);}
function event(state:MistState,ctx:MistContext,dev:MistDev,message:string){state.events.unshift({id:ctx.id(),entityType:'development',entityId:dev.id,actor:ctx.actorName,at:ctx.auditNow??ctx.now,text:message,fileIds:[]});notifyMist(state,ctx,{title:message,detail:ctx.actorName,target:{view:'development/detail',id:dev.id,section:'references'},category:'general'},notificationOwners(state,'development',dev.id));}
export function applyDevelopmentReferenceCommand(state:MistState,command:DevelopmentReferenceCommand,ctx:MistContext):MistCommandResult{
 const p=command.payload;if(!p||typeof p!=='object'||Array.isArray(p))fail('参考实物字段格式无效');const dev=state.devs.find(d=>d.id===p.devId);if(!dev)fail('开发案不可读取','NOT_FOUND',404);if(!ctx.actorId)fail('缺少真实办理账号');
 if(['development.reference.add','development.reference.dispatch'].includes(command.type)&&dev!.closure)fail('开发案已结束，请先恢复后办理参考实物','PRECONDITION');
 if(command.type==='development.reference.add'){
  const p=command.payload;exact(p,['devId','sampleId','purpose','fileIds']);const sample=sampleOf(state,p.sampleId),purpose=text(p.purpose,'参考用途'),fileIds=p.fileIds===undefined?[]:p.fileIds;
  if(!Array.isArray(fileIds)||fileIds.length>100||new Set(fileIds).size!==fileIds.length||fileIds.some(id=>!sample.fileIds.includes(id)||!state.files.some(f=>f.id===id)))fail('原件须来自当前参考实物');
  const refs=dev!.sampleReferences||=[],existing=refs.find(r=>r.sampleId===sample.id),facts=developmentReferenceFacts(sample,fileIds),sourceHash=developmentReferenceSourceHash(sample),hash=creditDocumentFingerprint({facts,purpose});
  if(existing&&!existing.withdrawn&&existing.snapshots.at(-1)?.hash===hash&&existing.snapshots.at(-1)?.sourceHash===sourceHash)return{devId:dev!.id,referenceId:existing.id,id:existing.id,unchanged:true};
  if(!existing&&refs.length>=100)fail('本案最多引用100件实物');if((existing?.snapshots.length||0)>=100)fail('参考复核历史已达上限');
  const snapshot:DevelopmentReferenceSnapshot={id:ctx.id(),facts,purpose,sourceHash,hash,at:ctx.now,by:ctx.actorName,byId:ctx.actorId!};
  if(existing){if(existing.withdrawn){(existing.withdrawalHistory||=[]).push({...existing.withdrawn});delete existing.withdrawn;}existing.purpose=purpose;existing.snapshots.push(snapshot);}
  else (dev!.sampleReferences||=[]).push({id:ctx.id(),sampleId:sample.id,purpose,linkedAt:ctx.now,linkedBy:ctx.actorName,linkedById:ctx.actorId!,snapshots:[snapshot]});
  const ref=dev!.sampleReferences!.find(r=>r.sampleId===sample.id)!;dev!.updatedAt=ctx.now;event(state,ctx,dev!,existing?'复核参考实物':'引用参考实物');return{devId:dev!.id,id:ref.id,referenceId:ref.id,snapshotId:snapshot.id};
 }
 if(command.type==='development.reference.remove'){
  const p=command.payload;exact(p,['devId','referenceId','reason']);const ref=refOf(dev!,p.referenceId);if(ref.withdrawn)fail('参考关系已撤回');if(developmentReferenceLoans(state,dev!.id,ref.id).some(m=>developmentReferenceLoanRemaining(state,m)>0))fail('参考实物尚未归还，不能撤回');
  ref.withdrawn={at:ctx.now,by:ctx.actorName,byId:ctx.actorId!,reason:text(p.reason,'撤回原因')};dev!.updatedAt=ctx.now;event(state,ctx,dev!,'撤回参考实物');return{devId:dev!.id,id:ref.id,referenceId:ref.id};
 }
 if(command.type==='development.reference.dispatch'){
  const p=command.payload;exact(p,['devId','taskVersionId','items','sentAt','expectedReturn','delivery','postage','note']);const version=state.versions.find(v=>v.id===p.taskVersionId&&v.devId===dev!.id&&dev!.versionIds.includes(v.id));
  if(!version?.task||version.minor)fail('请选择本案准确工厂任务');const blocked=developmentFactoryWorkBlocker(state,dev!,version!);if(blocked)fail(blocked,'PRECONDITION');if(version!.archivedAt||version!.qcDecision&&version!.qcDecision.kind!=='rework')fail('工厂任务已结束，请先核对');
  const supplier=state.market.suppliers.find(s=>s.id===version!.factoryId);if(!supplier)fail('工厂资料不存在');const unavailable=productionSupplierUnavailableReason(supplier!,platformBusinessDate(ctx.now));if(unavailable)fail(unavailable,'PRECONDITION');
  const occurredAt=day(p.sentAt,'实际寄送日',ctx),delivery=normalizeDevelopmentDelivery(p.delivery),postage=normalizeDevelopmentPostage(p.postage),dispatchId=ctx.id(),movementIds:string[]=[];
  const taskCreatedAt=(version!.roundId?state.rounds?.find(r=>r.id===version!.roundId&&r.devId===dev!.id)?.createdAt:undefined)||dev!.createdAt;
  if(taskCreatedAt&&Number.isFinite(Date.parse(taskCreatedAt))&&occurredAt<platformBusinessDate(taskCreatedAt))fail('寄送日不得早于工厂任务建立日');
  if(p.expectedReturn&&(!isCalendarDay(p.expectedReturn)||p.expectedReturn<occurredAt))fail('预计归还日不得早于寄送日');
  for(const item of list(p.items,v=>JSON.stringify([v.referenceId,v.sourceLocation]))){
   exact(item,['referenceId','quantity','sourceLocation']);const ref=refOf(dev!,item.referenceId);if(ref.withdrawn)fail('参考关系已撤回');const sample=sampleOf(state,ref.sampleId),snapshot=ref.snapshots.at(-1)!;
   if(snapshot.sourceHash!==developmentReferenceSourceHash(sample))fail('参考实物资料已变化，请重新核对引用','REVISION_CONFLICT',409);
   // The original source and its shipping/incoming custody blockers remain authoritative.
   const result=applyFulfillmentCommand(state,{type:'fulfillment.samples.move',payload:{id:sample.id,kind:'lend',quantity:qty(item.quantity),person:delivery.recipient,location:delivery.address,sourceLocation:item.sourceLocation,...(p.expectedReturn?{expectedReturn:p.expectedReturn}:{}),note:text(p.note||'','寄送说明',false)}},ctx,{externalBorrower:true,loanStartedOn:occurredAt});
   const move=state.fulfillment.sampleMovements.find(m=>m.id===result.id)!;move.carrier=delivery.carrier;move.trackingNo=delivery.trackingNo;move.destination=delivery.address;move.referenceTransfer={devId:dev!.id,taskVersionId:version!.id,referenceId:ref.id,snapshotId:snapshot.id,dispatchId,supplierId:supplier!.id,supplierName:supplier!.name,direction:'out',occurredAt,delivery};movementIds.push(move.id);
  }
  const first=state.fulfillment.sampleMovements.find(m=>m.id===movementIds[0])!;first.referenceTransfer!.postage=postage;
  if(postage.amount>0){const expenseId=ctx.id();(dev!.billing||={makingFees:[]}).expenses||=[];dev!.billing.expenses.push({id:expenseId,versionId:version!.id,amount:postage.amount,currency:postage.currency,description:'参考实物寄厂邮费 · '+supplier!.name+' · '+(delivery.trackingNo||delivery.evidence),date:occurredAt,at:ctx.now,actor:ctx.actorName,sourceDispatchId:dispatchId,sourceMovementIds:[...movementIds]});first.referenceTransfer!.expenseId=expenseId;}
  dev!.updatedAt=ctx.now;event(state,ctx,dev!,'参考实物寄厂 '+version!.label);return{devId:dev!.id,id:dispatchId,dispatchId,movementIds};
 }
 const pReturn=command.payload;exact(pReturn,['devId','dispatchId','items','receivedAt','delivery','note']);const occurredAt=day(pReturn.receivedAt,'实际归还日',ctx),delivery=normalizeDevelopmentDelivery(pReturn.delivery),returnBatchId=ctx.id(),movementIds:string[]=[];
 for(const item of list(pReturn.items,v=>JSON.stringify([v.loanId,v.location]))){
  exact(item,['loanId','quantity','location']);const loan=state.fulfillment.sampleMovements.find(m=>m.id===item.loanId&&m.kind==='lend'),out=loan?.referenceTransfer;
  if(!loan||!out||out.direction!=='out'||out.devId!==dev!.id||out.dispatchId!==pReturn.dispatchId)fail('归还须引用本案同票准确原借出');if(occurredAt<out!.occurredAt)fail('归还日不得早于实际借出日');
  const ref=refOf(dev!,out!.referenceId);if(ref.sampleId!==loan!.sampleId)fail('原借出实物与参考关系不一致');sampleOf(state,loan!.sampleId);
  // Returns depend on the original loan and remaining quantity, not an obsolete comparison snapshot.
  const result=applyFulfillmentCommand(state,{type:'fulfillment.samples.move',payload:{id:loan!.sampleId,kind:'return',loanId:loan!.id,quantity:qty(item.quantity),person:ctx.actorName,location:text(item.location,'归还位置',false,200),note:text(pReturn.note||'','归还说明',false)}},ctx);
  const move=state.fulfillment.sampleMovements.find(m=>m.id===result.id)!;move.carrier=delivery.carrier;move.trackingNo=delivery.trackingNo;move.destination=delivery.address;move.referenceTransfer={...out!,direction:'return',occurredAt,delivery,returnBatchId};delete move.referenceTransfer.postage;delete move.referenceTransfer.expenseId;movementIds.push(move.id);
 }
 dev!.updatedAt=ctx.now;event(state,ctx,dev!,'参考实物归还');return{devId:dev!.id,id:returnBatchId,returnBatchId,movementIds};
}

/** Exact optimistic-read basis. Return balances use the original loan, not comparison text or attachment metadata. */
export function developmentReferenceReadKeys(state:MistState,command:DevelopmentReferenceCommand):string[][]{
 const p=command.payload,dev=state.devs.find(d=>d.id===p.devId),base=[['k:devs','i:'+p.devId,'k:closure']];
 const refKey=(id:string)=>['k:devs','i:'+p.devId,'k:sampleReferences','i:'+id];
 if(command.type==='development.reference.add')return[...base,['k:devs','i:'+p.devId,'k:sampleReferences'],['k:fulfillment','k:samples','i:'+command.payload.sampleId],...(command.payload.fileIds||[]).map(id=>['k:files','i:'+id])];
 if(command.type==='development.reference.remove'){
  const id=command.payload.referenceId;return[...base,refKey(id),...developmentReferenceLoans(state,p.devId,id).flatMap(loan=>[['k:fulfillment','k:sampleMovements','i:'+loan.id],['k:fulfillment','k:samples','i:'+loan.sampleId,'k:available']])];
 }
 if(command.type==='development.reference.dispatch'){
  const task=state.versions.find(v=>v.id===command.payload.taskVersionId);return[...base,['k:versions','i:'+command.payload.taskVersionId],...(task?[['k:market','k:suppliers','i:'+task.factoryId]]:[]),...command.payload.items.flatMap(item=>{const ref=dev?.sampleReferences?.find(r=>r.id===item.referenceId);return[refKey(item.referenceId),...(ref?[['k:fulfillment','k:samples','i:'+ref.sampleId]]:[])];})];
 }
 return[...base,...command.payload.items.flatMap(item=>{const loan=state.fulfillment.sampleMovements.find(m=>m.id===item.loanId);return[['k:fulfillment','k:sampleMovements','i:'+item.loanId],...(loan?['source','quantity','available','positions','unit'].map(field=>['k:fulfillment','k:samples','i:'+loan.sampleId,'k:'+field]):[])];})];
}
