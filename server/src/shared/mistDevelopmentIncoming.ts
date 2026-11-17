import {developmentFactoryWorkBlocker} from './mistDevelopmentTaskLifecycle';
import {MistCommandError,type MistState,type MistContext,type MistCommandResult} from './mistWorkspace';
import {applyFulfillmentCommand,registerDevelopmentIncomingSample,type IncomingDelivery} from './mistFulfillment';
import {developmentDomain,developmentInitiator,validFabricSample} from './mistDevelopmentDomain';
import {productionSupplierUnavailableReason} from './mistSupplierStatus';
import {isCalendarDay} from './mistBusinessClock';
import {platformBusinessDate} from './mistPlatform';
import {notifyMist,notificationOwners} from './mistNotifications';

export type IncomingPostage={amount:number;currency:string;zeroReason:string};
/** Response-only; describes the current projection, never accepted as command authority. */
export type DevelopmentIncomingAccess={readableDevIds:string[];writableDevIds:string[]};
export type DevelopmentIncomingCommand=
 |{type:'development.incoming.receive';payload:{devId:string;receivedAt:string;name:string;form:string;quantity:number;unit:string;size:string;color:string;location:string;contact:string;fileIds:string[];note:string}}
 |{type:'development.incoming.dispatch';payload:{devId:string;taskVersionId:string;items:Array<{sampleId:string;quantity:number;sourceLocation:string}>;sentAt:string;returnExpected:boolean;expectedReturn?:string;delivery:IncomingDelivery;postage:IncomingPostage;note:string}}
 |{type:'development.incoming.return';payload:{devId:string;dispatchId:string;items:Array<{loanId:string;quantity:number;location:string}>;receivedAt:string;delivery:IncomingDelivery;note:string}};
