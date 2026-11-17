import {MistCommandError,type MistContext,type MistState} from './mistWorkspace';
import {addAtPosition,removeAtPosition,fulfillmentPositions,freeQuantity,reservationOpen,sampleLoanRemaining,type FulfillmentSample,type SampleMovement,type FulfillmentStock} from './mistFulfillment';
import {shippingSampleSourceSnapshot,shipmentHasDeparted,type ShippingSampleSourceSnapshot} from './mistShipmentSampleCustody';
import {stockCompanyOwned,sampleLoanHoldOpen,isSampleLoanHold,type StockSampleLoanHold} from './mistStockSampleLoan';
import {stableJson} from './stableJson';
import {packingSpecification,type PackingSku} from './mistPackingBreakdown';

export type CommercialSampleSourceSelection={stockId:string;location:string;quantity:number};
export type CommercialSampleLoan={kind:'warehouse'|'direct';sourceSnapshot:ShippingSampleSourceSnapshot;quantityBasisId:string;quantity:number;unit:string;qualityRevision:number;sampleLocation:string;purchaseId:string;receiptIds:string[];holds:Array<{stockId:string;reservationId:string;quantity:number;sourceLocation:string}>};
export type CommercialSampleLoanSources={status:'available';kind:'warehouse'|'direct';quantity:number;unit:string;options:Array<{stockId:string;location:string;label:string;maxQuantity:number;unit:string}>}|{status:'unreadable'|'forbidden'|'unavailable'|'insufficient';reason:string};
function fail(message:string):never{throw new MistCommandError('PRECONDITION',message);}
const sum=(values:number[])=>Math.round(values.reduce((n,x)=>n+Math.round(x*10000),0))/10000;
const same=(a:unknown,b:unknown)=>stableJson(a)===stableJson(b);
const borrowable=(stock:FulfillmentStock)=>sum([freeQuantity(stock),...(stock.reservations||[]).filter(r=>!isSampleLoanHold(r)&&r.orderId===stock.orderId&&r.lineId===stock.lineId).map(reservationOpen)]);
function origin(state:MistState,sample:FulfillmentSample){
 const basis=sample.shippingQuantityBasis;if(sample.role!=='shipping'||basis?.kind!=='included'||basis.consumption)fail('请先核对本批商业内样数量口径');
 const snapshot=shippingSampleSourceSnapshot(state,sample),ship=state.fulfillment.shipments.find(s=>s.id===sample.shipmentId)!;
 if(shipmentHasDeparted(ship))fail('本件已随本批出运，不能再借出');
 if(!same(basis.sourceSnapshot,snapshot))fail('样品或装箱来源已变，请重新核对数量口径');
 const production=state.productions.find(p=>p.id===snapshot.productionId)!,purchase=state.fulfillment.purchases.find(p=>p.id===production.sourcePurchaseId);
 if(!purchase||purchase.state!=='approved'||purchase.kind==='material'||purchase.orderId!==snapshot.orderId||purchase.lineId!==snapshot.lineId||purchase.unit!==sample.unit)fail('商业交接来源或计量单位尚未核实');
 const completion=state.fulfillment.productionFacts.find(f=>f.productionId===production.id)?.completion;
 if(!completion||state.orders.find(o=>o.id===snapshot.orderId)?.governance?.status!=='approved')fail('商业来源完工或批准事实尚未核实');
 const stocks=state.fulfillment.stock.filter(s=>s.purchaseId===purchase.id&&s.orderId===snapshot.orderId&&s.lineId===snapshot.lineId);
 const receipts=state.fulfillment.receipts.filter(r=>r.purchaseId===purchase.id&&r.quantity>0);
 const warehouse=stocks.length>0||receipts.some(r=>r.destination==='warehouse');
 return{snapshot,basis,purchase,stocks,receipts,warehouse};
}
export function commercialSampleLoanSources(state:MistState,sample:FulfillmentSample):CommercialSampleLoanSources{
 try{
  const o=origin(state,sample);if(sample.available<=0)return{status:'insufficient',reason:'本组没有可借实物'};
  if(o.warehouse&&o.receipts.some(r=>r.destination==='supplier'))return{status:'unavailable',reason:'仓收与直交来源混合，请先核对本组实物的交接来源'};
  const sourceProblem=commercialAssortmentProblem(state,sample.source.kind==='orderLine'?sample.source.productionId||'':'',sample);
  if(sourceProblem)return{status:'unavailable',reason:sourceProblem};
  if(!o.warehouse){const direct=o.receipts.filter(r=>r.destination==='supplier');if(direct.length!==1||direct[0].quantity<sample.available)return{status:'unavailable',reason:'原直交来源不能唯一核对，请先核对实物交接'};return{status:'available',kind:'direct',quantity:sample.available,unit:sample.unit,options:[]};}
  const options:Extract<CommercialSampleLoanSources,{status:'available'}>['options']=[];
  for(const stock of o.stocks){if(stock.sourceKind==='claimReturn'||stock.unit!==sample.unit||!stockCompanyOwned(stock)||stock.locked)continue;const receipt=o.receipts.find(r=>r.id===stock.receiptId&&r.destination==='warehouse');if(!receipt)continue;const remaining=borrowable(stock);for(const position of fulfillmentPositions(stock)){const max=Math.min(remaining,position.available,sample.available);if(max<=0)continue;const warehouse=state.fulfillment.warehouses.find(w=>w.id===stock.warehouseId);const label=[o.purchase.code,stock.batchNumber||receipt.date,warehouse?.name,position.location].filter(Boolean).join(' · ');options.push({stockId:stock.id,location:position.location,label,maxQuantity:max,unit:stock.unit});}}
  if(!options.length)return{status:'insufficient',reason:'商业库存没有可核对的可借实物，请核对货权、交接与占用'};
  if(new Set(options.map(s=>s.label)).size!==options.length)return{status:'unavailable',reason:'原商业批次缺少可区分的来源标识，请先核对批次'};
  if(sample.sizeQuantities&&sum([...new Set(options.map(s=>s.stockId))].map(id=>Math.min(sample.quantity,borrowable(o.stocks.find(s=>s.id===id)!))))<sample.quantity)return{status:'insufficient',reason:'商业库存不足以借出完整实物组合'};
  return{status:'available',kind:'warehouse',quantity:sample.available,unit:sample.unit,options};
 }catch(error){return{status:'unavailable',reason:error instanceof Error?error.message:'商业来源未能核对'};}
}
function physicalSame(sample:FulfillmentSample,loan:CommercialSampleLoan){const s=loan.sourceSnapshot;return sample.id===s.sampleId&&sample.quantity===s.quantity&&sample.unit===s.unit&&sample.color===s.color&&same(sample.sizeQuantities||[],s.sizeQuantities)&&sample.source.kind==='orderLine'&&sample.source.orderId===s.orderId&&sample.source.lineId===s.lineId&&sample.source.productionId===s.productionId&&(sample.qualityRevision||1)===loan.qualityRevision;}
export function openCommercialSampleLoan(state:MistState,sample:FulfillmentSample,loanId:string,quantity:number,selections:CommercialSampleSourceSelection[]|undefined,sampleLocation:string,context:MistContext):CommercialSampleLoan|undefined{
 if(sample.shippingQuantityBasis?.kind!=='included'){
  if(selections!==undefined)fail('独立样品不指定商业库存来源');return undefined;
 }
 const o=origin(state,sample),caps=commercialSampleLoanSources(state,sample);if(caps.status!=='available')fail(caps.reason);
 const data:CommercialSampleLoan={kind:caps.kind,sourceSnapshot:o.snapshot,quantityBasisId:o.basis.id,quantity,unit:sample.unit,qualityRevision:sample.qualityRevision||1,sampleLocation,purchaseId:o.purchase.id,receiptIds:o.receipts.map(r=>r.id),holds:[]};
 if(caps.kind==='direct'){if(selections!==undefined)fail('原直交样品不指定仓储来源');return data;}
 let chosen=selections;if(chosen===undefined){if(caps.options.length!==1)fail('请选择本次商业实物的准确库存来源');chosen=[{stockId:caps.options[0].stockId,location:caps.options[0].location,quantity}];}
 if(!Array.isArray(chosen)||!chosen.length||chosen.length>100||sum(chosen.map(s=>s.quantity))!==quantity)fail('商业来源数量合计须等于本次借出数量');
 const keys=new Set<string>();for(const row of chosen){if(!row||Object.keys(row).some(k=>!['stockId','location','quantity'].includes(k))||typeof row.quantity!=='number'||!Number.isFinite(row.quantity)||row.quantity<=0||Math.abs(row.quantity*10000-Math.round(row.quantity*10000))>1e-6)fail('商业来源选择或数量无效');const key=row.stockId+'\u0000'+row.location;if(keys.has(key))fail('同一商业来源位置不能重复选择');keys.add(key);const available=caps.options.find(s=>s.stockId===row.stockId&&s.location===row.location);if(!available||row.quantity>available.maxQuantity)fail('所选商业来源或可借数量已变化，请重新核对');}
 for(const id of new Set(chosen.map(s=>s.stockId)))if(sum(chosen.filter(s=>s.stockId===id).map(s=>s.quantity))>borrowable(state.fulfillment.stock.find(s=>s.id===id)!))fail('所选商业库存的可借总量已变化');
 for(const row of chosen){
  const stock=state.fulfillment.stock.find(s=>s.id===row.stockId)!,reservationId=context.id(),ordinaryAllocations:NonNullable<StockSampleLoanHold['ordinaryAllocations']>=[];let needed=Math.max(0,sum([row.quantity,-freeQuantity(stock)]));
  for(const reservation of (stock.reservations||[]).filter(r=>!isSampleLoanHold(r)&&r.orderId===stock.orderId&&r.lineId===stock.lineId)){const take=Math.min(needed,reservationOpen(reservation));if(take<=0)continue;const allocations=reservation.sampleLoanAllocations??=[],prior=allocations.find(a=>a.loanId===loanId);if(prior)prior.quantity=sum([prior.quantity,take]);else allocations.push({loanId,quantity:take,returned:0});ordinaryAllocations.push({reservationId:reservation.id,quantity:take,returned:0});needed=sum([needed,-take]);}
  if(needed>0)fail('原订单预留或商业可借数量已变化');
  removeAtPosition(stock,row.quantity,row.location);if(stock.onHand!==undefined)stock.onHand=sum([stock.onHand,-row.quantity]);(stock.reservations??=[]).push({id:reservationId,orderId:o.snapshot.orderId,lineId:o.snapshot.lineId,purpose:'商业内样借出',quantity:row.quantity,at:context.now,actor:context.actorName,sampleLoan:{sampleId:sample.id,loanId,unit:sample.unit,sourceLocation:row.location,returned:0,owned:true,...(ordinaryAllocations.length?{ordinaryAllocations}:{})}});state.fulfillment.stockMovements.push({id:context.id(),stockId:stock.id,kind:'reserve',quantity:row.quantity,sourceLocation:row.location,location:row.location,person:context.actorName,note:'商业内样借出占用',at:context.now,actor:context.actorName,sampleLoan:{sampleId:sample.id,loanId}});data.holds.push({stockId:stock.id,reservationId,quantity:row.quantity,sourceLocation:row.location});
 }
 return data;
}
export function returnCommercialSampleLoan(state:MistState,sample:FulfillmentSample,loan:SampleMovement,quantity:number,location:string,returnId:string,context:MistContext){
 const data=loan.commercialLoan;if(!data)return;
 if(!physicalSame(sample,data))fail('原商业借样实物组合或来源已变化，请核对原实物');
 if(location!==data.sampleLocation)fail('商业内样须归还原借出位置，再按实际办理移位');
 const previous=sum(state.fulfillment.sampleMovements.filter(m=>m.kind==='return'&&m.loanId===loan.id).map(m=>m.quantity));let left=quantity;
 if(data.kind==='warehouse'){
  const held=sum(data.holds.map(h=>{const stock=state.fulfillment.stock.find(s=>s.id===h.stockId),r=stock?.reservations?.find(r=>r.id===h.reservationId);if(!stock||!r||r.sampleLoan?.loanId!==loan.id||r.sampleLoan.sampleId!==sample.id||r.quantity!==h.quantity||stock.purchaseId!==data.purchaseId||stock.orderId!==data.sourceSnapshot.orderId||stock.lineId!==data.sourceSnapshot.lineId||stock.unit!==data.unit||r.sampleLoan.sourceLocation!==h.sourceLocation)fail('原商业借样库存占用记录需核对');return sampleLoanHoldOpen(r);}));if(held!==sum([loan.quantity,-previous]))fail('原借出与库存占用余额不一致');
  for(const h of data.holds){
   if(left<=0)break;const stock=state.fulfillment.stock.find(s=>s.id===h.stockId)!,r=stock.reservations!.find(r=>r.id===h.reservationId)!,take=Math.min(left,sampleLoanHoldOpen(r));if(take<=0)continue;
   let restore=take;
   for(const slice of r.sampleLoan!.ordinaryAllocations||[]){
    const original=stock.reservations!.find(s=>s.id===slice.reservationId&&!isSampleLoanHold(s)&&s.orderId===stock.orderId&&s.lineId===stock.lineId),allocation=original?.sampleLoanAllocations?.find(a=>a.loanId===loan.id),amount=Math.min(restore,sum([slice.quantity,-slice.returned]));
    if(!original||!allocation||amount<0||amount>sum([allocation.quantity,-allocation.returned]))fail('原订单借样预留分摊记录需核对');
    slice.returned=sum([slice.returned,amount]);allocation.returned=sum([allocation.returned,amount]);restore=sum([restore,-amount]);
   }
   addAtPosition(stock,take,h.sourceLocation);if(stock.onHand!==undefined)stock.onHand=sum([stock.onHand,take]);r.sampleLoan!.returned=sum([r.sampleLoan!.returned,take]);if(sampleLoanHoldOpen(r)===0){r.releasedAt=context.now;r.releasedBy=context.actorName;r.releaseReason='原商业内样归还';}state.fulfillment.stockMovements.push({id:context.id(),stockId:stock.id,kind:'release',quantity:take,location:h.sourceLocation,person:context.actorName,note:'按原商业借样归还释放',at:context.now,actor:context.actorName,sampleLoan:{sampleId:sample.id,loanId:loan.id,returnId}});left=sum([left,-take]);
  }if(left)fail('原商业借样占用不足，不能合成归还余额');
 }
}
/** A source obligation survives cancellation of its old planning context and never grants the borrower source access. */
export function activeCommercialSampleLoans(state:MistState){
 const rows:Array<{loan:SampleMovement;sample:FulfillmentSample;quantity:number;data:CommercialSampleLoan}>=[];
 for(const loan of state.fulfillment.sampleMovements.filter(m=>m.kind==='lend')){const quantity=sampleLoanRemaining(state,loan.id);if(quantity<=0)continue;const sample=state.fulfillment.samples.find(s=>s.id===loan.sampleId);if(!sample)continue;if(loan.commercialLoan){if(sample.sizeQuantities&&quantity!==loan.quantity)fail('原整组借还件数不完整，请核对原实物');rows.push({loan,sample,quantity,data:loan.commercialLoan});}}
 return rows;
}
export function commercialSampleHasLoan(state:MistState,sampleId:string){return state.fulfillment.sampleMovements.some(m=>m.sampleId===sampleId&&m.kind==='lend'&&!!(m.commercialLoan||m.commercialReturn)&&sampleLoanRemaining(state,m.id)>0);}
export function unresolvedCommercialLoanSource(state:MistState,stock:FulfillmentStock):string|false{
 const producer=state.productions.find(p=>p.sourcePurchaseId===stock.purchaseId&&p.orderId===stock.orderId&&p.lineId===stock.lineId);if(!producer)return false;
 for(const loan of state.fulfillment.sampleMovements.filter(m=>m.kind==='lend'&&!m.commercialLoan&&sampleLoanRemaining(state,m.id)>0)){const sample=state.fulfillment.samples.find(s=>s.id===loan.sampleId);if(sample?.role==='shipping'&&sample.source.kind==='orderLine'&&sample.source.productionId===producer.id&&sample.shippingQuantityBasis?.kind!=='independent')return '原商业借样缺少可核对的来源占用，请先核对归还';}
 return false;
}

