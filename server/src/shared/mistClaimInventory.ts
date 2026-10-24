/** Physical customer returns use the sole Mist stock ledger; approval is owned by Claims. */
import {MistCommandError,mistOrderOwnerIds,type MistState,type MistContext,type MistCommandResult} from './mistWorkspace';
import {getExecutedClaimGoodsSource,platformBusinessDate,type PlatformClaimGoodsSource,type PlatformClaimGoods} from './mistPlatform';
import {canVerifyClaim,claimQcPermission} from './mistClaimCoordination';
import type {FulfillmentStock,FulfillmentStockMovement} from './mistFulfillment';

export type ClaimInventoryWarehouse={id:string;code:string;name:string;address:string;active:boolean;createdAt:string;updatedAt:string};
export type ClaimReturnReceipt={id:string;code:string;claimId:string;warehouseId:string;goodsIds:string[];createdAt:string;actorId:string;actor:string};
type RepairActor={at:string;actorId:string;actor:string};
/** Repair work is shared with Claims/QC; physical stock and movement records remain in Inventory. */
export type ClaimRepairJob=RepairActor&{id:string;receivedEventId:string;stockId:string;batchNumber:string;quantity:number;unit:string;domain:'fabric'|'garment';warehouseId:string;place:string;supplierId:string;supplierName:string;technician:string;completedAt:string;basis:string;fileIds:string[];qc?:RepairActor&{id:string;result:'pass'|'fail';checkedAt:string;basis:string;fileIds:string[]};handback?:RepairActor&{id:string;date:string;customerId:string;recipient:string;reference:string;basis:string;fileIds:string[];unlockMovementId:string;outboundMovementId:string}};
export type ClaimReceivedRecord={id:string;returnReceiptId:string;goodsId:string;stockId:string;source:PlatformClaimGoodsSource;quantity:number;unit:string;warehouseId:string;batchNumber:string;location:string;ownership:'Owned'|'Transferred';ownerCustomerId?:string;ownershipDate:string;ownershipEvidence:string;receivedAt:string;basis:string;fileIds:string[];at:string;actorId:string;actor:string;inboundMovementId:string;holdMovementId:string;releasedRepairId?:string;disposal?:{id:string;basis:string;fileIds:string[];at:string;actorId:string;actor:string;unlockMovementId:string;outboundMovementId:string}};
export type ClaimInventoryCommand=
 |{type:'fulfillment.claimInventory.warehouse.save';payload:{id?:string;code:string;name:string;address:string;active:boolean}}
 |{type:'fulfillment.claimInventory.receive';payload:{goodsId:string;quantity:number;unit:string;warehouseId:string;location:string;batchNumber:string;ownership:'Owned'|'Transferred';ownershipDate:string;ownershipEvidence:string;receivedAt:string;basis:string;fileIds:string[]}}
 |{type:'fulfillment.claimInventory.scrap';payload:{goodsId:string;receivedEventId:string;basis:string;fileIds:string[]}}
 |{type:'fulfillment.claimInventory.repair.record';payload:{goodsId:string;receivedEventId:string;supplierId:string;technician:string;completedAt:string;basis:string;fileIds:string[]}}
 |{type:'fulfillment.claimInventory.repair.qc';payload:{goodsId:string;repairId:string;result:'pass'|'fail';checkedAt:string;basis:string;fileIds:string[]}}
 |{type:'fulfillment.claimInventory.repair.handback';payload:{goodsId:string;repairId:string;date:string;recipient:string;reference:string;basis:string;fileIds:string[]}};