const fail=(message:string):never=>{throw new MistCommandError('VALIDATION',message);};
const text=(value:unknown,label:string,required=true,max=2000)=>{if(typeof value!=='string')return fail('请填写'+label);const v=value.trim();if(required&&!v)return fail('请填写'+label);if(v.length>max)return fail(label+'过长');return v;};
const occurred=(value:unknown,label:string,ctx:MistContext)=>{const day=text(value,label,true,10);if(!isCalendarDay(day))return fail(label+'无效');if(day>platformBusinessDate(ctx.now))return fail(label+'不得在未来');return day;};
const quantity=(value:unknown)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<=0)return fail('请填写正数数量');return value;};
function delivery(value:IncomingDelivery):IncomingDelivery{
 if(!value||!['courier','handover'].includes(value.kind))return fail('请选择交接方式');
 const base={kind:value.kind,recipient:text(value.recipient,'收件人',true,120),address:text(value.address,'收件地址',true,500)};
 return value.kind==='courier'?{...base,carrier:text(value.carrier,'快递公司',true,120),trackingNo:text(value.trackingNo,'运单号',true,120),evidence:''}:{...base,carrier:'',trackingNo:'',evidence:text(value.evidence,'交接依据',true,500)};
}
function postage(value:IncomingPostage):IncomingPostage{
 if(!value||typeof value.amount!=='number'||!Number.isFinite(value.amount)||value.amount<0||!/^\d{1,10}(\.\d{1,2})?$/.test(String(value.amount)))return fail('请填写最多两位小数的我方邮费');
 const currency=text(value.currency,'币种',true,3).toUpperCase();if(!/^[A-Z]{3}$/.test(currency))return fail('币种须为三位字母');
 return{amount:value.amount,currency,zeroReason:value.amount===0?text(value.zeroReason,'零支出原因',true,500):text(value.zeroReason||'','费用说明',false,500)};
}
function items<T>(value:T[],key:(row:T)=>string):T[]{if(!Array.isArray(value)||!value.length||value.length>50)return fail('每次请选择1至50条准确实物');if(value.some(item=>!item||typeof item!=='object'||Array.isArray(item)))return fail('实物明细格式无效');const keys=value.map(key);if(new Set(keys).size!==keys.length)return fail('同一实物位置不能重复选择');return value;}
function event(state:MistState,ctx:MistContext,devId:string,message:string,section='incoming'){
 state.events.unshift({id:ctx.id(),entityType:'development',entityId:devId,actor:ctx.actorName,at:ctx.auditNow??ctx.now,text:message,fileIds:[]});
 notifyMist(state,ctx,{title:message,detail:ctx.actorName,target:{view:'development/detail',id:devId,section},category:'general'},notificationOwners(state,'development',devId));
}
export function developmentIncomingSamples(state:MistState,devId:string){return state.fulfillment.samples.filter(sample=>sample.source.kind==='developmentIncoming'&&sample.source.devId===devId);}
export function developmentIncomingDispatches(state:MistState,devId:string){
 const groups=new Map<string,typeof state.fulfillment.sampleMovements>();for(const move of state.fulfillment.sampleMovements){if(move.incomingTransfer?.devId!==devId||move.incomingTransfer.direction!=='out')continue;const id=move.incomingTransfer.dispatchId;groups.set(id,[...(groups.get(id)||[]),move]);}return[...groups.entries()].map(([id,movements])=>({id,movements,transfer:movements[0].incomingTransfer!}));
}
export function applyDevelopmentIncomingCommand(state:MistState,command:DevelopmentIncomingCommand,ctx:MistContext):MistCommandResult{
 const p=command.payload,dev=state.devs.find(dev=>dev.id===p.devId);if(!dev)return fail('开发案不存在');if(!ctx.actorId)return fail('缺少真实登记账号');
 if(command.type!=='development.incoming.return'&&dev.closure)throw new MistCommandError('PRECONDITION','开发案已结束，请先恢复后办理新来样或寄厂');
 if(command.type==='development.incoming.receive'){
  const p=command.payload;if(['source','receiptId','registeredById','incoming'].some(key=>Object.prototype.hasOwnProperty.call(p,key)))return fail('来样来源与登记身份由服务端生成');
  const day=occurred(p.receivedAt,'实际收样日',ctx),q=quantity(p.quantity),domain=developmentDomain(dev.values),unit=text(p.unit,'单位',true,20),form=text(p.form,'形态',true,60);
  if(domain==='garment'&&(unit!=='件'||!Number.isInteger(q)))return fail('成衣来样按整件逐件登记');if(domain==='garment'&&q>100)return fail('每次最多登记100件来样，请分批登记');
  if(domain==='fabric'&&!validFabricSample(q,form,unit))return fail('面料来样须记录准确形态、数量和单位');
  const providerKind=developmentInitiator(dev.values),providerId=providerKind==='customer'?dev.customerId:dev.values.requesterId||'',providerName=providerKind==='customer'?dev.customer:dev.values.requester||'';if(!providerName)return fail('请先补齐本案客户或内部需求方');
  const receiptId=ctx.id(),sampleIds:string[]=[];
  for(let i=0;i<(domain==='garment'?q:1);i++){
   const id=registerDevelopmentIncomingSample(state,{devId:dev.id,receiptId,name:text(p.name,'来样名称',true,80),category:domain==='fabric'?'面料':'成衣',form,quantity:domain==='garment'?1:q,unit,size:text(p.size||'','尺码',false,100),color:text(p.color||'','颜色',false,100),location:text(p.location||'','位置',false,200),fileIds:p.fileIds,note:text(p.note||'','备注',false)},ctx);
   const sample=state.fulfillment.samples.find(sample=>sample.id===id)!;sample.incoming={receivedAt:day,providerKind,providerId,providerName,contact:text(p.contact||'','提供方联系人',false,120),recordedAt:ctx.now,recordedBy:ctx.actorName,recordedById:ctx.actorId};sampleIds.push(id);
  }
  dev.updatedAt=ctx.now;event(state,ctx,dev.id,`登记来样 ${text(p.name,'来样名称')} ${q} ${unit}`,'incoming:'+sampleIds[0]);return{devId:dev.id,id:sampleIds[0],receiptId,sampleIds};
 }
 if(command.type==='development.incoming.dispatch'){
  const p=command.payload;if(['borrowerId','supplierId'].some(key=>Object.prototype.hasOwnProperty.call(p,key)))return fail('外部收件主体由准确工厂任务确定，不绑定公司借用账号');
  const version=state.versions.find(v=>v.id===p.taskVersionId&&v.devId===dev.id&&dev.versionIds.includes(v.id));if(!version?.task||version.minor)return fail('请选择本案准确工厂任务');const work=developmentFactoryWorkBlocker(state,dev,version);if(work)throw new MistCommandError('PRECONDITION',work);if(version.archivedAt||version.qcDecision&&version.qcDecision.kind!=='rework')return fail('该工厂任务已结束，请核对当前任务');
  const supplier=state.market.suppliers.find(supplier=>supplier.id===version.factoryId);if(!supplier)return fail('工厂资料不存在');const blocked=productionSupplierUnavailableReason(supplier,platformBusinessDate(ctx.now));if(blocked)throw new MistCommandError('PRECONDITION',blocked);
  const day=occurred(p.sentAt,'实际寄送日',ctx),ship=delivery(p.delivery),cost=postage(p.postage);if(typeof p.returnExpected!=='boolean')return fail('请明确是否需退原样');
  const expectedReturn=p.returnExpected&&p.expectedReturn?text(p.expectedReturn,'预计归还日',true,10):'';if(expectedReturn&&(!isCalendarDay(expectedReturn)||expectedReturn<day))return fail('预计归还日不得早于寄送日');
  const dispatchId=ctx.id(),movementIds:string[]=[];
  for(const item of items(p.items,item=>JSON.stringify([item.sampleId,item.sourceLocation]))){
   const sample=developmentIncomingSamples(state,dev.id).find(sample=>sample.id===item.sampleId);if(!sample)return fail('寄送必须选择本案准确来样');if(!sample.incoming)return fail('来样收样资料无法核对');if(sample.incoming.receivedAt>day)return fail('寄送日不得早于实际收样日');
   const q=quantity(item.quantity);const result=applyFulfillmentCommand(state,{type:'fulfillment.samples.move',payload:{id:sample.id,kind:p.returnExpected?'lend':'send',quantity:q,person:ship.recipient,location:ship.address,sourceLocation:item.sourceLocation,note:`来样寄厂 · ${version.label}${p.note?' · '+text(p.note,'寄送说明',false):''}`,...(expectedReturn?{expectedReturn}:{}),...(!p.returnExpected?{sendPurpose:'other'}:{})}},ctx,{externalBorrower:true,loanStartedOn:day,developmentIncomingCustody:true});
   const movement=state.fulfillment.sampleMovements.find(move=>move.id===result.id)!;movement.carrier=ship.carrier;movement.trackingNo=ship.trackingNo;movement.destination=ship.address;
   movement.incomingTransfer={dispatchId,devId:dev.id,taskVersionId:version.id,supplierId:supplier.id,supplierName:supplier.name,returnExpected:p.returnExpected,direction:'out',occurredAt:day,delivery:ship};movementIds.push(movement.id);
  }
  const first=state.fulfillment.sampleMovements.find(move=>move.id===movementIds[0])!;first.incomingTransfer!.postage=cost;
  if(cost.amount>0){const id=ctx.id();(dev.billing||={makingFees:[]}).expenses||=[];dev.billing.expenses.push({id,versionId:version.id,amount:cost.amount,currency:cost.currency,description:`来样寄厂邮费 · ${supplier.name} · ${ship.trackingNo||ship.evidence}`,date:day,at:ctx.now,actor:ctx.actorName,sourceDispatchId:dispatchId,sourceMovementIds:[...movementIds]});first.incomingTransfer!.expenseId=id;}
  dev.updatedAt=ctx.now;event(state,ctx,dev.id,`来样寄厂 ${version.label} · ${supplier.name}`,'incoming-dispatch:'+dispatchId);return{devId:dev.id,id:dispatchId,dispatchId,movementIds};
 }
 const pReturn=command.payload,day=occurred(pReturn.receivedAt,'实际退回日',ctx),ship=delivery(pReturn.delivery),returnBatchId=ctx.id(),movementIds:string[]=[];
 for(const item of items(pReturn.items,item=>JSON.stringify([item.loanId,item.location]))){
  const loan=state.fulfillment.sampleMovements.find(move=>move.id===item.loanId&&move.kind==='lend'),out=loan?.incomingTransfer;if(!loan||!out||out.direction!=='out'||out.devId!==dev.id||out.dispatchId!==pReturn.dispatchId)return fail('退回须引用本案同票原借出流水');if(day<out.occurredAt)return fail('退回日不得早于寄送日');
  const sample=developmentIncomingSamples(state,dev.id).find(sample=>sample.id===loan.sampleId);if(!sample)return fail('原借出来样不存在');
  const result=applyFulfillmentCommand(state,{type:'fulfillment.samples.move',payload:{id:sample.id,kind:'return',loanId:loan.id,quantity:quantity(item.quantity),person:ctx.actorName,location:text(item.location,'归还位置',false,200),note:text(pReturn.note||'','退回说明',false)}},ctx,{developmentIncomingCustody:true});
  const move=state.fulfillment.sampleMovements.find(move=>move.id===result.id)!;move.carrier=ship.carrier;move.trackingNo=ship.trackingNo;move.destination=ship.address;move.incomingTransfer={dispatchId:out.dispatchId,devId:dev.id,taskVersionId:out.taskVersionId,supplierId:out.supplierId,supplierName:out.supplierName,returnExpected:true,direction:'return',occurredAt:day,delivery:ship,returnBatchId};movementIds.push(move.id);
 }
 dev.updatedAt=ctx.now;event(state,ctx,dev.id,'原样退回 '+ship.recipient,'incoming-dispatch:'+pReturn.dispatchId);return{devId:dev.id,id:returnBatchId,returnBatchId,movementIds};
}

/** Intent read set for optimistic merge; unrelated cases/factories remain independent. */
export function developmentIncomingReadKeys(state:MistState,command:DevelopmentIncomingCommand):string[][]{
 const p=command.payload,base=[['k:devs','i:'+p.devId,'k:closure'],['k:devs','i:'+p.devId,'k:customerId'],['k:devs','i:'+p.devId,'k:values']];
 if(command.type==='development.incoming.dispatch'){const version=state.versions.find(v=>v.id===command.payload.taskVersionId);return[...base,['k:versions','i:'+command.payload.taskVersionId],...(version?[['k:market','k:suppliers','i:'+version.factoryId]]:[]),...command.payload.items.map(item=>['k:fulfillment','k:samples','i:'+item.sampleId])];}
 if(command.type==='development.incoming.return')return[...base,...command.payload.items.flatMap(item=>{const loan=state.fulfillment.sampleMovements.find(move=>move.id===item.loanId);return[['k:fulfillment','k:sampleMovements','i:'+item.loanId],...(loan?[['k:fulfillment','k:samples','i:'+loan.sampleId]]:[])];})];
 return[...base,...command.payload.fileIds.map(id=>['k:files','i:'+id])];
}
