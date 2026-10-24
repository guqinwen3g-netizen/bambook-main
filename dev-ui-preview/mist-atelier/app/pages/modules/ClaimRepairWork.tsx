import React from 'react';
import {Button,Facts,Mono,Pill} from '../../../../../components/mist';
import {uiText} from '../../../../../services/interfaceLanguage';
import type {MistState} from '../../../../../server/src/shared/mistWorkspace';
import type {PlatformClaimGoods} from '../../../../../server/src/shared/mistPlatform';
import {latestClaimRepair,type ClaimInventoryCommand,type ClaimReceivedRecord,type ClaimRepairJob} from '../../../../../server/src/shared/mistClaimInventory';
import {field,text,today,RecordFiles} from './fulfillmentKit';
import {RecordDisclosure} from './pageKit';
import type {ModuleEditorSpec,ModuleValues} from './ModuleWorkbench';

type Command=(command:ClaimInventoryCommand)=>Promise<unknown>;
const ids=(v:ModuleValues)=>text(v,'fileId')?[text(v,'fileId')]:[];
const evidence=(state:MistState,goods:PlatformClaimGoods)=>{
 const claim=state.platform.claims.find(row=>row.id===goods.claimId),allowed=new Set([...claim?.fileIds??[],...claim?.dispositions.find(row=>row.id===goods.dispositionId)?.fileIds??[]]);
 return field('fileId','凭据附件','select',false,[{value:'',label:'无附件'},...state.files.filter(row=>allowed.has(row.id)).map(row=>({value:row.id,label:row.name}))]);
};
export function repairRecordSpec(state:MistState,goods:PlatformClaimGoods,record:ClaimReceivedRecord,command:Command):ModuleEditorSpec{
 const factory=state.productions.find(row=>row.id===goods.source?.productionId)?.factory,matches=state.market.suppliers.filter(row=>row.name===factory);
 return{title:'维修登记',description:record.batchNumber+' · '+record.quantity+' '+record.unit,fields:[{...field('batch','返修批次','text',false),readonly:true},{...field('place','维修地点','text',false),readonly:true},field('supplierId','维修工厂','select',true,[{value:'',label:'请选择'},...state.market.suppliers.map(row=>({value:row.id,label:row.name}))]),field('technician','维修人员'),field('completedAt','维修日期','date'),field('basis','维修记录','textarea'),evidence(state,goods)],initialValues:{batch:record.batchNumber+' · '+record.quantity+' '+record.unit,place:(state.fulfillment.warehouses.find(row=>row.id===record.warehouseId)?.name||'')+' · '+record.location,supplierId:matches.length===1?matches[0].id:'',technician:'',completedAt:today(),basis:'',fileId:''},submit:v=>command({type:'fulfillment.claimInventory.repair.record',payload:{goodsId:goods.id,receivedEventId:record.id,supplierId:text(v,'supplierId'),technician:text(v,'technician'),completedAt:text(v,'completedAt'),basis:text(v,'basis'),fileIds:ids(v)}})};
}
export function repairHandbackSpec(state:MistState,goods:PlatformClaimGoods,job:ClaimRepairJob,command:Command):ModuleEditorSpec{
 return{title:'返修交还',description:job.batchNumber+' · '+job.quantity+' '+job.unit,fields:[{...field('batch','返修批次','text',false),readonly:true},{...field('customer','客户','text',false),readonly:true},field('recipient','客户接收人'),field('date','交还日期','date'),field('reference','交接凭据'),field('basis','交接记录','textarea'),evidence(state,goods)],initialValues:{batch:job.batchNumber+' · '+job.quantity+' '+job.unit,customer:state.customers.find(row=>row.id===goods.source?.customerId)?.name||'',recipient:'',date:today(),reference:'',basis:'',fileId:''},submit:v=>command({type:'fulfillment.claimInventory.repair.handback',payload:{goodsId:goods.id,repairId:job.id,date:text(v,'date'),recipient:text(v,'recipient'),reference:text(v,'reference'),basis:text(v,'basis'),fileIds:ids(v)}})};
}
export function ClaimRepairWork({goods,state,receivedEventId,busy,canInspect,openEditor,command}:{goods:PlatformClaimGoods;state:MistState;receivedEventId?:string;busy:boolean;canInspect?:(domain:'fabric'|'garment')=>boolean;openEditor?:(spec:ModuleEditorSpec)=>void;command?:Command}){
 const jobs=(goods.repairs??[]).filter(row=>!receivedEventId||row.receivedEventId===receivedEventId);
 if(!jobs.length)return null;
 const inspect=(job:ClaimRepairJob)=>{if(!openEditor||!command)return;openEditor({title:'返修复检',description:job.batchNumber+' · '+job.quantity+' '+job.unit,fields:[{...field('batch','受检批次','text',false),readonly:true},field('result','复检结果','select',true,[{value:'',label:'请选择'},{value:'pass',label:'合格'},{value:'fail',label:'不合格'}]),field('checkedAt','复检日期','date'),field('basis','复检记录','textarea'),evidence(state,goods)],initialValues:{batch:job.batchNumber+' · '+job.quantity+' '+job.unit,result:'',checkedAt:today(),basis:'',fileId:''},submit:v=>command({type:'fulfillment.claimInventory.repair.qc',payload:{goodsId:goods.id,repairId:job.id,result:text(v,'result') as 'pass'|'fail',checkedAt:text(v,'checkedAt'),basis:text(v,'basis'),fileIds:ids(v)}})});};
 return <div className="mist-col">{jobs.map(job=>{const current=latestClaimRepair(goods,job.receivedEventId)?.id===job.id,terminal=['Closed','Cancelled'].includes(state.platform.claims.find(row=>row.id===goods.claimId)?.state||'');return <div className="mist-col" key={job.id}>
  <div className="mist-row"><Mono>{job.batchNumber}</Mono><span>{job.quantity} {uiText(job.unit)}</span><Pill tone={job.handback?'ok':job.qc?.result==='fail'?'bad':job.qc?.result==='pass'?'ok':'warn'}>{uiText(job.handback?'已交还':job.qc?.result==='pass'?'复检合格':job.qc?.result==='fail'?'复检不合格':'待复检')}</Pill>{current&&!job.qc&&!terminal&&canInspect?.(job.domain)&&openEditor&&command&&<Button size="sm" disabled={busy} onClick={()=>inspect(job)}>{uiText('登记复检')}</Button>}</div>
  <RecordDisclosure title={uiText('维修记录')}><Facts items={[{label:'维修工厂',value:job.supplierName},{label:'维修人员',value:job.technician},{label:'维修地点',value:job.place},{label:'维修日期',value:job.completedAt},{label:'维修记录',value:job.basis},{label:'登记人',value:job.actor}]} /><RecordFiles ids={job.fileIds}/></RecordDisclosure>
  {job.qc&&<RecordDisclosure title={uiText('复检记录')}><Facts items={[{label:'复检日期',value:job.qc.checkedAt},{label:'复检记录',value:job.qc.basis},{label:'复检人',value:job.qc.actor}]} /><RecordFiles ids={job.qc.fileIds}/></RecordDisclosure>}
  {job.handback&&<RecordDisclosure title={uiText('交接记录')}><Facts items={[{label:'交还日期',value:job.handback.date},{label:'客户接收人',value:job.handback.recipient},{label:'交接凭据',value:job.handback.reference},{label:'交接记录',value:job.handback.basis},{label:'经办人',value:job.handback.actor}]} /><RecordFiles ids={job.handback.fileIds}/></RecordDisclosure>}
 </div>;})}</div>;
}
