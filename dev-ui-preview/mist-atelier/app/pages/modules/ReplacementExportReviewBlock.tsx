import React from 'react';
import {Button,Facts} from '../../../../../components/mist';
import {uiText,ui} from '../../../../../services/interfaceLanguage';
import type {MistCommand,MistState} from '../../../../../server/src/shared/mistWorkspace';
import type {FulfillmentCustoms} from '../../../../../server/src/shared/mistFulfillment';
import {field,RecordFiles,text} from './fulfillmentKit';
import {DetailBlock} from './pageKit';
import type {ModuleEditorSpec} from './ModuleWorkbench';

export function ReplacementExportReviewBlock({state,customs,can,busy,open,run}:{state:MistState;customs:FulfillmentCustoms;can:boolean;busy:boolean;open:(spec:ModuleEditorSpec)=>void;run:(command:MistCommand)=>Promise<unknown>}){
 const shipment=state.fulfillment.shipments.find(s=>s.id===customs.shipmentId),ids=new Set(shipment?.lines.map(line=>line.orderId)),orders=state.orders.filter(order=>ids.has(order.id)&&order.replacementSource);
 if(!orders.length)return null;
 return <>{orders.map(order=>{const review=customs.replacementReviews?.find(row=>row.orderId===order.id),line=state.orderLines.find(line=>line.orderId===order.id),issued=state.fulfillment.documents.some(d=>d.shipmentId===shipment?.id&&d.orderId===order.id&&d.type==='CI'&&d.status==='issued');
 const edit=()=>open({title:'核对补发出口',fields:[field('unitPrice',ui`申报单价（${order.currency}/${uiText(line?.unit??'件')}）`,'number'),field('originalDeclarationNo','原出口单号'),field('returnReference','退运依据'),field('taxHandling','退税处理','textarea'),field('basis','估价依据','textarea'),field('fileId','核对附件','select',true,state.files.map(file=>({value:file.id,label:file.name})))],initialValues:{unitPrice:review?.unitPrice??'',originalDeclarationNo:review?.originalDeclarationNo??'',returnReference:review?.returnReference??'',taxHandling:review?.taxHandling??'',basis:review?.basis??'',fileId:review?.fileIds[0]??''},submit:v=>run({type:'fulfillment.customs.reviewReplacement',payload:{id:customs.id,orderId:order.id,unitPrice:Number(v.unitPrice),originalDeclarationNo:text(v,'originalDeclarationNo'),returnReference:text(v,'returnReference'),taxHandling:text(v,'taxHandling'),basis:text(v,'basis'),fileIds:[text(v,'fileId')]}})});
 return <DetailBlock key={order.id} title={uiText('补发出口')} aside={can&&customs.status==='draft'&&!['departed','cancelled'].includes(shipment?.state??'')?<Button disabled={busy||issued} onClick={edit}>{uiText(review?'修改核对':'核对出口')}</Button>:undefined}><Facts items={[{label:'补发订单',value:order.code},{label:'客户收款',value:uiText('无需收款')},{label:'申报单价',value:review?review.unitPrice+' '+order.currency+'/'+uiText(line?.unit??''):uiText('待核定')},...(review?[{label:'原出口单号',value:review.originalDeclarationNo},{label:'退运依据',value:review.returnReference},{label:'退税处理',value:review.taxHandling},{label:'估价依据',value:review.basis},{label:'核对人',value:review.actor}]:[])]}/>{review&&<RecordFiles ids={review.fileIds}/>}</DetailBlock>;
 })}</>;
}
