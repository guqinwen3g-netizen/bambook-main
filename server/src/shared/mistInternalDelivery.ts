/** Internal finished-goods handover is separate from supplier acceptance and external shipment. */
import {MistCommandError,type MistContext,type MistState,type MistCommandResult} from './mistWorkspace';
import {resolveMember} from './mistAccounts';
import {assertOrderApproved,assertOrderWritable} from './mistOrderGovernance';
import {assertOrderLineOpen} from './mistOrderClosure';
import {fulfillmentProductionFact,fulfillmentProductionQcPassed} from './mistFulfillment';
import {platformBusinessDate} from './mistPlatform';
import {stableJson} from './stableJson';

type Audit={at:string;actorId:string;actor:string;evidence:string};
type Reversal=Audit;
export type InternalDeliveryCheck=Audit&{id:string;accepted:number;rejected:number;reversed?:Reversal};
export type InternalDeliveryReturn=Audit&{id:string;quantity:number;date:string};
export type InternalDelivery={
 id:string;orderId:string;lineId:string;productionId:string;orderCode:string;lineName:string;style:string;unit:string;physicalKey:string;productionCode:string;
 source:{kind:'receipt'|'stockIssue';id:string};quantity:number;receiverId:string;receiver:string;intendedReceiver:string;location:string;date:string;
 created:Audit;checks:InternalDeliveryCheck[];returns:InternalDeliveryReturn[];cancelled?:Audit;
};
export type InternalDeliveryCommand=
 |{type:'order.internal.send';payload:{orderId:string;productionId:string;source:{kind:'receipt'|'stockIssue';id:string};quantity:number;receiverId:string;location:string;date:string;evidence:string;expectedRevision:number}}
 |{type:'order.internal.receive';payload:{id:string;accepted:number;rejected:number;expectedRevision:number;evidence:string}}
 |{type:'order.internal.reverseCheck';payload:{id:string;checkId:string;expectedRevision:number;reason:string}}
 |{type:'order.internal.returnRejected';payload:{id:string;quantity:number;date:string;expectedRevision:number;evidence:string}}
 |{type:'order.internal.cancel';payload:{id:string;expectedRevision:number;reason:string}};

