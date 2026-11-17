import {MistCommandError,type MistContext,type MistState} from './mistWorkspace';
import type {FulfillmentSample,FulfillmentShipment} from './mistFulfillment';
import {stableJson} from './stableJson';

export type ShippingSampleSourceSnapshot={
 sampleId:string;shipmentId:string;orderId:string;lineId:string;productionId:string;
 quantity:number;unit:string;color:string;sizeQuantities:Array<{size:string;quantity:number}>;
 shipmentQuantity:number;commercialUnit:string;
 packing:Array<{id:string;carton:string;quantity:number;color:string;assortment:Array<{color:string;size:string;quantity:number}>}>;
};
export type ShippingSampleQuantityBasis={
 id:string;kind:'included'|'independent';sourceSnapshot:ShippingSampleSourceSnapshot;evidence:string;independentSource?:string;fileIds:string[];
 at:string;actor:string;actorId?:string;
 custodySnapshot:{available:number;positions:Array<{location:string;available:number}>;openLoans:Array<{id:string;remaining:number}>};
 consumption?:{movementId:string;shipmentId:string;departureAt:string;departureEvidence:string;at:string;retrospective:boolean};
};
export type ShippingSampleBasisInput={id:string;kind:'included'|'independent';sourceSnapshot:ShippingSampleSourceSnapshot;evidence:string;independentSource?:string;fileIds:string[];reconcileDeparted?:boolean};
function fail(message:string):never{throw new MistCommandError('PRECONDITION',message);}
const same=(a:unknown,b:unknown)=>stableJson(a)===stableJson(b);
function currentBasisSource(basis:ShippingSampleQuantityBasis,current:ShippingSampleSourceSnapshot){
 if(basis.kind==='included')return same(basis.sourceSnapshot,current);
 // Independent specimens do not occupy commercial packing; later packing does not change their physical identity.
 const physical=(s:ShippingSampleSourceSnapshot)=>{const {packing,shipmentQuantity,commercialUnit,...identity}=s;return identity;};
 return same(physical(basis.sourceSnapshot),physical(current));
}
const label=(s:string)=>s.normalize('NFC').trim().toLowerCase();
const units=(n:number):bigint=>{const m=String(n).match(/^(\d+)(?:\.(\d{1,4}))?$/);if(!m)fail('样品数量须为非负数且最多四位小数');return BigInt(m![1])*BigInt(10000)+BigInt((m![2]||'').padEnd(4,'0'));};
const positions=(sample:FulfillmentSample)=>sample.positions?.length?sample.positions:[{location:sample.location,available:sample.available}];
const openLoans=(state:MistState,id:string)=>state.fulfillment.sampleMovements.filter(m=>m.sampleId===id&&m.kind==='lend').map(m=>({id:m.id,remaining:m.quantity-state.fulfillment.sampleMovements.filter(r=>r.kind==='return'&&r.loanId===m.id).reduce((n,r)=>n+r.quantity,0)})).filter(m=>m.remaining>0);