type NumberContext=MistContext&{consumeBusinessNumber?:(prefix:'RT')=>string};
const fail=(message:string,code='VALIDATION'):never=>{throw new MistCommandError(code,message);};
const text=(value:unknown,label:string,max=4000)=>typeof value==='string'&&!!value.trim()&&value.length<=max?value.trim():fail(label+'未填写或格式无效');
const amount=(value:unknown,label='数量'):number=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=1e9&&Math.abs(value*10000-Math.round(value*10000))<0.00001?value:fail(label+'须为正数，最多四位小数');
const units=(value:number)=>Math.round(value*10000);
const total=(values:number[])=>values.reduce((sum,value)=>sum+units(value),0)/10000;
const same=(a:unknown,b:unknown)=>JSON.stringify(a&&typeof a==='object'?Object.entries(a).sort(([x],[y])=>x.localeCompare(y)):a)===JSON.stringify(b&&typeof b==='object'?Object.entries(b).sort(([x],[y])=>x.localeCompare(y)):b);
function day(value:unknown,label:string){const result=text(value,label,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(result)||!Number.isFinite(Date.parse(result+'T00:00:00Z'))||new Date(result+'T00:00:00Z').toISOString().slice(0,10)!==result)fail(label+'须为有效日期');return result;}
function files(root:MistState,ids:unknown){if(!Array.isArray(ids)||ids.length>100)fail('凭据附件格式无效');return [...new Set((ids as unknown[]).map(id=>{const value=text(id,'附件编号',200);if(!root.files.some(file=>file.id===value))fail('凭据附件不属于本公司');return value;}))];}
function repairEvidence(root:MistState,ids:unknown,allowed:string[]){const result=files(root,ids);if(result.some(id=>!allowed.includes(id)))fail('返修凭据须已归入本案件');return result;}
function actor(context:MistContext){return {actorId:text(context.actorId,'实际登录账号',200),actor:text(context.actorName,'实际经手业务员',200)};}
function data(root:MistState){const f=root.fulfillment;f.warehouses||=[];f.returnReceipts||=[];f.receivedRecords||=[];return f;}
function warehouse(root:MistState,id:string){const row=data(root).warehouses.find(item=>item.id===id);if(!row||!row.active)fail('请选择本公司真实启用的仓库','PRECONDITION');return row!;}
function active(root:MistState,goodsId:string){const scope=getExecutedClaimGoodsSource(root,goodsId);if(['Closed','Cancelled'].includes(scope.claim.state))fail('案件已结束，不能再办理实物收货或处置','PRECONDITION');return scope;}
function receiptFor(root:MistState,goodsId:string){const {goods,source}=getExecutedClaimGoodsSource(root,goodsId),f=data(root),receipt=f.returnReceipts.find(row=>row.id===goods.returnReceiptId);if(!receipt||receipt.claimId!==source.claimId||!receipt.goodsIds.includes(goodsId)||new Set(receipt.goodsIds).size!==receipt.goodsIds.length||!f.warehouses.some(row=>row.id===receipt.warehouseId))fail('退回履行缺少准确正式退货单或仓库，请核对来源','INVALID_STATE');return receipt!;}
export function claimInventoryPermission(command:ClaimInventoryCommand){return command.type==='fulfillment.claimInventory.repair.qc'?'qc:inspect':'inventory:write';}
export function latestClaimRepair(goods:Pick<PlatformClaimGoods,'repairs'>,receivedEventId:string){return goods.repairs?.filter(row=>row.receivedEventId===receivedEventId).at(-1);}
function repairDate(value:unknown,label:string,earliest:string,context:MistContext){const date=day(value,label);if(date<earliest||date>platformBusinessDate(context.now))fail(label+'须在前序业务日期与当前业务日之间');return date;}

