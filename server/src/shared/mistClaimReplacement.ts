/** Approved claims are the only producer of free replacement order sources. */
import {createMistOrderRecords,MistCommandError,type MistState,type MistContext,type MistOrder,type MistOrderInput} from './mistWorkspace';
import {frozenDisposition,type PlatformClaimDisposition} from './mistPlatform';
import type {OrderGovernanceInput,OrderGovernanceLine} from './mistOrderGovernance';

export type ClaimReplacementSource={schemaVersion:1;claimId:string;dispositionId:string;goodsId:string;sourceOrderId:string;sourceLineId:string;createdAt:string;createdById:string};
export type ClaimReplacementOrderCommand={type:'platform.claim.replacement.createOrder';payload:{id:string;due:string;incoterm:string;deliveryPlace:string;confirmationFileIds:string[]}};
export type ReplacementExportReview={schemaVersion:1;orderId:string;lineId:string;unitPrice:number;originalDeclarationNo:string;returnReference:string;taxHandling:string;basis:string;fileIds:string[];actorId:string;actor:string;at:string};
export type ReplacementExportCommand={type:'fulfillment.customs.reviewReplacement';payload:{id:string;orderId:string;unitPrice:number;originalDeclarationNo:string;returnReference:string;taxHandling:string;basis:string;fileIds:string[]}};
function fail(message:string,code='PRECONDITION'):never{throw new MistCommandError(code,message,code==='FORBIDDEN'?403:422);}
function required(value:unknown,label:string){if(typeof value!=='string'||!value.trim()||value.length>4000)fail('请填写'+label,'VALIDATION');return(value as string).trim();}
function replacementDisposition(root:MistState,id:string){
 const claim=root.platform?.claims.find(row=>row.dispositions.some(d=>d.id===id)),row=claim?.dispositions.find(d=>d.id===id);
 if(!claim||!row||row.kind!=='Replace'||row.state!=='Executed'||row.reviewDecision!=='approved'||!row.goodsSource||!row.goodsId||claim.state==='Cancelled')fail('补发须来自已执行的批准换货处置');
 frozenDisposition(row!);const goods=root.platform!.claimGoods.find(g=>g.id===row!.goodsId);
 if(!goods||goods.claimId!==claim!.id||goods.dispositionId!==id)fail('补发退货来源不一致');
 return {claim:claim!,row:row!,source:row!.goodsSource!,goods:goods!};
}
export function assertReplacementOrder(root:MistState,order:MistOrder,proposal?:{contract:OrderGovernanceInput;lines:OrderGovernanceLine[];currency:string}){
 if(!order.replacementSource)return undefined;
 const ref=order.replacementSource,{claim,row,source,goods}=replacementDisposition(root,ref.dispositionId),lines=proposal?.lines??root.orderLines.filter(line=>line.orderId===order.id),contract=proposal?.contract??order.governance?.contract;
 if(ref.schemaVersion!==1||ref.claimId!==claim.id||ref.goodsId!==goods.id||ref.sourceOrderId!==source.orderId||ref.sourceLineId!==source.lineId||order.customerId!==source.customerId||order.type!==root.orders.find(o=>o.id===source.orderId)?.type||(proposal?.currency??order.currency)!==source.currency||!contract||contract.kind!=='external'||contract.paymentMethod!=='OTHER'||contract.depositPercent!==0||contract.preShipmentPercent!==0||contract.overPercent!==0||contract.shortPercent!==0||lines.length!==1||lines[0].qty!==row.quantity||lines[0].unit!==source.unit||lines[0].price!==0||lines[0].style!==source.style||lines[0].name!==source.name)fail('补发订单与批准来源不一致');
 return {claim,row,source,goods,line:lines[0]};
}
export function createClaimReplacementOrder(root:MistState,p:ClaimReplacementOrderCommand['payload'],context:MistContext){
 if(!context.can?.('orders:write')||!context.can?.('aftersales:write')||!context.actorId)fail('创建补发订单需要订单与售后办理权限','FORBIDDEN');
 const {claim,row,source}=replacementDisposition(root,p.id);
 if(claim.state==='Closed')fail('案件已结案');
 if(root.orders.some(order=>order.replacementSource?.dispositionId===row.id))fail('该处置已生成补发订单','CONFLICT');
 const old=root.orders.find(order=>order.id===source.orderId)!,line=root.orderLines.find(line=>line.id===source.lineId)!;
 if(!Array.isArray(p.confirmationFileIds)||!p.confirmationFileIds.length||p.confirmationFileIds.some(id=>!root.files.some(file=>file.id===id)||![...claim.fileIds,...row.fileIds].includes(id)))fail('请选择案件中的补发确认附件');
 const governance:OrderGovernanceInput={kind:'external',poNumber:claim.code,confirmationFileIds:[...new Set(p.confirmationFileIds)],internalPurpose:'',receiver:'',paymentMethod:'OTHER',depositPercent:0,preShipmentPercent:0,paymentNote:'批准换货补发，无需客户付款',incoterm:required(p.incoterm,'贸易术语'),deliveryPlace:required(p.deliveryPlace,'指定地点'),overPercent:0,shortPercent:0};
 const sourceIds=line as typeof line&{sourceProductId?:string;sourceDevId?:string;sourceVersionId?:string};
 const values:MistOrderInput={type:old.type,customerId:source.customerId,season:old.season,currency:source.currency,due:p.due,ownerId:context.actorId,governance,lines:[{name:source.name,style:source.style,img:line.img,qty:row.quantity,unit:source.unit,price:0,...(old.type==='garment'?{fulfillmentMode:'full_package',cmtIncludedItems:[]}:{}),...(sourceIds.sourceProductId?{sourceProductId:sourceIds.sourceProductId}:{}),...(sourceIds.sourceDevId?{sourceDevId:sourceIds.sourceDevId}:{}),...(sourceIds.sourceVersionId?{sourceVersionId:sourceIds.sourceVersionId}:{})}]};
 const result=createMistOrderRecords(root,values,context),order=root.orders.find(o=>o.id===result.orderId)!;
 order.replacementSource={schemaVersion:1,claimId:claim.id,dispositionId:row.id,goodsId:row.goodsId!,sourceOrderId:source.orderId,sourceLineId:source.lineId,createdAt:context.now,createdById:context.actorId};
 row.replacementOrderId=order.id;row.replacementShipments=[];
 assertReplacementOrder(root,order);root.events.unshift({id:context.id(),entityType:'claim',entityId:claim.id,at:context.now,actor:context.actorName,text:'生成补发订单 '+order.code,fileIds:[...governance.confirmationFileIds]});
 return {...result,claimId:claim.id};
}
export function assertClaimReplacementShipped(root:MistState,row:PlatformClaimDisposition){
 if(row.kind!=='Replace')return;
 const orders=root.orders.filter(order=>order.replacementSource?.dispositionId===row.id);if(orders.length!==1)fail('补发订单尚未生成，不能结案');
 const order=orders[0],scope=assertReplacementOrder(root,order)!;
 const shipped=root.fulfillment.shipments.filter(shipment=>shipment.state==='departed').flatMap(shipment=>shipment.lines).filter(line=>line.orderId===order.id&&line.lineId===scope.line.id).reduce((sum,line)=>sum+line.quantity,0);
 if(Math.round(shipped*10000)!==Math.round(row.quantity*10000))fail('补发货物尚未发齐，不能结案');
}
export function recordReplacementExportReview(root:MistState,p:ReplacementExportCommand['payload'],context:MistContext){
 if(!context.can?.('customs:clear')||!context.actorId)fail('补发出口核对须由单证岗位办理','FORBIDDEN');
 const declaration=root.fulfillment.customs.find(row=>row.id===p.id),shipment=root.fulfillment.shipments.find(row=>row.id===declaration?.shipmentId),order=root.orders.find(row=>row.id===p.orderId);
 if(!declaration||!shipment||!order||!shipment.lines.some(line=>line.orderId===order.id)||declaration.status!=='draft'||['departed','cancelled'].includes(shipment.state))fail('当前出运不能修改补发出口核对');
 const scope=assertReplacementOrder(root,order);if(!scope)fail('该订单不是批准补发');
 if(!Number.isFinite(p.unitPrice)||p.unitPrice<=0||Math.abs(Math.round(p.unitPrice*10000)-p.unitPrice*10000)>0.000001)fail('申报单价须为正数，最多四位小数','VALIDATION');
 if(!p.fileIds?.length||p.fileIds.some(id=>!root.files.some(file=>file.id===id)))fail('请选择出口核对附件');
 if(root.fulfillment.documents.some(d=>d.shipmentId===shipment.id&&d.orderId===order.id&&d.type==='CI'&&d.status==='issued'))fail('请先作废原补发CI，再修改申报货值');
 const review:ReplacementExportReview={schemaVersion:1,orderId:order.id,lineId:scope.line.id,unitPrice:p.unitPrice,originalDeclarationNo:required(p.originalDeclarationNo,'原出口单号'),returnReference:required(p.returnReference,'退运依据'),taxHandling:required(p.taxHandling,'退税处理'),basis:required(p.basis,'估价依据'),fileIds:[...new Set(p.fileIds)],actorId:context.actorId,actor:context.actorName,at:context.now};
 declaration.replacementReviews=[...(declaration.replacementReviews??[]).filter(row=>row.orderId!==order.id),review];
 // Derived declaration rows must be regenerated; previous reviewed values remain in audit history.
 delete declaration.items;delete declaration.itemsAt;delete declaration.itemsBy;
 const event={id:context.id(),entityType:'customs',entityId:declaration.id,at:context.now,actor:context.actorName,text:'核对补发出口 '+order.code,fileIds:[...review.fileIds],audit:{action:'replacement.export.review',review:structuredClone(review)}};root.events.unshift(event);
 return{id:declaration.id};
}
export function replacementDeclaredUnitPrice(root:MistState,shipmentId:string,orderId:string,lineId:string){
 const order=root.orders.find(row=>row.id===orderId);if(!order?.replacementSource)return undefined;
 // Read projections may omit claim records; authority/source validation runs on the server command separately.
 const reviews=root.fulfillment.customs.filter(row=>row.shipmentId===shipmentId).flatMap(row=>row.replacementReviews??[]).filter(row=>row.orderId===orderId&&row.lineId===lineId);
 if(reviews.length!==1||reviews[0].unitPrice<=0||!Number.isFinite(reviews[0].unitPrice))fail('补发申报货值尚未核定');
 return reviews[0].unitPrice;
}

/** Minimal facts return to claim readers without exposing the full shipment or finance ledger. */
export function syncClaimReplacementShipments(root:MistState,context:MistContext){
 for(const order of root.orders.filter(order=>order.replacementSource)){
  const {claim,row,line}=assertReplacementOrder(root,order)!;
  if(row.replacementOrderId!==order.id)fail('补发订单回程来源不一致');
  const facts=root.fulfillment.shipments.filter(s=>s.state==='departed'&&s.lines.some(l=>l.orderId===order.id&&l.lineId===line.id)).map(s=>({shipmentId:s.id,code:s.code,quantity:s.lines.filter(l=>l.orderId===order.id&&l.lineId===line.id).reduce((sum,l)=>sum+l.quantity,0),departedAt:s.departedAt!}));
  const before=(row.replacementShipments??[]).reduce((sum,s)=>sum+s.quantity,0),after=facts.reduce((sum,s)=>sum+s.quantity,0);
  row.replacementShipments=facts;
  if(before<row.quantity&&after>=row.quantity)root.notifications.unshift({id:context.id(),category:'general',title:'补发已出运',detail:order.code,at:context.now,readAt:null,target:{view:'claims',id:claim.id}});
 }
}
