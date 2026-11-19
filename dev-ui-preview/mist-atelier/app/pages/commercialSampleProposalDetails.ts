import type {AgentProposalCommandBody} from '../../../../server/src/shared/mistAgentProposals';
import type {MistState,MistWorkspaceEnvelope} from '../../../../server/src/shared/mistWorkspace';
import type {FulfillmentSample,SampleMovement} from '../../../../server/src/shared/mistFulfillment';
import {fulfillmentPositions,sampleLoanRemaining,freeQuantity,reservationOpen} from '../../../../server/src/shared/mistFulfillment';
import {stockCompanyOwned} from '../../../../server/src/shared/mistStockSampleLoan';
import {shippingSampleMovementBlocker} from '../../../../server/src/shared/mistShipmentSampleCustody';
import {sampleUnitAllowsDecimal} from '../../../../server/src/shared/mistDevelopmentDomain';
import {isCalendarDay} from '../../../../server/src/shared/mistBusinessClock';
import {platformBusinessDate} from '../../../../server/src/shared/mistPlatform';
import {stableJson} from '../../../../server/src/shared/stableJson';
import type {ShippingSampleProposalReview} from './shippingSampleProposalDetails';

type Sources=MistWorkspaceEnvelope['commercialSampleLoanSources'];
const exact=(value:unknown,keys:string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const qty=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=1e9&&Math.abs(value*10000-Math.round(value*10000))<1e-6;
const sum=(values:number[])=>Math.round(values.reduce((n,value)=>n+Math.round(value*10000),0))/10000;
const physical=(sample:FulfillmentSample)=>({id:sample.id,code:sample.code,name:sample.name,source:sample.source,role:sample.role,shipmentId:sample.shipmentId,quantity:sample.quantity,unit:sample.unit,color:sample.color,size:sample.size,sizeQuantities:sample.sizeQuantities,qualityRevision:sample.qualityRevision,available:sample.available,location:sample.location,positions:sample.positions,shippingQuantityBasis:sample.shippingQuantityBasis});
const returnFacts=(loan:SampleMovement)=>loan.commercialReturn||(loan.commercialLoan?{quantity:loan.commercialLoan.quantity,unit:loan.commercialLoan.unit,location:loan.commercialLoan.sampleLocation}:undefined);
const safeLabel=(label:unknown)=>typeof label==='string'&&!!label.trim()&&!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(label);

/** The caller supplies current response-only action capsules, never a capability claimed by the proposal. */
export function commercialSampleProposalDetails(command:AgentProposalCommandBody,state:MistState|null|undefined,sources:Sources,canWrite:boolean,now:string):ShippingSampleProposalReview|null{
 if(command.type!=='fulfillment.samples.move')return null;
 if(!command.payload||typeof command.payload!=='object'||Array.isArray(command.payload))return{title:'借出商业内样',reason:'借还内容无法完整核对，请重新提出提议',rows:[],fingerprint:''};
 const p=command.payload,sample=state&&typeof p?.id==='string'?state.fulfillment.samples.find(row=>row.id===p.id):undefined;
 const loan=state&&typeof p?.loanId==='string'?state.fulfillment.sampleMovements.find(row=>row.id===p.loanId):undefined;
 const explicit=!!p&&Object.prototype.hasOwnProperty.call(p,'commercialSources');
 const relevant=explicit||sample?.shippingQuantityBasis?.kind==='included'&&(p.kind==='lend'||p.kind==='return')||p?.kind==='return'&&!!(loan?.commercialLoan||loan?.commercialReturn)||!sample&&(p?.kind==='lend'||p?.kind==='return');
 if(!relevant)return null;
 const title=p?.kind==='return'?'归还商业内样':'借出商业内样',blocked=(reason:string):ShippingSampleProposalReview=>({title,reason,rows:[],fingerprint:''});
 if(!state)return blocked('正在读取样品资料，请稍后核对');
 if(canWrite!==true)return blocked('当前账号不能办理商业借样');
 if(!exact(command,['type','payload'])||!exact(p,p.kind==='lend'?['id','kind','quantity','person','borrowerId','location','note','expectedReturn','sourceLocation','commercialSources']:['id','kind','quantity','person','location','note','loanId'])||!['lend','return'].includes(String(p.kind)))return blocked('借还内容无法完整核对，请重新提出提议');
 if(!sample?.code||!safeLabel(sample.code)||sample.role!=='shipping'||sample.shippingQuantityBasis?.kind!=='included'||sample.source.kind!=='orderLine')return blocked('原商业样品来源不可见或已变化，请重新核对');
 const source=sample.source,basis=sample.shippingQuantityBasis,snapshot=basis.sourceSnapshot;
 if(snapshot.sampleId!==sample.id||snapshot.orderId!==source.orderId||snapshot.lineId!==source.lineId||snapshot.productionId!==source.productionId||snapshot.shipmentId!==sample.shipmentId||snapshot.quantity!==sample.quantity||snapshot.unit!==sample.unit||snapshot.color!==sample.color||stableJson(snapshot.sizeQuantities)!==stableJson(sample.sizeQuantities||[]))return blocked('原商业实物组合或来源已变化，请重新核对');
 const custody=shippingSampleMovementBlocker(state,sample,p.kind as 'lend'|'return');if(custody)return blocked(custody);
 if(!qty(p.quantity)||!sampleUnitAllowsDecimal(sample.unit)&&!Number.isInteger(p.quantity)||typeof p.person!=='string'||typeof p.location!=='string'||typeof p.note!=='string')return blocked('借还数量、单位或交接内容无效，请重新核对');
 if(sample.sizeQuantities&&p.quantity!==sample.quantity)return blocked('本组须按原颜色尺码整组借还');
 if([p.person,p.location,p.note].some(value=>value.length>4000))return blocked('内容过多，无法完整核对，请重新提出提议');
 const rows:ShippingSampleProposalReview['rows']=[],add=(field:string,value:string)=>rows.push({field,path:'commercialSampleReview.'+rows.length,value});
 const shipment=state.fulfillment.shipments.find(row=>row.id===sample.shipmentId),production=state.productions.find(row=>row.id===source.productionId),order=state.orders.find(row=>row.id===source.orderId),line=state.orderLines.find(row=>row.id===source.lineId);
 if(production&&(production.orderId!==source.orderId||production.lineId!==source.lineId)||line&&line.orderId!==source.orderId||shipment&&!shipment.lines.some(row=>row.orderId===source.orderId&&row.lineId===source.lineId&&row.productionId===source.productionId))return blocked('当前商业来源不匹配，请重新核对');
 add('样品',sample.code);add('实物数量',p.quantity+' '+sample.unit);add('数量口径','大货内随本批出运');
 const identity=[order?.code,production?.code,shipment?.code].filter((value):value is string=>!!value);if(identity.length)add('商业来源',identity.join(' · '));
 if(sample.sizeQuantities)add('整组规格',[sample.color,...sample.sizeQuantities.map(row=>row.size+' × '+row.quantity)].filter(Boolean).join(' · '));
 const caps=sources?.[sample.id],loans=state.fulfillment.sampleMovements.filter(row=>row.sampleId===sample.id&&(row.kind==='lend'||row.kind==='return'));let borrowerFact:{userId:string;name:string}|undefined;
 if(p.kind==='lend'){
  if(p.quantity>sample.available)return blocked('本组可借实物不足，请重新核对');
  if(caps?.status!=='available')return blocked(caps?.reason||'商业借样来源未读取，请刷新后重试');
  if(caps.quantity!==sample.available||caps.unit!==sample.unit||!['warehouse','direct'].includes(caps.kind)||!Array.isArray(caps.options))return blocked('当前商业来源数量或单位不匹配，请重新核对');
  const members=state.members||[],borrower=typeof p.borrowerId==='string'?members.find(member=>member.userId===p.borrowerId):members.filter(member=>member.name===p.person).length===1?members.find(member=>member.name===p.person):undefined;
  if(p.borrowerId!==undefined&&typeof p.borrowerId!=='string'||!borrower?.name||p.person&&p.person!==borrower.name)return blocked('借用人不在当前可核对的公司名册中');
  borrowerFact={userId:borrower.userId,name:borrower.name};
  const positions=fulfillmentPositions(sample),position=p.sourceLocation!==undefined?positions.find(row=>row.location===p.sourceLocation):positions.length===1?positions[0]:undefined;
  if(!position||position.available<p.quantity)return blocked('请选择本组当前准确借出位置');
  add('借用人',borrower.name);add('样品原位置',position.location);
  if(p.location)add('登记位置',p.location);
  if(p.expectedReturn!==undefined&&p.expectedReturn!==''){
   if(!isCalendarDay(p.expectedReturn)||!Number.isFinite(Date.parse(now))||p.expectedReturn<platformBusinessDate(now))return blocked('预计归还日不能早于当前业务日');
   add('预计归还日',p.expectedReturn);
  }
  if(caps.kind==='direct'){
   if(explicit||caps.options.length)return blocked('原直交实物不能改选仓储来源');add('实物交接','原直交实物');
  }else{
   if(!caps.options.length||caps.options.some(option=>!safeLabel(option.label)||!qty(option.maxQuantity)||option.maxQuantity>caps.quantity||option.unit!==sample.unit)||new Set(caps.options.map(option=>option.stockId+'\u0000'+option.location)).size!==caps.options.length)return blocked('商业来源选项不可完整核对，请刷新后重试');
   const selections=explicit?p.commercialSources:caps.options.length===1?[{stockId:caps.options[0].stockId,location:caps.options[0].location,quantity:p.quantity}]:undefined;
   if(!Array.isArray(selections)||!selections.length||selections.length>100||selections.some(row=>!exact(row,['stockId','location','quantity'])||!qty(row.quantity))||sum(selections.map(row=>row.quantity))!==p.quantity)return blocked('请选择准确商业来源，数量合计须等于本次借出');
   const keys=new Set<string>();for(const row of selections){const key=row.stockId+'\u0000'+row.location;if(keys.has(key))return blocked('同一商业来源位置不能重复选择');keys.add(key);const current=caps.options.find(option=>option.stockId===row.stockId&&option.location===row.location);if(!current||row.quantity>current.maxQuantity)return blocked('所选商业来源或可借数量已变化，请重新核对');
    const stock=state.fulfillment.stock.find(stock=>stock.id===row.stockId);if(stock&&(stock.orderId!==source.orderId||stock.lineId!==source.lineId||stock.unit!==sample.unit||production&&stock.purchaseId!==production.sourcePurchaseId))return blocked('所选库存与原商业来源不匹配');
    if(stock&&(stock.sourceKind==='claimReturn'||!stockCompanyOwned(stock)||stock.locked||freeQuantity(stock)<0||row.quantity>(fulfillmentPositions(stock).find(position=>position.location===row.location)?.available||0)))return blocked('所选商业实物或库位可借量已变化');
    add('商业实物来源',current.label);add('借出库位',current.location);add('来源数量',row.quantity+' '+current.unit);
   }
   for(const id of new Set(selections.map(row=>row.stockId))){const stock=state.fulfillment.stock.find(stock=>stock.id===id),selected=sum(selections.filter(row=>row.stockId===id).map(row=>row.quantity));if(stock){const allowance=sum([freeQuantity(stock),...(stock.reservations||[]).filter(row=>!row.sampleLoan&&row.orderId===source.orderId&&row.lineId===source.lineId).map(reservationOpen)]);if(selected>allowance)return blocked('所选商业库存的可借合计已变化');}}
  }
 }else{
  if(!loan||loan.kind!=='lend'||loan.sampleId!==sample.id)return blocked('原商业借出记录不可见，请重新核对');
  const original=returnFacts(loan),remaining=sampleLoanRemaining(state,loan.id);
  if(!original||original.unit!==sample.unit||original.quantity!==loan.quantity||!qty(original.quantity)||!qty(remaining)||p.quantity>remaining||p.quantity>sum([sample.quantity,-sample.available]))return blocked('原商业借出余额或单位已变化，请重新核对');
  if(sample.sizeQuantities&&remaining!==sample.quantity)return blocked('原整组借还数量不完整，请核对原实物');
  const frozen=loan.commercialLoan?.sourceSnapshot;
  if(frozen&&(frozen.sampleId!==sample.id||frozen.shipmentId!==sample.shipmentId||frozen.orderId!==source.orderId||frozen.lineId!==source.lineId||frozen.productionId!==source.productionId||frozen.quantity!==sample.quantity||frozen.unit!==sample.unit||frozen.color!==sample.color||stableJson(frozen.sizeQuantities)!==stableJson(sample.sizeQuantities||[])||loan.commercialLoan!.qualityRevision!==(sample.qualityRevision||1)))return blocked('原借出实物组合或来源已变化，请重新核对');
  if(p.location!==original.location)return blocked('须归还原借出位置，请重新核对');
  add('原借用人',loan.person||'原借出记录');add('原借出数量',loan.quantity+' '+sample.unit);add('尚未归还',remaining+' '+sample.unit);add('原归还位置',original.location);
  if(p.person)add('经手人',p.person);
 }
 if(p.note)add('交接说明',p.note);
 if(rows.length>400||rows.some(row=>row.value.length>4000))return blocked('内容过多，无法完整核对，请重新提出提议');
 const optionIds=new Set([...(caps?.status==='available'?caps.options.map(option=>option.stockId):[]),...(p.kind==='return'?loan?.commercialLoan?.holds.map(hold=>hold.stockId)||[]:[])]);
 const sourceFacts={sample:physical(sample),loans,caps,shipment:shipment?{id:shipment.id,code:shipment.code,state:shipment.state,departedAt:shipment.departedAt,lines:shipment.lines.filter(row=>row.orderId===source.orderId&&row.lineId===source.lineId&&row.productionId===source.productionId)}:undefined,production:production?{id:production.id,code:production.code,orderId:production.orderId,lineId:production.lineId,sourcePurchaseId:production.sourcePurchaseId}:undefined,packing:state.fulfillment.packing.filter(row=>row.shipmentId===sample.shipmentId&&row.productionId===source.productionId),stocks:state.fulfillment.stock.filter(stock=>optionIds.has(stock.id)).map(stock=>({id:stock.id,purchaseId:stock.purchaseId,orderId:stock.orderId,lineId:stock.lineId,unit:stock.unit,available:stock.available,positions:stock.positions,locked:stock.locked,owner:stock.owner,ownership:stock.ownership,reservations:stock.reservations})),borrower:borrowerFact};
 return{title,reason:'',rows,fingerprint:stableJson([command,sourceFacts,rows,canWrite,p.expectedReturn?platformBusinessDate(now):undefined])};
}