/** Called only by the executed disposition producer, in the same cloned state/transaction. */
export function createClaimReturnReceipt(root:MistState,goodsId:string,warehouseId:string,context:MistContext):ClaimReturnReceipt{
 const {goods,source,claim,disposition}=active(root,goodsId),f=data(root);warehouse(root,warehouseId);const who=actor(context);
 const linked=f.returnReceipts.filter(row=>row.claimId===source.claimId);if(linked.length>1)fail('案件有多张退货单，不能自动选择其中一张','INVALID_STATE');
 let receipt=linked[0];
 if(receipt){if(receipt.warehouseId!==warehouseId)fail('同一案件退货单不能混入第二个仓库');if(goods.returnReceiptId&&goods.returnReceiptId!==receipt.id)fail('退回履行关联的正式退货单不一致','INVALID_STATE');if(!receipt.goodsIds.includes(goodsId))receipt.goodsIds.push(goodsId);}
 else{const consume=(context as NumberContext).consumeBusinessNumber;if(!consume)fail('正式RT号段尚未准备，不能建立退货单','PRECONDITION');const code=consume!('RT');if(typeof code!=='string'||!code.startsWith('RT-')||f.returnReceipts.some(row=>row.code===code))fail('正式RT编号无效或重复','INVALID_STATE');receipt={id:context.id(),code,claimId:source.claimId,warehouseId,goodsIds:[goodsId],createdAt:context.now,...who};f.returnReceipts.push(receipt);}
 goods.returnReceiptId=receipt.id;
 const kind='claim-inventory:'+goodsId;if(!root.tasks.some(task=>task.kind===kind&&!task.done))root.tasks.unshift({id:context.id(),kind,title:'退货处理 · '+receipt.code,due:'',done:false,target:{view:'inventory',id:receipt.id,section:'claim:'+claim.id},permission:'inventory:write',assigneeIds:disposition.requesterId?[disposition.requesterId]:mistOrderOwnerIds(root,claim.orderId)});
 return receipt;
}