const skuKey=(color:string,size:string)=>JSON.stringify([color.normalize('NFC').trim().toLowerCase(),size.normalize('NFC').trim().toLowerCase()]);
/** Only completed physical quantities or a complete actual packing partition establish a colour/size pool. */
function completedAssortment(state:MistState,productionId:string):PackingSku[]|undefined{
 const production=state.productions.find(p=>p.id===productionId),completion=state.fulfillment.productionFacts.find(p=>p.productionId===productionId)?.completion;
 if(!production||!completion)return;
 const spec=packingSpecification(state,production.lineId);if(!spec)return;
 if(spec.rows.length===1)return completion.sizeQuantities.map(row=>({color:spec.rows[0].color,size:row.size,quantity:row.quantity}));
 const rows=state.fulfillment.packing.filter(r=>r.productionId===productionId&&state.fulfillment.shipments.some(s=>s.id===r.shipmentId&&s.state!=='cancelled'));
 const cells=rows.flatMap(row=>row.assortment||[]);
 if(rows.some(row=>!row.assortment||sum(row.assortment.map(c=>c.quantity))!==row.quantity)||sum(rows.map(r=>r.quantity))!==completion.quantity)return;
 if(completion.sizeQuantities.some(row=>sum(cells.filter(c=>c.size===row.size).map(c=>c.quantity))!==row.quantity))return;
 return cells;
}
/** Outstanding sample custody is unavailable to any commercial consignment, even if its old plan is cancelled. */
function commercialAssortmentProblem(state:MistState,productionId:string,sample?:FulfillmentSample,shipmentId?:string):string{
 const production=state.productions.find(p=>p.id===productionId);if(!production)return '商业生产来源不可核对';
 const loans=activeCommercialSampleLoans(state).filter(row=>row.data.sourceSnapshot.productionId===productionId);
 const completion=state.fulfillment.productionFacts.find(p=>p.productionId===productionId)?.completion;if(!completion)return '商业完工数量尚未核实';
 const departed=state.fulfillment.shipments.filter(s=>s.id!==shipmentId&&shipmentHasDeparted(s));
 const shipped=sum(departed.flatMap(s=>s.lines.filter(l=>l.productionId===productionId)).map(l=>l.quantity));
 const target=shipmentId?state.fulfillment.shipments.find(s=>s.id===shipmentId):undefined;
 const requested=sample?sample.available:sum((target?.lines||[]).filter(l=>l.productionId===productionId).map(l=>l.quantity));
 if(sum([shipped,...loans.map(l=>l.quantity),requested])>completion.quantity)return '原商业实物仍在借出，剩余数量不足以办理本次交接';
 if(!packingSpecification(state,production.lineId))return '';
 const sourceStockIds=new Set(state.fulfillment.stock.filter(s=>s.purchaseId===production.sourcePurchaseId&&s.orderId===production.orderId&&s.lineId===production.lineId).map(s=>s.id));
 const pendingIssues=state.fulfillment.stockMovements.filter(m=>m.kind==='issue'&&sourceStockIds.has(m.stockId)&&m.quantity>sum(state.fulfillment.stockMovements.filter(r=>r.issueId===m.id).map(r=>r.quantity))&&!state.fulfillment.shipments.some(s=>s.id===m.shipmentLink?.shipmentId&&shipmentHasDeparted(s)));
 if(pendingIssues.some(m=>!m.shipmentLink||m.shipmentCorrectionHold))return '原商业出库的颜色尺码尚未关联核对，不能重复分配实物';
 const pool=completedAssortment(state,productionId);if(!pool)return '原商业分色分码实物来源尚未核实';
 const usage: PackingSku[]=[];
 for(const ship of departed){const lines=ship.lines.filter(l=>l.productionId===productionId);if(!lines.length)continue;const rows=state.fulfillment.packing.filter(p=>p.shipmentId===ship.id&&p.productionId===productionId);if(rows.some(r=>!r.assortment)||sum(rows.map(r=>r.quantity))!==sum(lines.map(l=>l.quantity)))return '原已出运分色分码需核对';usage.push(...rows.flatMap(r=>r.assortment||[]));}
 usage.push(...loans.flatMap(l=>(l.data.sourceSnapshot.sizeQuantities||[]).map(row=>({color:l.data.sourceSnapshot.color,size:row.size,quantity:row.quantity}))));
 // A partially issued parcel has no per-piece issue allocation: reserve its complete verified packing until it departs or is returned/unlinked.
 for(const id of new Set(pendingIssues.map(m=>m.shipmentLink!.shipmentId).filter(id=>id!==shipmentId))){const rows=state.fulfillment.packing.filter(p=>p.shipmentId===id&&p.productionId===productionId);if(rows.some(r=>!r.assortment))return '原待发出库的颜色尺码尚未核对';usage.push(...rows.flatMap(r=>r.assortment||[]));}
 if(sample)usage.push(...(sample.sizeQuantities||[]).map(row=>({color:sample.color,size:row.size,quantity:row.quantity})));
 if(target)usage.push(...state.fulfillment.packing.filter(p=>p.shipmentId===target.id&&p.productionId===productionId).flatMap(p=>p.assortment||[]));
 for(const key of new Set(usage.map(c=>skuKey(c.color,c.size))))if(sum(usage.filter(c=>skuKey(c.color,c.size)===key).map(c=>c.quantity))>sum(pool.filter(c=>skuKey(c.color,c.size)===key).map(c=>c.quantity)))return '原商业颜色尺码仍在借出，剩余实物组合不足';
 return '';
}
export function commercialSampleDepartureBlocker(state:MistState,shipmentId:string):string{
 const shipment=state.fulfillment.shipments.find(s=>s.id===shipmentId);if(!shipment)return '';
 for(const line of shipment.lines){
  const purchase=state.productions.find(p=>p.id===line.productionId)?.sourcePurchaseId;
  for(const stock of state.fulfillment.stock.filter(s=>s.purchaseId===purchase&&s.orderId===line.orderId&&s.lineId===line.lineId)){const problem=unresolvedCommercialLoanSource(state,stock);if(problem)return problem;}
  if(!activeCommercialSampleLoans(state).some(row=>row.data.sourceSnapshot.productionId===line.productionId))continue;
  const problem=commercialAssortmentProblem(state,line.productionId!,undefined,shipmentId);if(problem)return problem;
 }
 return '';
}