/** Only structured source facts bind the quantity basis. Notes and the shipping role never classify physical goods. */
export function shippingSampleSourceSnapshot(state:MistState,sample:FulfillmentSample):ShippingSampleSourceSnapshot{
 const source=sample.source,shipment=state.fulfillment.shipments.find(s=>s.id===sample.shipmentId);
 if(sample.role!=='shipping'||source.kind!=='orderLine'||!source.productionId||!shipment||shipment.state==='cancelled')fail('本票船样来源已不可用');
 const line=state.orderLines.find(l=>l.id===source.lineId&&l.orderId===source.orderId),production=state.productions.find(p=>p.id===source.productionId&&p.orderId===source.orderId&&p.lineId===source.lineId);
 const matches=shipment.lines.filter(l=>l.orderId===source.orderId&&l.lineId===source.lineId&&l.productionId===source.productionId);
 if(!line||!production||matches.length!==1||(shipment as any).hiddenCount)fail('船样须对应本票准确订单、条目及生产来源');
 const packing=state.fulfillment.packing.filter(p=>p.shipmentId===shipment.id&&p.lineId===source.lineId&&p.productionId===source.productionId).map(p=>({id:p.id,carton:p.carton,quantity:p.quantity,color:p.fabricColor||'',assortment:(p.assortment||[]).map(x=>({...x}))})).sort((a,b)=>a.id.localeCompare(b.id));
 return {sampleId:sample.id,shipmentId:shipment.id,orderId:source.orderId,lineId:source.lineId,productionId:source.productionId,quantity:sample.quantity,unit:sample.unit,color:sample.color,sizeQuantities:(sample.sizeQuantities||[]).map(x=>({...x})),shipmentQuantity:matches[0].quantity,commercialUnit:line.unit,packing};
}
function assertIncludedQuantity(state:MistState,sample:FulfillmentSample,snapshot:ShippingSampleSourceSnapshot){
 if(!snapshot.quantity||snapshot.unit!==snapshot.commercialUnit)fail('随货样品须与本批大货使用相同单位和实际数量');
 const available=positions(sample).reduce((n,p)=>n+units(p.available),BigInt(0));
 if(units(sample.available)!==units(sample.quantity)||available!==units(sample.quantity)||openLoans(state,sample.id).length)fail('随货样品须全部在库，借出须先归还');
 const peers=state.fulfillment.samples.filter(s=>s.id!==sample.id&&s.shipmentId===snapshot.shipmentId&&s.shippingQuantityBasis?.kind==='included'&&s.source.kind==='orderLine'&&s.source.productionId===snapshot.productionId&&s.source.lineId===snapshot.lineId);
 for(const peer of peers)if(!same(peer.shippingQuantityBasis!.sourceSnapshot,shippingSampleSourceSnapshot(state,peer)))fail('同批随货样品来源已变，请先重核数量口径');
 const total=[sample,...peers].reduce((n,s)=>n+units(s.quantity),BigInt(0));
 if(total>units(snapshot.shipmentQuantity)||total>snapshot.packing.reduce((n,p)=>n+units(p.quantity),BigInt(0)))fail('随货样品累计数量超过本批装箱数量');
 const shipment=state.fulfillment.shipments.find(s=>s.id===snapshot.shipmentId)!;
 if(shipment.domain==='garment'){
  const counts=new Map<string,bigint>();
  for(const s of [sample,...peers]){
   if(!s.sizeQuantities?.length||s.sizeQuantities.reduce((n,x)=>n+x.quantity,0)!==s.quantity||s.sizeQuantities.some(x=>!x.size.trim()||!Number.isSafeInteger(x.quantity)||x.quantity<=0))fail('随货成衣须核对实际分码件数');
   for(const size of s.sizeQuantities){const key=JSON.stringify([label(s.color),label(size.size)]);counts.set(key,(counts.get(key)||BigInt(0))+units(size.quantity));}
  }
  const packed=new Map<string,bigint>();for(const p of snapshot.packing)for(const sku of p.assortment){const key=JSON.stringify([label(sku.color),label(sku.size)]);packed.set(key,(packed.get(key)||BigInt(0))+units(sku.quantity));}
  for(const [key,count]of counts)if(count>(packed.get(key)||BigInt(0)))fail('随货样品颜色或分码数量与本批装箱不符');
 }else if(snapshot.packing.some(p=>p.color)){
  const colors=new Map<string,bigint>();for(const s of [sample,...peers])colors.set(label(s.color),(colors.get(label(s.color))||BigInt(0))+units(s.quantity));
  for(const [color,count]of colors)if(count>snapshot.packing.filter(p=>label(p.color)===color).reduce((n,p)=>n+units(p.quantity),BigInt(0)))fail('随货面料颜色或数量与本批装箱不符');
 }
}
export function shippingSampleMovementBlocker(state:MistState,sample:FulfillmentSample):string|false{
 const shipment=state.fulfillment.shipments.find(s=>s.id===sample.shipmentId);
 if(sample.shippingQuantityBasis?.consumption)return '本件已随本批出运，不能再次流转';
 if(sample.role==='shipping'&&shipment?.state==='departed'&&!sample.shippingQuantityBasis)return '本批已出运，请先确认样品数量口径';
 return false;
}
function consume(state:MistState,sample:FulfillmentSample,shipment:FulfillmentShipment,context:MistContext,retrospective:boolean){
 const basis=sample.shippingQuantityBasis!;if(basis.consumption)fail('本件随货数量已结转');
 const movementId=context.id(),sourceLocation=sample.location;sample.available=0;sample.positions=positions(sample).map(p=>({...p,available:0}));
 state.fulfillment.sampleMovements.push({id:movementId,sampleId:sample.id,kind:'send',sendPurpose:'other',quantity:sample.quantity,person:shipment.customer,location:'',sourceLocation,note:basis.evidence,at:context.now,actor:context.actorName,shipmentLink:{shipmentId:shipment.id,shipmentCode:shipment.code,quantityBasisId:basis.id,departureAt:shipment.departedAt!,recordedAt:context.now,retrospective}});
 basis.consumption={movementId,shipmentId:shipment.id,departureAt:shipment.departedAt!,departureEvidence:shipment.departureEvidence||'',at:context.now,retrospective};
}
/** Normal explicit confirmation; late recording touches only the sample ledger, never replays commercial departure. */
export function confirmShippingSampleBasis(state:MistState,input:ShippingSampleBasisInput,context:MistContext){
 if(Object.keys(input).some(key=>!['id','kind','sourceSnapshot','evidence','independentSource','fileIds','reconcileDeparted'].includes(key)))fail('数量口径内容无法完整核对');
 if(input.reconcileDeparted!==undefined&&typeof input.reconcileDeparted!=='boolean')fail('补记方式无效');
 if(input.kind==='included'&&input.independentSource)fail('随货口径不能同时声明独立实物来源');
 const sample=state.fulfillment.samples.find(s=>s.id===input.id);if(!sample)fail('船样不存在');
 if(sample.shippingQuantityBasis?.consumption)fail('已结转的随货数量口径已锁定');
 if(!['included','independent'].includes(input.kind))fail('请选择样品数量口径');
 if(typeof input.evidence!=='string'||!input.evidence.trim()||input.evidence.length>4000)fail('请填写数量口径确认依据');
 if(input.kind==='independent'&&(typeof input.independentSource!=='string'||!input.independentSource.trim()||input.independentSource.length>2000))fail('请填写独立实物来源与当前保管依据');
 const snapshot=shippingSampleSourceSnapshot(state,sample);if(!same(snapshot,input.sourceSnapshot))fail('样品或装箱来源已变，请重新打开核对');
 const shipment=state.fulfillment.shipments.find(s=>s.id===snapshot.shipmentId)!;
 if(shipment.state==='departed'&&input.kind==='included'&&(!input.reconcileDeparted||!shipment.departedAt||!shipment.departureEvidence))fail('已出运随货样品须按原出运依据显式补记');
 if(input.kind==='included')assertIncludedQuantity(state,sample,snapshot);
 if(sample.shippingQuantityBasis)(sample.shippingQuantityBasisHistory??=[]).push(structuredClone(sample.shippingQuantityBasis));
 const basis:ShippingSampleQuantityBasis={id:context.id(),kind:input.kind,sourceSnapshot:snapshot,evidence:input.evidence.trim(),...(input.kind==='independent'?{independentSource:input.independentSource!.trim()}:{}),fileIds:input.fileIds,at:context.now,actor:context.actorName,...(context.actorId?{actorId:context.actorId}:{}),custodySnapshot:{available:sample.available,positions:positions(sample).map(p=>({...p})),openLoans:openLoans(state,sample.id)}};
 sample.shippingQuantityBasis=basis;
 if(shipment.state==='departed'&&input.kind==='included')consume(state,sample,shipment,context,true);
 return {id:sample.id,quantityBasisId:basis.id,...(basis.consumption?{movementId:basis.consumption.movementId}: {})};
}
export function shipmentSampleCustodyBlocker(state:MistState,shipment:FulfillmentShipment):string|false{
 try{for(const sample of state.fulfillment.samples.filter(s=>s.role==='shipping'&&s.shipmentId===shipment.id)){
  const basis=sample.shippingQuantityBasis;if(!basis)fail(`${sample.code}：请确认样品数量口径`);
  if(!currentBasisSource(basis,shippingSampleSourceSnapshot(state,sample)))fail(`${sample.code}：样品或装箱来源已变，请重核数量口径`);
  if(basis.kind==='included'){if(basis.consumption)fail('随货样品已结转');assertIncludedQuantity(state,sample,basis.sourceSnapshot);}
 }return false;}catch(e){if(e instanceof MistCommandError)return e.message;throw e;}
}
export function consumeShipmentSamples(state:MistState,shipment:FulfillmentShipment,context:MistContext){
 for(const sample of state.fulfillment.samples.filter(s=>s.role==='shipping'&&s.shipmentId===shipment.id&&s.shippingQuantityBasis?.kind==='included'))consume(state,sample,shipment,context,false);
}
