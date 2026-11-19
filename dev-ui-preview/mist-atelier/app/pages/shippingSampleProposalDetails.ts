import type {AgentProposalCommandBody} from '../../../../server/src/shared/mistAgentProposals';
import type {MistState} from '../../../../server/src/shared/mistWorkspace';
import {confirmShippingSampleBasis,shippingSampleSourceSnapshot,shipmentHasDeparted,type ShippingSampleBasisInput} from '../../../../server/src/shared/mistShipmentSampleCustody';
import {stableJson} from '../../../../server/src/shared/stableJson';

export type ShippingSampleProposalReview={title:string;reason:string;rows:Array<{field:string;path:string;value:string}>;fingerprint:string};
const exactKeys=(value:unknown,allowed:string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
/** Current server-projected state and current session write authority only; a proposal never grants its own capability. */
export function shippingSampleProposalDetails(command:AgentProposalCommandBody,state:MistState|null|undefined,canWrite:boolean):ShippingSampleProposalReview|null{
 if(command.type!=='fulfillment.samples.shippingBasis')return null;
 const title='确认样品数量口径',blocked=(reason:string):ShippingSampleProposalReview=>({title,reason,rows:[],fingerprint:''});
 if(!state)return blocked('正在读取样品资料，请稍后核对');
 if(canWrite!==true)return blocked('当前账号不能确认样品数量口径');
 const p=command.payload;
 if(!exactKeys(command,['type','payload'])||!exactKeys(p,['id','kind','sourceSnapshot','evidence','independentSource','fileIds','reconcileDeparted']))return blocked('数量口径内容无法完整核对，请重新提出提议');
 const sample=typeof p.id==='string'?state.fulfillment.samples.find(s=>s.id===p.id):undefined;
 const shipment=sample?state.fulfillment.shipments.find(s=>s.id===sample.shipmentId):undefined;
 if(!sample?.code||!shipment?.code)return blocked('样品或本批出运来源不可见，请重新核对');
 if(!Array.isArray(p.fileIds)||p.fileIds.some(id=>typeof id!=='string'||!state.files.some(f=>f.id===id&&!!f.name)))return blocked('依据附件不可见，请重新核对');
 let snapshot:ReturnType<typeof shippingSampleSourceSnapshot>;
 try{
  snapshot=shippingSampleSourceSnapshot(state,sample);
  if(stableJson(p.sourceSnapshot)!==stableJson(snapshot))return blocked('样品或装箱来源已变化，请重新核对');
  // Only the target sample and movement list can change in this validator. Avoid
  // copying the whole company on each review input while keeping its data immutable.
  const preview={...state,fulfillment:{...state.fulfillment,samples:state.fulfillment.samples.map(row=>row.id===sample.id?structuredClone(row):row),sampleMovements:[...state.fulfillment.sampleMovements]}};
  confirmShippingSampleBasis(preview,p as unknown as ShippingSampleBasisInput,{id:()=> 'proposal-preview',now:state.settings.businessClock?.at||sample.createdAt,actorName:'确认预览'});
 }catch(error){return blocked(error instanceof Error?error.message:'数量口径当前不可办理，请重新核对');}
 const rows:ShippingSampleProposalReview['rows']=[],add=(field:string,value:string)=>rows.push({field,path:'shippingSampleReview.'+rows.length,value});
 add('样品',sample.code);add('实物数量',sample.quantity+' '+sample.unit);add('出运批次',shipment.code);add('数量口径',p.kind==='included'?'大货内随本批出运':'独立实物（不占本批大货）');add('补记',shipmentHasDeparted(shipment)?'是':'否');
 if(p.kind==='independent')add('独立实物来源与保管依据',String(p.independentSource).trim());add('确认依据',String(p.evidence).trim());
 const fileIds=p.fileIds as string[];if(fileIds.length)add('附件',fileIds.map(id=>state.files.find(f=>f.id===id)!.name).join('；'));
 if(rows.some(row=>row.value.length>4000))return blocked('内容过多，无法完整核对，请重新提出提议');
 const loans=state.fulfillment.sampleMovements.filter(m=>m.sampleId===sample.id&&(m.kind==='lend'||m.kind==='return'));
 return {title,reason:'',rows,fingerprint:stableJson([command,snapshot,sample.available,sample.positions,sample.shippingQuantityBasis,loans,shipmentHasDeparted(shipment),shipment.state,shipment.departedAt,shipment.departureEvidence,fileIds.map(id=>{const f=state.files.find(f=>f.id===id)!;return {id:f.id,name:f.name,size:f.size};})])};
}
