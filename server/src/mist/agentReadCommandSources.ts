import type {TokenPayload} from '../auth/service';
import {hasScope} from '../auth/permissionService';
import type {PermissionScope} from '../_shared/rolePermissionMatrix';
import type {MistState,MistWorkspaceEnvelope} from '../shared/mistWorkspace';
import type {DevelopmentTaskClosePlan} from '../shared/mistDevelopmentTaskLifecycle';
import {shippingSampleSourceSnapshot,shipmentHasDeparted,type ShippingSampleSourceSnapshot} from '../shared/mistShipmentSampleCustody';

export type AgentGetContext=Pick<MistWorkspaceEnvelope,'developmentTaskClosePlans'>;
export type AgentCommandSources={
 taskClosePlan?:DevelopmentTaskClosePlan|null;
 taskReopenSource?:{devId:string;versionId:string;expectedTaskEndId:string}|null;
 shippingBasisSource?:{sourceSnapshot:ShippingSampleSourceSnapshot;reconcileDeparted:boolean}|null;
};
const exact=(v:unknown):v is string=>typeof v==='string'&&!!v&&v===v.trim()&&v.length<=200&&!v.startsWith('data:');
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const text=(v:unknown):v is string=>typeof v==='string'&&!v.startsWith('data:');
const number=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const keys=(v:unknown,expected:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...expected].sort().join('|');

/** The envelope is produced for this actor by preparedView. Never recreate its hidden followups from projected zeros. */
function currentPlan(state:MistState,actor:TokenPayload,dev:any,context:AgentGetContext):DevelopmentTaskClosePlan|null{
 if(!hasScope(actor,'products:read')||!hasScope(actor,'products:write')||!dev||dev.closure||!exact(dev.id))return null;
 const plans=context.developmentTaskClosePlans;if(!plans||!Object.prototype.hasOwnProperty.call(plans,dev.id))return null;
 const plan=plans[dev.id];if(!plan||plan.unavailable||!Array.isArray(plan.tasks)||plan.tasks.length>10_000||!plan.followups||!count(plan.followups.qcCount)||!count(plan.followups.originalLoanCount)||typeof plan.followups.financialPending!=='boolean')return null;
 const seen=new Set<string>(),tasks:DevelopmentTaskClosePlan['tasks']=[];
 for(const task of plan.tasks){
  if(!task||!exact(task.versionId)||seen.has(task.versionId)||!text(task.label)||!text(task.factory)||typeof task.canComplete!=='boolean'||!count(task.qcCount)||!count(task.originalLoanCount))return null;
  const versions=state.versions.filter(v=>v.id===task.versionId&&v.devId===dev.id);
  if(versions.length!==1||!dev.versionIds?.includes(task.versionId)||versions[0].minor||versions[0].taskEnd||versions[0].archivedAt||['abandon','resample'].includes(versions[0].qcDecision?.kind||''))return null;
  seen.add(task.versionId);tasks.push({versionId:task.versionId,label:task.label,factory:task.factory,canComplete:task.canComplete,qcCount:task.qcCount,originalLoanCount:task.originalLoanCount});
 }
 return{tasks,followups:{qcCount:plan.followups.qcCount,originalLoanCount:plan.followups.originalLoanCount,financialPending:plan.followups.financialPending},...(plan.unavailable===false?{unavailable:false}:{})};
}

/** Keep an exact command snapshot or none. Dropping unknown fields would change the server's source comparison. */
function completeShippingSnapshot(snapshot:ShippingSampleSourceSnapshot):boolean{
 if(!keys(snapshot,['sampleId','shipmentId','orderId','lineId','productionId','quantity','unit','color','sizeQuantities','shipmentQuantity','commercialUnit','packing']))return false;
 if(![snapshot.sampleId,snapshot.shipmentId,snapshot.orderId,snapshot.lineId,snapshot.productionId].every(exact)||!number(snapshot.quantity)||!number(snapshot.shipmentQuantity)||!text(snapshot.unit)||!snapshot.unit.trim()||!text(snapshot.commercialUnit)||!snapshot.commercialUnit.trim()||!text(snapshot.color)||!Array.isArray(snapshot.sizeQuantities)||!Array.isArray(snapshot.packing))return false;
 if(snapshot.sizeQuantities.some(row=>!keys(row,['size','quantity'])||!text(row.size)||!number(row.quantity)))return false;
 const ids=new Set<string>();
 for(const row of snapshot.packing){
  if(!keys(row,['id','carton','quantity','color','assortment'])||!exact(row.id)||ids.has(row.id)||!text(row.carton)||!number(row.quantity)||!text(row.color)||!Array.isArray(row.assortment)||row.assortment.some(item=>!keys(item,['color','size','quantity'])||!text(item.color)||!text(item.size)||!number(item.quantity)))return false;
  ids.add(row.id);
 }
 return true;
}

export function agentCommandSources(state:MistState,actor:TokenPayload,type:string,row:any,context:AgentGetContext):AgentCommandSources{
 if(type==='development')return{taskClosePlan:currentPlan(state,actor,row,context)};
 if(type==='dev_version'){
  const devs=state.devs.filter(dev=>dev.id===row.devId),dev=devs.length===1?devs[0]:undefined;
  const plan=currentPlan(state,actor,dev,context),end=row.taskEnd;
  const available=plan&&dev&&!row.minor&&!row.archivedAt&&!['abandon','resample'].includes(row.qcDecision?.kind||'')&&dev.versionIds.includes(row.id)&&state.versions.filter(v=>v.id===row.id).length===1&&exact(row.id)&&end&&['completed','terminated'].includes(end.kind)&&exact(end.id);
  return{taskReopenSource:available?{devId:dev.id,versionId:row.id,expectedTaskEndId:end.id}:null};
 }
 if(type!=='sample')return{};
 const unavailable:AgentCommandSources={shippingBasisSource:null};
 // These are existing source kinds/scopes, including the signed delegation ceiling. A visible sample alone is insufficient.
 if(!['products:read','orders:read','production:read','shipments:read'].every(scope=>hasScope(actor,scope as PermissionScope))||row.role!=='shipping'||row.shippingQuantityBasis?.consumption||row.source?.kind!=='orderLine')return unavailable;
 const source=row.source,shipments=state.fulfillment.shipments.filter(s=>s.id===row.shipmentId);
 if(![row.id,row.shipmentId,source.orderId,source.lineId,source.productionId].every(exact)||state.fulfillment.samples.filter(s=>s.id===row.id).length!==1||state.orders.filter(o=>o.id===source.orderId).length!==1||state.orderLines.filter(l=>l.id===source.lineId&&l.orderId===source.orderId).length!==1||state.productions.filter(p=>p.id===source.productionId&&p.orderId===source.orderId&&p.lineId===source.lineId).length!==1||shipments.length!==1)return unavailable;
 try{
  const snapshot=shippingSampleSourceSnapshot(state,row);if(!completeShippingSnapshot(snapshot))return unavailable;
  return{shippingBasisSource:{sourceSnapshot:snapshot,reconcileDeparted:shipmentHasDeparted(shipments[0])}};
 }catch{return unavailable;}
}

/** Preserve the applicable metadata field, but never send a prefix of a command plan/snapshot. */
export function unavailableCommandSources(metadata:AgentCommandSources):AgentCommandSources{
 return Object.fromEntries(Object.keys(metadata).map(key=>[key,null]));
}
