import type {MistState} from './mistWorkspace';
import type {FulfillmentPacking,FulfillmentShipment} from './mistFulfillment';
import {lineShipLimit,toleranceOf} from './mistOrderClosure';
import type {FabricBreakdown,GarmentBreakdown,OrderLineBreakdown} from './mistOrderBreakdown';

export type PackingSku={color:string;size:string;quantity:number};
const label=(s:string)=>s.normalize('NFC').trim().toLowerCase();
const key=(color:string,size:string)=>JSON.stringify([label(color),label(size)]);
export function packingSpecification(root:MistState,lineId:string):GarmentBreakdown|undefined{
 const line=root.orderLines.find(l=>l.id===lineId);
 const breakdown=(line as typeof line & {breakdown?:OrderLineBreakdown})?.breakdown;
 return breakdown?.kind==='garment'?breakdown:undefined;
}
export function packingFabricSpecification(root:MistState,lineId:string):FabricBreakdown|undefined{
 const line=root.orderLines.find(l=>l.id===lineId);
 const breakdown=(line as typeof line & {breakdown?:OrderLineBreakdown})?.breakdown;
 return breakdown?.kind==='fabric'?breakdown:undefined;
}
/** A package row represents one actual fabric colour; an unrecorded colour is never inferred. */
export function packingFabricColorError(root:MistState,lineId:string,color:unknown):string{
 const spec=packingFabricSpecification(root,lineId);
 if(!spec)return color===undefined||color===''?'':'当前条目没有可核对的面料颜色';
 if(typeof color!=='string'||!color.trim())return '请填写每件面料的颜色';
 return spec.rows.some(row=>label(row.color)===label(color))?'':'装箱颜色不在当前订单中';
}
function fabricColorBlocker(root:MistState,shipment:FulfillmentShipment,packing:FulfillmentPacking[]):string{
 if(shipment.packingColorVersion!==1)return '';
 for(const source of shipment.lines){
  const spec=packingFabricSpecification(root,source.lineId),line=root.orderLines.find(l=>l.id===source.lineId);if(!spec||!line)continue;
  const relevant=packing.filter(row=>row.lineId===line.id&&root.fulfillment.shipments.some(s=>s.id===row.shipmentId&&s.state!=='cancelled'));
  for(const row of relevant){const error=packingFabricColorError(root,row.lineId,row.fabricColor);if(error)return `${row.carton}：${error}`;}
  const order=root.orders.find(o=>o.id===line.orderId),contract=order?.governance?.contract;
  const tolerance=toleranceOf(contract),limit=lineShipLimit(line,contract),extra=Math.max(0,limit.approved-limit.max);
  let excess=0,first='';
  for(const row of spec.rows){
   const actual=Math.round(relevant.filter(r=>label(r.fabricColor||'')===label(row.color)).reduce((sum,r)=>sum+r.quantity,0)*10000)/10000;
   const max=Math.round(row.quantity*(1+tolerance.over/100)*10000)/10000;
   if(actual>max){excess+=actual-max;first ||= `${row.color} 累计装箱 ${actual} 超出合同上限 ${max}`;}
  }
  if(Math.round(excess*10000)>Math.round(extra*10000))return first;
 }
 return '';
}
/** Returns a validation message; never infers an assortment from the ordered ratio. */
export function packingSkuError(root:MistState,lineId:string,quantity:number,raw:unknown):string{
 const spec=packingSpecification(root,lineId);
 if(!spec)return raw===undefined||Array.isArray(raw)&&!raw.length?'':'当前条目没有可核对的成衣分色分码';
 if(!Array.isArray(raw)||!raw.length)return '请填写每箱分色分码数量';
 if(raw.length>1800)return '每箱分色分码明细过多';
 const seen=new Set<string>();let total=0;
 for(const cell of raw){
  if(!cell||typeof cell.color!=='string'||!spec.rows.some(r=>label(r.color)===label(cell.color)))return '装箱颜色不在当前订单中';
  if(typeof cell.size!=='string'||!spec.sizes.some(s=>label(s)===label(cell.size)))return '装箱尺码不在当前订单中';
  const k=key(cell.color,cell.size);if(seen.has(k))return '同一箱的颜色尺码不能重复';seen.add(k);
  if(typeof cell.quantity!=='number'||!Number.isSafeInteger(cell.quantity)||cell.quantity<0)return '分色分码数量须为非负整数';
  total+=cell.quantity;
 }
 return total===quantity?'':`分色分码合计 ${total} 与本箱数量 ${quantity} 不一致`;
}
/** Versioned detailed packing leaves old issued consignments intact until explicitly supplemented. */
export function packingBreakdownBlocker(root:MistState,shipment:FulfillmentShipment,packing=root.fulfillment.packing):string{
 const fabricError=fabricColorBlocker(root,shipment,packing);if(fabricError)return fabricError;
 if(shipment.packingDetailVersion!==2)return '';
 const rows=packing.filter(r=>r.shipmentId===shipment.id);
 for(const row of rows){const error=packingSkuError(root,row.lineId,row.quantity,row.assortment);if(error)return `${row.carton}：${error}`;}
 for(const source of shipment.lines){
  const line=root.orderLines.find(l=>l.id===source.lineId),spec=packingSpecification(root,source.lineId);
  if(!line||!spec)continue;
  const relevant=packing.filter(r=>r.lineId===line.id&&root.fulfillment.shipments.some(s=>s.id===r.shipmentId&&s.state!=='cancelled'));
  for(const row of relevant){const error=packingSkuError(root,row.lineId,row.quantity,row.assortment);if(error)return `出运 ${root.fulfillment.shipments.find(s=>s.id===row.shipmentId)?.code||''}：${row.carton} ${error}`;}
  const branchRows=relevant.filter(r=>r.productionId===source.productionId);
  const completion=root.fulfillment.productionFacts.find(f=>f.productionId===source.productionId)?.completion;
  if(completion?.sizeQuantities.length){
   for(const actual of completion.sizeQuantities){const packed=branchRows.flatMap(r=>r.assortment||[]).filter(c=>label(c.size)===label(actual.size)).reduce((n,c)=>n+c.quantity,0);if(packed>actual.quantity)return `${actual.size} 累计装箱 ${packed} 超出本分支完工 ${actual.quantity}`;}
   if(branchRows.flatMap(r=>r.assortment||[]).some(c=>!completion.sizeQuantities.some(a=>label(a.size)===label(c.size))))return '装箱尺码不在本分支完工明细中';
  }
  const order=root.orders.find(o=>o.id===line.orderId),contract=order?.governance?.contract;
  if(contract?.quantityBasis!=='size')continue;
  const tolerance=toleranceOf(contract),limit=lineShipLimit(line,contract),extra=Math.max(0,limit.approved-limit.max);
  let excess=0;let first='';
  for(const row of spec.rows)for(let i=0;i<spec.sizes.length;i++){
   const actual=relevant.flatMap(r=>r.assortment||[]).filter(c=>key(c.color,c.size)===key(row.color,spec.sizes[i])).reduce((n,c)=>n+c.quantity,0);
   const max=Math.floor(row.quantities[i]*(1+tolerance.over/100)+1e-8);
   if(actual>max){excess+=actual-max;first ||= `${row.color} · ${spec.sizes[i]} 累计装箱 ${actual} 超出合同上限 ${max}`;}
  }
  // A separately approved extra-shipment quota is shared, not multiplied per SKU.
  if(excess>extra)return first;
 }
 return '';
}
export const packingPhysicalKey=(row:Omit<FulfillmentPacking,'id'|'shipmentId'>)=>JSON.stringify([row.lineId,row.productionId||'',row.carton,row.quantity,row.netWeight,row.grossWeight,row.volume,row.note]);

export function canonicalPackingSkus(root:MistState,lineId:string,cells:PackingSku[]):PackingSku[]{
 const spec=packingSpecification(root,lineId);if(!spec)return [];
 return cells.filter(cell=>cell.quantity>0).map(cell=>({color:spec.rows.find(row=>label(row.color)===label(cell.color))!.color,size:spec.sizes.find(size=>label(size)===label(cell.size))!,quantity:cell.quantity}));
}
export function canSupplementPacking(root:MistState,shipment:FulfillmentShipment){
 const needsGarment=shipment.packingDetailVersion!==2&&shipment.lines.some(line=>!!packingSpecification(root,line.lineId));
 const needsFabric=shipment.domain==='fabric'&&shipment.packingColorVersion!==1&&shipment.lines.some(line=>!!packingFabricSpecification(root,line.lineId));
 return (needsGarment||needsFabric)&&shipment.state!=='departed'&&shipment.state!=='cancelled'
  &&root.fulfillment.documents.some(d=>d.shipmentId===shipment.id&&d.status==='issued'&&['CI','PL'].includes(d.type))
  &&!root.fulfillment.customs.some(c=>c.shipmentId===shipment.id&&c.status!=='draft');
}
