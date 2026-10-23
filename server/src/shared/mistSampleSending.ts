import {MistCommandError,type MistState} from './mistWorkspace';
import type {FulfillmentSample} from './mistFulfillment';
export type SampleSendPurpose='confirmation'|'testing'|'rework'|'other';
export const SAMPLE_SEND_PURPOSES:Record<SampleSendPurpose,string>={confirmation:'客户确认',testing:'外部测试',rework:'工厂整改',other:'其他用途'};
export function sampleSendPurpose(value:unknown,sample:Pick<FulfillmentSample,'source'>):SampleSendPurpose{
 if(value===undefined)return sample.source.kind==='manual'?'other':'confirmation';
 if(typeof value!=='string'||!Object.prototype.hasOwnProperty.call(SAMPLE_SEND_PURPOSES,value))throw new MistCommandError('VALIDATION','寄送用途无效');
 return value as SampleSendPurpose;
}
/** Confirmation quality follows the exact physical item, including any later material change. */
export function sampleConfirmationBlocker(state:MistState,sample:FulfillmentSample):string|null{
 const source=sample.source;if(source.kind==='manual')return '确认样须关联开发或订单来源';
 const version=source.kind==='version'?state.versions.find(v=>v.id===source.versionId):undefined;
 if(source.kind==='version'&&state.devs.find(dev=>dev.id===source.devId)?.closure?.kind==='cancelled')return '开发案已取消，不能寄客户确认样';
 if(source.kind==='orderLine'&&['cancelled','void'].includes(state.orders.find(order=>order.id===source.orderId)?.governance?.status||''))return '订单已终止，不能寄客户确认样';
 if(version?.qc?.result==='reject')return '本版QC不通过，不能寄客户确认样';
 if(version?.qcDecision)return '本版待整改或已不采用，不能寄客户确认样';
 const tasks=state.fulfillment.qcTasks.filter(task=>task.sampleId===sample.id&&task.kind==='sample'&&task.source.kind===source.kind&&(source.kind==='version'?task.source.kind==='version'&&task.source.devId===source.devId&&task.source.versionId===source.versionId:task.source.kind==='orderLine'&&task.source.orderId===source.orderId&&task.source.lineId===source.lineId&&task.source.productionId===source.productionId));
 const task=tasks.at(-1);
 if(task){
  const report=state.fulfillment.qcReports.find(report=>report.id===task.reportIds.at(-1));
  return task.state==='reported'&&report&&report.result!=='reject'&&report.scopeRevision===(sample.qualityRevision||1)?null:'本件实物QC未通过，不能寄客户确认样';
 }
 // Direct professional development reports cover a single original item, never an added uninspected form.
 if(source.kind==='version'&&version?.returnedAt&&version.qc&&(sample.qualityRevision||1)===1&&state.fulfillment.samples.filter(item=>item.source.kind==='version'&&item.source.versionId===source.versionId).length===1)return null;
 return '本件实物尚未完成QC，不能寄客户确认样';
}
export function sampleSendBlocker(state:MistState,sample:FulfillmentSample,purpose:SampleSendPurpose,note:string,explicit=true):string|null{
 if(purpose==='confirmation')return sampleConfirmationBlocker(state,sample);
 if(explicit&&!note.trim())return '请填写本次寄送用途说明';
 return null;
}