function ledger(root:MistState,goodsId:string){
 const {goods,source,disposition}=getExecutedClaimGoodsSource(root,goodsId),f=data(root),receipt=receiptFor(root,goodsId),records=f.receivedRecords.filter(row=>row.goodsId===goodsId);
 if(goods.repairs?.length&&(goods.destination!=='Repair'||disposition.kind!=='Repair'||new Set(goods.repairs.map(row=>row.id)).size!==goods.repairs.length||goods.repairs.some(job=>!records.some(record=>record.id===job.receivedEventId))))fail('返修记录与批准处置或收货来源不一致','INVALID_STATE');
 if(new Set(records.map(row=>row.id)).size!==records.length||new Set(records.map(row=>row.stockId)).size!==records.length)fail('实际退货批次编号或库存关联重复','INVALID_STATE');
 for(const record of records){
  amount(record.quantity);const stock=f.stock.find(row=>row.id===record.stockId),jobs=(goods.repairs??[]).filter(job=>job.receivedEventId===record.id),released=jobs.find(job=>job.id===record.releasedRepairId),handback=released?.handback,remaining=record.disposal||handback?0:record.quantity;
  if(record.releasedRepairId&&!handback||record.disposal&&handback||jobs.some(job=>job.handback&&job!==released))fail('返修交还与收货批次关联不一致','INVALID_STATE');
  for(const job of jobs){
   if(job.stockId!==record.stockId||job.quantity!==record.quantity||job.unit!==record.unit||job.warehouseId!==record.warehouseId||job.batchNumber!==record.batchNumber||!job.actorId||!job.actor)fail('维修记录与真实收货批次不一致','INVALID_STATE');
   files(root,job.fileIds);if(job.qc)files(root,job.qc.fileIds);
   if(job.handback){files(root,job.handback.fileIds);if(job!==latestClaimRepair(goods,record.id)||job.qc?.result!=='pass'||record.ownership!=='Transferred'||record.ownerCustomerId!==source.customerId||job.handback.customerId!==source.customerId||!job.handback.actorId||!job.handback.actor)fail('返修交还缺少准确客户货权或合格复检','INVALID_STATE');}
  }
  if(!same(record.source,source)||record.returnReceiptId!==receipt.id||record.warehouseId!==receipt.warehouseId||record.unit!==source.unit||!stock||stock.sourceKind!=='claimReturn'||stock.goodsId!==goodsId||stock.claimId!==source.claimId||stock.dispositionId!==source.dispositionId||stock.invoiceId!==source.invoiceId||stock.orderId!==source.orderId||stock.lineId!==source.lineId||stock.returnReceiptId!==receipt.id||stock.receivedEventId!==record.id||stock.warehouseId!==record.warehouseId||stock.batchNumber!==record.batchNumber||stock.unit!==record.unit||stock.location!==record.location||stock.ownership!==record.ownership||stock.ownerCustomerId!==record.ownerCustomerId||stock.ownershipDate!==record.ownershipDate||stock.ownershipEvidence!==record.ownershipEvidence||stock.quantity!==record.quantity||stock.onHand!==remaining||stock.locked!==remaining||stock.available!==0||stock.purchaseId||stock.receiptId)fail('退货库存、隔离余额或冻结来源与实收事实不一致','INVALID_STATE');
  files(root,record.fileIds);if(record.disposal)files(root,record.disposal.fileIds);
  const verify=(id:string,kind:FulfillmentStockMovement['kind'],onHandBefore:number,onHandAfter:number,lockedBefore:number,lockedAfter:number)=>{const movement=f.stockMovements.find(row=>row.id===id),fact=kind==='unlock'||kind==='scrap'||kind==='issue'?record.disposal??handback:record;if(!movement||!fact||movement.stockId!==stock!.id||movement.kind!==kind||movement.quantity!==record.quantity||movement.unit!==record.unit||movement.goodsId!==goodsId||movement.receivedEventId!==record.id||movement.warehouseId!==record.warehouseId||movement.location!==record.location||movement.actor!==fact.actor||movement.at!==fact.at||movement.note!==fact.basis||movement.onHandBefore!==onHandBefore||movement.onHandAfter!==onHandAfter||movement.lockedBefore!==lockedBefore||movement.lockedAfter!==lockedAfter)fail('退回库存缺少完整入库、隔离或处置流水','INVALID_STATE');};
  verify(record.inboundMovementId,'receive',0,record.quantity,0,0);verify(record.holdMovementId,'lock',record.quantity,record.quantity,0,record.quantity);
  if(record.disposal){verify(record.disposal.unlockMovementId,'unlock',record.quantity,record.quantity,record.quantity,0);verify(record.disposal.outboundMovementId,'scrap',record.quantity,0,0,0);}
  if(handback){verify(handback.unlockMovementId,'unlock',record.quantity,record.quantity,record.quantity,0);verify(handback.outboundMovementId,'issue',record.quantity,0,0,0);}
  const known=new Set([record.inboundMovementId,record.holdMovementId,...(record.disposal?[record.disposal.unlockMovementId,record.disposal.outboundMovementId]:[]),...(handback?[handback.unlockMovementId,handback.outboundMovementId]:[])]);if(f.stockMovements.some(row=>row.stockId===stock!.id&&!known.has(row.id)))fail('退回库存存在未绑定真实收货批次的流水','INVALID_STATE');
 }
 const received=total(records.map(row=>row.quantity));if(units(received)>units(source.quantity)||goods.receivedQuantity!==undefined&&goods.receivedQuantity!==received)fail('实际收货汇总超过批准量或与退回履行不一致','INVALID_STATE');
 return {goods,source,receipt,records,received};
}
export function getClaimGoodsReceivedQuantity(root:MistState,goodsId:string){return ledger(root,goodsId).received;}
export function assertClaimGoodsFullyReturned(root:MistState,goodsId:string){const {source,records,received}=ledger(root,goodsId);if(!records.length||units(received)!==units(source.quantity))fail('退货退款须完整实际收货，不能以状态或部分收货代替','PRECONDITION');}
export function assertClaimGoodsInventorySettled(root:MistState,goodsId:string){const scope=ledger(root,goodsId);assertClaimGoodsFullyReturned(root,goodsId);const settled=scope.goods.destination==='Scrap'?scope.records.every(record=>record.disposal):scope.goods.destination==='Repair'&&scope.records.every(record=>record.releasedRepairId);if(!settled)fail('退回库存仍有隔离货物，或缺少返修/补发真实放行事实，不能关闭案件','PRECONDITION');}
function event(root:MistState,context:MistContext,claimId:string,stockId:string,message:string,fileIds:string[]){root.events.unshift({id:context.id(),entityType:'inventory',entityId:stockId,actor:context.actorName,at:context.now,text:message,fileIds});root.notifications.unshift({id:context.id(),category:'general',title:message,detail:'',at:context.now,readAt:null,target:{view:'claims',id:claimId}});}