function fail(message:string,code='PRECONDITION'):never {throw new MistCommandError(code,message,code==='FORBIDDEN'?403:code==='NOT_FOUND'?404:code==='CONFLICT'?409:422);}
const text=(value:unknown,label:string)=>typeof value==='string'&&value.trim()&&value.length<=2000?value.trim():fail(`请填写${label}`,'VALIDATION');
const minor=(value:unknown):bigint=>{
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||!Number.isSafeInteger(Math.round(value*10000))||Math.abs(value*10000-Math.round(value*10000))>0.0001)fail('数量须为非负数，最多四位小数','VALIDATION');
 return BigInt(Math.round((value as number)*10000));
};
const number=(value:bigint)=>Number(value)/10000;
const plus=(values:number[])=>values.reduce((n,v)=>n+minor(v),BigInt(0));
const physicalKey=(line:MistState['orderLines'][number])=>{const value=line as typeof line&{breakdown?:unknown;specification?:string;sourceProductId?:string;sourceDevId?:string;sourceVersionId?:string};return stableJson({style:line.style,unit:line.unit,specification:value.specification||'',breakdown:value.breakdown,sourceProductId:value.sourceProductId,sourceDevId:value.sourceDevId,sourceVersionId:value.sourceVersionId});};
const stamp=(ctx:MistContext,evidence:string):Audit=>({at:ctx.now,actorId:ctx.actorId||fail('无法核对经办账号','FORBIDDEN'),actor:ctx.actorName,evidence});
function date(value:unknown,ctx:MistContext){const s=text(value,'实际日期');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s||s>platformBusinessDate(ctx.now))fail('实际日期无效或晚于今天','VALIDATION');return s;}
export function internalDeliveryTotals(row:InternalDelivery){
 const active=row.checks.filter(check=>!check.reversed),accepted=plus(active.map(c=>c.accepted)),rejected=plus(active.map(c=>c.rejected)),returned=plus(row.returns.map(r=>r.quantity));
 return {accepted:number(accepted),rejected:number(rejected),returned:number(returned),pending:row.cancelled?0:number(minor(row.quantity)-accepted-rejected),reserved:row.cancelled?0:number(minor(row.quantity)-returned)};
}
export const internalDeliveryRevision=(row:InternalDelivery)=>row.checks.length+row.checks.filter(c=>c.reversed).length+row.returns.length+(row.cancelled?1:0);
function current(row:InternalDelivery,revision:unknown){if(revision!==internalDeliveryRevision(row))fail('交接记录已变化，请刷新','CONFLICT');if(row.cancelled)fail('交接已撤回');}
function deliveryIndex(root:MistState){
 const map=<T extends {id:string}>(rows:T[])=>new Map(rows.map(row=>[row.id,row]));
 const issueRemaining=new Map<string,bigint>();
 for(const movement of root.fulfillment.stockMovements)if(movement.kind==='issue')issueRemaining.set(movement.id,minor(movement.quantity));
 for(const movement of root.fulfillment.stockMovements)if(movement.kind==='return'&&movement.issueId)issueRemaining.set(movement.issueId,(issueRemaining.get(movement.issueId)||BigInt(0))-minor(movement.quantity));
 return {orders:map(root.orders),lines:map(root.orderLines),branches:map(root.productions),purchases:map(root.fulfillment.purchases),receipts:map(root.fulfillment.receipts),movements:map(root.fulfillment.stockMovements),stock:map(root.fulfillment.stock),facts:new Map(root.fulfillment.productionFacts.map(f=>[f.productionId,f])),issueRemaining,shipped:new Set(root.fulfillment.shipments.filter(s=>s.state!=='cancelled').flatMap(s=>s.lines.map(l=>l.productionId)))};
}
function sourceCapacity(row:Pick<InternalDelivery,'orderId'|'lineId'|'productionId'|'source'|'unit'>,index:ReturnType<typeof deliveryIndex>):number {
 const branch=index.branches.get(row.productionId);
 const purchase=branch?.sourcePurchaseId?index.purchases.get(branch.sourcePurchaseId):undefined;
 if(!branch||branch.closed||branch.orderId!==row.orderId||branch.lineId!==row.lineId||!purchase||purchase.orderId!==row.orderId||purchase.lineId!==row.lineId||purchase.state!=='approved'||purchase.unit!==row.unit)fail('内部交付缺少有效的准确生产来源');
 if(row.source.kind==='receipt'){
  const receipt=index.receipts.get(row.source.id);
  if(!receipt||receipt.purchaseId!==purchase!.id||receipt.destination!=='supplier'||receipt.materialDelivery)fail('请选择该分支已登记的直接回交记录');
  return receipt!.quantity;
 }
 if(row.source.kind!=='stockIssue')fail('内部交付来源类型无效','VALIDATION');
 const issue=index.movements.get(row.source.id);
 const stock=issue&&index.stock.get(issue.stockId);
 if(!issue||issue.kind!=='issue'||!stock||stock.purchaseId!==purchase!.id||stock.orderId!==row.orderId||stock.lineId!==row.lineId||stock.unit!==row.unit||issue.materialDelivery||issue.shipmentLink||issue.shipmentCorrectionHold)fail('请选择该分支未用于其他业务的准确成品出库');
 return number(index.issueRemaining.get(issue!.id)||BigInt(0));
}
/** Protect upstream quantities, returns, contract cancellation and shipment aliasing on every command. */
export function assertInternalDeliveryIntegrity(root:MistState){
 const rows=(root.internalDeliveries||[]).filter(row=>!row.cancelled);if(!rows.length)return;
 const index=deliveryIndex(root),sources=new Map<string,{row:InternalDelivery;reserved:bigint;capacity:bigint}>(),branches=new Map<string,bigint>(),lines=new Map<string,bigint>();
 for(const row of rows){
  const totals=internalDeliveryTotals(row),reserved=minor(totals.reserved);
  if(plus([totals.accepted,totals.rejected])>minor(row.quantity)||minor(totals.returned)>minor(totals.rejected))fail('内部点收与退回数量不一致');
  if(reserved===BigInt(0))continue;
  const order=index.orders.get(row.orderId),line=index.lines.get(row.lineId);
  if(!order||!line||line.orderId!==row.orderId||order.governance?.contract.kind!=='internal'||order.governance.contract.internalSupply)fail('内部交付来源订单不可用');
  if(physicalKey(line)!==row.physicalKey)fail('已交付条目的实物规格不能直接改写，请先核对原交付');
  if(['void','cancelled'].includes(order.governance.status))fail('存在内部交付记录，请先按实际去向处理后再终止订单');
  const key=row.source.kind+':'+row.source.id,source=sources.get(key);sources.set(key,{row,reserved:(source?.reserved||BigInt(0))+reserved,capacity:minor(sourceCapacity(row,index))});
  branches.set(row.productionId,(branches.get(row.productionId)||BigInt(0))+reserved);lines.set(row.lineId,(lines.get(row.lineId)||BigInt(0))+reserved);
 }
 for(const {reserved,capacity} of sources.values())if(reserved>capacity)fail('内部交付超过准确来源可交数量');
 for(const [id,reserved] of branches){const completion=index.facts.get(id)?.completion;if(index.shipped.has(id))fail('同一生产分支不能同时用于内部交付与出运');if(!completion||reserved>minor(completion.quantity))fail('内部交付超过该分支实际完工数量');}
 for(const [id,reserved] of lines)if(reserved>minor(index.lines.get(id)!.qty))fail('内部交付超过订单条目数量');
}
export function internalDeliveryState(root:MistState,orderId:string):string|null{
 const order=root.orders.find(o=>o.id===orderId);if(order?.governance?.contract.kind!=='internal'||order.governance.contract.internalSupply)return null;
 const rows=(root.internalDeliveries||[]).filter(r=>r.orderId===orderId&&!r.cancelled),lines=root.orderLines.filter(l=>l.orderId===orderId);
 if(lines.length&&lines.every(l=>plus(rows.filter(r=>r.lineId===l.id).map(r=>internalDeliveryTotals(r).accepted))>=minor(l.qty)))return '内部交付完成';
 if(rows.some(r=>internalDeliveryTotals(r).accepted>0))return '部分内部交付';
 if(rows.some(r=>internalDeliveryTotals(r).pending>0))return '待内部接收';
 return null;
}
export function applyInternalDeliveryCommand(root:MistState,command:InternalDeliveryCommand,ctx:MistContext):MistCommandResult{
 if(!['order.internal.send','order.internal.receive','order.internal.reverseCheck','order.internal.returnRejected','order.internal.cancel'].includes(command.type))fail('未知内部交付操作','VALIDATION');
 const operator=resolveMember(ctx,ctx.actorId,'经办人');
 if(command.type==='order.internal.send'){
  const p=command.payload,order=assertOrderApproved(root,p.orderId);assertOrderWritable(order);
  if(order.governance?.contract.kind!=='internal'||order.governance.contract.internalSupply)fail('仅内部用途成品使用此交接；内部面料仍按分配发料');
  const branch=root.productions.find(b=>b.id===p.productionId&&b.orderId===order.id&&!b.closed)||fail('请选择当前订单的准确生产分支');
  const line=root.orderLines.find(l=>l.id===branch.lineId&&l.orderId===order.id)||fail('订单条目不存在');assertOrderLineOpen(line);
  const fact=fulfillmentProductionFact(root,branch.id);if(!fact?.completion||fact.hold||!fulfillmentProductionQcPassed(root,branch))fail('内部交付须先完成最终点数及有效生产 QC');
  const existing=(root.internalDeliveries||[]).filter(r=>r.orderId===order.id);if(p.expectedRevision!==existing.length)fail('交付来源已变化，请刷新','CONFLICT');
  const receiver=resolveMember(ctx,p.receiverId,'本次接收账号'),quantity=minor(p.quantity);if(quantity<=BigInt(0))fail('交付数量须大于零','VALIDATION');
  if(!p.source||!['receipt','stockIssue'].includes(p.source.kind)||typeof p.source.id!=='string')fail('请选择准确交付来源','VALIDATION');
  const actualDate=date(p.date,ctx);if(actualDate<fact.completion.date)fail('交付日期不得早于实际完工日');
  const row:InternalDelivery={id:ctx.id(),orderId:order.id,lineId:line.id,productionId:branch.id,orderCode:order.code,lineName:line.name,style:line.style,unit:line.unit,physicalKey:physicalKey(line),productionCode:branch.code,source:{kind:p.source.kind,id:p.source.id},quantity:number(quantity),receiverId:receiver.id,receiver:receiver.name,intendedReceiver:order.governance.contract.receiver,location:text(p.location,'交付地点'),date:actualDate,created:stamp(ctx,text(p.evidence,'交接依据')),checks:[],returns:[]};
  (root.internalDeliveries||=[]).push(row);assertInternalDeliveryIntegrity(root);
  const target={view:'orders/list',id:row.id,section:'internal-deliveries'};
  root.tasks.push({id:'internal-delivery:'+row.id,title:`内部交付待接收 · ${order.code}`,due:actualDate,done:false,kind:'internal-delivery',target,assigneeIds:[receiver.id],permission:'orders:read'});
  root.events.unshift({id:ctx.id(),entityType:'order',entityId:order.id,actor:operator.name,at:ctx.now,text:`登记内部交付 ${row.quantity} ${row.unit} · ${receiver.name}`,fileIds:[]});
  return{id:row.id,orderId:order.id};
 }
 const p=command.payload,row=(root.internalDeliveries||[]).find(r=>r.id===p.id)||fail('内部交付记录不存在','NOT_FOUND');current(row,p.expectedRevision);
 const receiverCommand=command.type==='order.internal.receive'||command.type==='order.internal.reverseCheck';
 if(receiverCommand&&row.receiverId!==ctx.actorId)fail('仅本次指定接收账号可办理点收或更正','FORBIDDEN');
 if(!receiverCommand){const order=assertOrderApproved(root,row.orderId);assertOrderWritable(order);}
 if(command.type==='order.internal.receive'){
  const p=command.payload,a=minor(p.accepted),r=minor(p.rejected),totals=internalDeliveryTotals(row);
  if(a+r<=BigInt(0)||a+r>minor(totals.pending))fail('本次点收须大于零且不超过待接收数量');
  const branch=root.productions.find(b=>b.id===row.productionId)!;
  if(a>BigInt(0)&&(fulfillmentProductionFact(root,branch.id)?.hold||!fulfillmentProductionQcPassed(root,branch)))fail('当前质量或生产状态不允许接收；可记录实际拒收');
  row.checks.push({id:ctx.id(),accepted:number(a),rejected:number(r),...stamp(ctx,text(p.evidence,'点收依据'))});
 }else if(command.type==='order.internal.reverseCheck'){
  const p=command.payload,check=row.checks.find(c=>c.id===p.checkId&&!c.reversed)||fail('该点收记录不存在或已更正');
  check.reversed=stamp(ctx,text(p.reason,'更正原因'));if(minor(internalDeliveryTotals(row).returned)>minor(internalDeliveryTotals(row).rejected))fail('拒收料已有退回记录，不能直接更正该点收');
 }else if(command.type==='order.internal.returnRejected'){
  const p=command.payload,totals=internalDeliveryTotals(row),quantity=minor(p.quantity);if(quantity<=BigInt(0)||quantity>minor(totals.rejected)-minor(totals.returned))fail('退回数量超过本次未退拒收量');
  const day=date(p.date,ctx);if(day<row.date)fail('退回日期不得早于交付日期');
  row.returns.push({id:ctx.id(),quantity:number(quantity),date:day,...stamp(ctx,text(p.evidence,'拒收料实际退回依据'))});
 }else if(command.type==='order.internal.cancel'){
  if(internalDeliveryTotals(row).accepted>0)fail('已有接收数量，不能撤回整笔交付');
  row.cancelled=stamp(ctx,text(command.payload.reason,'撤回原因与实物去向'));
 }
 assertInternalDeliveryIntegrity(root);
 const task=root.tasks.find(t=>t.id==='internal-delivery:'+row.id);if(task)task.done=!!row.cancelled||internalDeliveryTotals(row).pending===0;
 const label=command.type==='order.internal.receive'?`内部点收 · 接收 ${command.payload.accepted} ${row.unit} · 拒收 ${command.payload.rejected} ${row.unit}`:command.type==='order.internal.reverseCheck'?'更正内部点收':command.type==='order.internal.returnRejected'?`登记内部拒收退回 ${command.payload.quantity} ${row.unit}`:'撤回内部交付';
 root.events.unshift({id:ctx.id(),entityType:'order',entityId:row.orderId,actor:operator.name,at:ctx.now,text:label,fileIds:[]});
 return{id:row.id,orderId:row.orderId};
}