type RepairCommand=Extract<ClaimInventoryCommand,{type:'fulfillment.claimInventory.repair.record'|'fulfillment.claimInventory.repair.qc'|'fulfillment.claimInventory.repair.handback'}>;
function refreshRepairProgress(root:MistState,goods:PlatformClaimGoods){
 const rows=data(root).receivedRecords.filter(row=>row.goodsId===goods.id),complete=units(total(rows.map(row=>row.quantity)))===units(goods.quantity);
 goods.state=complete&&rows.every(row=>row.releasedRepairId)?'HandedBack':complete&&rows.every(row=>row.releasedRepairId||latestClaimRepair(goods,row.id)?.qc?.result==='pass')?'Ready':'Repairing';
 if(goods.state==='HandedBack')root.tasks.filter(task=>task.kind==='claim-inventory:'+goods.id).forEach(task=>task.done=true);
}
function applyRepairCommand(root:MistState,command:RepairCommand,context:MistContext):MistCommandResult{
 const p=command.payload,{goods,source,claim,disposition}=active(root,p.goodsId),scope=ledger(root,p.goodsId),who=actor(context);
 if(goods.destination!=='Repair'||disposition.kind!=='Repair')fail('批准处置不是返修交还','PRECONDITION');
 const job=command.type==='fulfillment.claimInventory.repair.record'?undefined:goods.repairs?.find(row=>row.id===command.payload.repairId);
 const record=scope.records.find(row=>row.id===(command.type==='fulfillment.claimInventory.repair.record'?command.payload.receivedEventId:job?.receivedEventId));
 if(!record)fail('请选择本案真实返修批次','NOT_FOUND');
 if(record!.disposal||record!.releasedRepairId)fail('本批已处置或交还，不能重复办理','PRECONDITION');
 if(record!.ownership!=='Transferred'||record!.ownerCustomerId!==source.customerId)fail('返修交还须保留来源客户货权','PRECONDITION');
 warehouse(root,record!.warehouseId);
 const latest=latestClaimRepair(goods,record!.id);
 if(command.type==='fulfillment.claimInventory.repair.record'){
  const v=command.payload;if(latest&&!latest.qc)fail('本批维修尚待复检，请勿重复登记','PRECONDITION');
  const supplier=root.market.suppliers.find(row=>row.id===text(v.supplierId,'维修工厂'));
  if(!supplier)fail('请选择本公司维修工厂','NOT_FOUND');
  const domain=root.orders.find(row=>row.id===source.orderId)?.type;if(domain!=='fabric'&&domain!=='garment')fail('返修来源业务线无法核实','INVALID_STATE');
  const completedAt=repairDate(v.completedAt,'维修日期',record!.receivedAt,context),basis=text(v.basis,'维修记录'),fileIds=repairEvidence(root,v.fileIds,[...claim.fileIds,...disposition.fileIds]);
  const next:ClaimRepairJob={id:context.id(),receivedEventId:record!.id,stockId:record!.stockId,batchNumber:record!.batchNumber,quantity:record!.quantity,unit:record!.unit,domain:domain!,warehouseId:record!.warehouseId,place:warehouse(root,record!.warehouseId).name+' · '+record!.location,supplierId:supplier!.id,supplierName:supplier!.name,technician:text(v.technician,'维修人员',200),completedAt,basis,fileIds,at:context.now,...who};
  (goods.repairs??=[]).push(next);refreshRepairProgress(root,goods);
  root.tasks.unshift({id:context.id(),kind:'claim-repair-qc:'+next.id,title:'返修复检 · '+claim.code,due:'',done:false,assigneeIds:[],permission:claimQcPermission(root,claim)??'qc:inspect',target:{view:'claims',id:claim.id}});
  goods.events.push({at:context.now,actor:who.actor,action:'Repairing',basis,fileIds});event(root,context,claim.id,record!.stockId,claim.code+' 返修待复检 · '+record!.batchNumber,fileIds);return{id:next.id,claimId:claim.id,receivedEventId:record!.id};
 }
 if(!job||job!==latest)fail('请办理本批最新维修记录','PRECONDITION');
 if(command.type==='fulfillment.claimInventory.repair.qc'){
  if(!canVerifyClaim(root,claim,context.can))throw new MistCommandError('FORBIDDEN','仅对应业务线QC可复检返修',403);
  const v=command.payload;if(job!.qc)fail('本次复检已登记，原记录不能覆盖','PRECONDITION');if(!['pass','fail'].includes(v.result))fail('复检结果无效');
  const checkedAt=repairDate(v.checkedAt,'复检日期',job!.completedAt,context),basis=text(v.basis,'复检记录'),fileIds=repairEvidence(root,v.fileIds,[...claim.fileIds,...disposition.fileIds]);
  job!.qc={id:context.id(),result:v.result,checkedAt,basis,fileIds,at:context.now,...who};root.tasks.filter(task=>task.kind==='claim-repair-qc:'+job!.id).forEach(task=>task.done=true);refreshRepairProgress(root,goods);
  goods.events.push({at:context.now,actor:who.actor,action:v.result==='pass'?'Ready':'Repairing',basis,fileIds});event(root,context,claim.id,record!.stockId,claim.code+(v.result==='pass'?' 返修复检合格 · ':' 返修复检不合格 · ')+record!.batchNumber,fileIds);return{id:job!.qc.id,claimId:claim.id,repairId:job!.id};
 }
 const v=command.payload;if(job!.qc?.result!=='pass')fail('最新维修须经对应业务线QC复检合格','PRECONDITION');
 const date=repairDate(v.date,'交还日期',job!.qc!.checkedAt,context),basis=text(v.basis,'交接记录'),fileIds=repairEvidence(root,v.fileIds,[...claim.fileIds,...disposition.fileIds]),id=context.id(),unlockMovementId=context.id(),outboundMovementId=context.id(),stock=data(root).stock.find(row=>row.id===record!.stockId)!;
 job!.handback={id,date,customerId:source.customerId,recipient:text(v.recipient,'客户接收人',200),reference:text(v.reference,'交接凭据',300),basis,fileIds,at:context.now,...who,unlockMovementId,outboundMovementId};record!.releasedRepairId=job!.id;
 const movement=(movementId:string,kind:'unlock'|'issue',onHandAfter:number,lockedBefore:number):FulfillmentStockMovement=>({id:movementId,stockId:stock.id,kind,quantity:record!.quantity,unit:record!.unit,warehouseId:record!.warehouseId,goodsId:goods.id,receivedEventId:record!.id,location:record!.location,person:job!.handback!.recipient,note:basis,at:context.now,actor:who.actor,onHandBefore:record!.quantity,onHandAfter,lockedBefore,lockedAfter:0});
 data(root).stockMovements.push(movement(unlockMovementId,'unlock',record!.quantity,record!.quantity),movement(outboundMovementId,'issue',0,0));stock.onHand=0;stock.locked=0;stock.available=0;refreshRepairProgress(root,goods);ledger(root,goods.id);
 goods.events.push({at:context.now,actor:who.actor,action:'HandedBack',basis,fileIds});event(root,context,claim.id,stock.id,claim.code+' 返修交还 · '+record!.batchNumber,fileIds);return{id,claimId:claim.id,stockId:stock.id,repairId:job!.id};
}

export function applyClaimInventoryCommand(root:MistState,command:ClaimInventoryCommand,context:MistContext):MistCommandResult{
 const f=data(root),who=actor(context);
 if(command.type==='fulfillment.claimInventory.repair.record'||command.type==='fulfillment.claimInventory.repair.qc'||command.type==='fulfillment.claimInventory.repair.handback')return applyRepairCommand(root,command,context);
 if(command.type==='fulfillment.claimInventory.warehouse.save'){
  const p=command.payload,code=text(p.code,'仓库代码',80),name=text(p.name,'仓库名称',200),address=text(p.address,'实际仓库地址',1000);if(typeof p.active!=='boolean')fail('仓库启用状态无效');if(f.warehouses.some(row=>row.id!==p.id&&row.code.toLocaleLowerCase()===code.toLocaleLowerCase()))fail('仓库代码已被使用');
  const old=p.id?f.warehouses.find(row=>row.id===p.id):undefined;if(p.id&&!old)fail('仓库不存在','NOT_FOUND');if(old&&!p.active&&f.stock.some(row=>row.warehouseId===old.id&&((row.onHand??0)>0||(row.locked??0)>0)))fail('仓库仍有实际库存或隔离数量，不能停用');
  const id=old?.id||context.id();if(old)Object.assign(old,{code,name,address,active:p.active,updatedAt:context.now});else f.warehouses.push({id,code,name,address,active:p.active,createdAt:context.now,updatedAt:context.now});root.events.unshift({id:context.id(),entityType:'inventory',entityId:id,actor:who.actor,at:context.now,text:'保存真实仓库资料 '+name,fileIds:[]});return{id};
 }
 if(command.type==='fulfillment.claimInventory.receive'){
  const p=command.payload,{goods,source,claim,disposition}=active(root,p.goodsId),current=ledger(root,p.goodsId),place=warehouse(root,p.warehouseId);if(p.warehouseId!==current.receipt.warehouseId)fail('实际收货仓库必须与正式退货单一致');const quantity=amount(p.quantity);if(p.unit!==source.unit)fail('实收单位必须保持批准来源单位，本次不自动换算');if(units(current.received)+units(quantity)>units(source.quantity))fail('累计实收超过批准退回数量');if(!['Owned','Transferred'].includes(p.ownership))fail('请明确选择我方或客户货权');const location=text(p.location,'实际仓内位置',500),batchNumber=text(p.batchNumber,'真实退回批号',200),basis=text(p.basis,'实际点数与交接依据'),ownershipDate=day(p.ownershipDate,'货权确认日期'),ownershipEvidence=text(p.ownershipEvidence,'货权确认依据'),receivedAt=day(p.receivedAt,'实际收货日期'),fileIds=files(root,p.fileIds);if(p.ownership==='Transferred'&&!root.customers.some(row=>row.id===source.customerId))fail('客户货权缺少实际来源客户','INVALID_STATE');
  if(receivedAt>platformBusinessDate(context.now))fail('收货日期不能在未来');if(disposition.kind==='Repair'&&p.ownership!=='Transferred')fail('返修交还须保留来源客户货权');
  const id=context.id(),stockId=context.id(),inboundMovementId=context.id(),holdMovementId=context.id(),ownerCustomerId=p.ownership==='Transferred'?source.customerId:undefined;
  const stock:FulfillmentStock={id:stockId,sourceKind:'claimReturn',claimId:source.claimId,dispositionId:source.dispositionId,goodsId:goods.id,invoiceId:source.invoiceId,returnReceiptId:current.receipt.id,receivedEventId:id,orderId:source.orderId,lineId:source.lineId,name:source.name,unit:source.unit,quantity,onHand:quantity,locked:quantity,available:0,warehouseId:place.id,batchNumber,location,ownership:p.ownership,...(ownerCustomerId?{ownerCustomerId}:{}),ownershipDate,ownershipEvidence,owner:p.ownership==='Owned'?'我方货权':root.customers.find(row=>row.id===source.customerId)!.name+' · 客户货权',createdAt:context.now};
  const record:ClaimReceivedRecord={id,returnReceiptId:current.receipt.id,goodsId:goods.id,stockId,source:structuredClone(source),quantity,unit:source.unit,warehouseId:place.id,batchNumber,location,ownership:p.ownership,...(ownerCustomerId?{ownerCustomerId}:{}),ownershipDate,ownershipEvidence,receivedAt,basis,fileIds,at:context.now,...who,inboundMovementId,holdMovementId};
  const movement=(movementId:string,kind:'receive'|'lock',onHandBefore:number,lockedAfter:number):FulfillmentStockMovement=>({id:movementId,stockId,kind,quantity,unit:source.unit,warehouseId:place.id,goodsId:goods.id,receivedEventId:id,location,person:claim.code,note:basis,at:context.now,actor:who.actor,onHandBefore,onHandAfter:quantity,lockedBefore:0,lockedAfter});
  f.stock.push(stock);f.stockMovements.push(movement(inboundMovementId,'receive',0,0),movement(holdMovementId,'lock',quantity,quantity));f.receivedRecords.push(record);goods.receivedQuantity=total([current.received,quantity]);goods.state=units(goods.receivedQuantity)===units(source.quantity)?'Received':'PartiallyReceived';goods.events.push({at:context.now,actor:who.actor,action:goods.state,basis,fileIds});ledger(root,goods.id);event(root,context,claim.id,stockId,claim.code+' 实际退货入库并隔离 '+quantity+source.unit,fileIds);return{id,stockId,receivedEventId:id,receivedQuantity:goods.receivedQuantity,returnReceiptId:current.receipt.id};
 }
 if(command.type==='fulfillment.claimInventory.scrap'){
  const p=command.payload,{goods,claim}=active(root,p.goodsId),current=ledger(root,p.goodsId);if(goods.destination!=='Scrap')fail('批准退回去向不是报废，不能用备注替代审批');const record=current.records.find(row=>row.id===p.receivedEventId);if(!record)fail('请选择本退回履行单的真实收货批次','NOT_FOUND');if(record!.disposal)fail('该真实收货批次已经报废，不能重复处置');warehouse(root,record!.warehouseId);const basis=text(p.basis,'批准报废执行依据'),fileIds=files(root,p.fileIds),id=context.id(),unlockMovementId=context.id(),outboundMovementId=context.id(),stock=f.stock.find(row=>row.id===record!.stockId)!;
  const movement=(movementId:string,kind:'unlock'|'scrap',onHandAfter:number,lockedBefore:number):FulfillmentStockMovement=>({id:movementId,stockId:stock.id,kind,quantity:record!.quantity,unit:record!.unit,warehouseId:record!.warehouseId,goodsId:goods.id,receivedEventId:record!.id,location:record!.location,person:claim.code,note:basis,at:context.now,actor:who.actor,onHandBefore:record!.quantity,onHandAfter,lockedBefore,lockedAfter:0});
  f.stockMovements.push(movement(unlockMovementId,'unlock',record!.quantity,record!.quantity),movement(outboundMovementId,'scrap',0,0));stock.onHand=0;stock.locked=0;stock.available=0;record!.disposal={id,basis,fileIds,at:context.now,...who,unlockMovementId,outboundMovementId};if(units(current.received)===units(current.source.quantity)&&current.records.every(row=>row.disposal)){goods.state='Scrapped';root.tasks.filter(task=>task.kind==='claim-inventory:'+goods.id).forEach(task=>task.done=true);}goods.events.push({at:context.now,actor:who.actor,action:'Scrapped',basis,fileIds});ledger(root,goods.id);event(root,context,claim.id,stock.id,claim.code+' 本批退货已实际报废 '+record!.quantity+record!.unit,fileIds);return{id,stockId:stock.id,disposedEventId:id,receivedEventId:record!.id,returnReceiptId:current.receipt.id};
 }
 return fail('未知退货库存操作');
}
