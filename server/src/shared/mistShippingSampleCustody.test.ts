import {expect,it} from 'vitest';
import {applyMistCommand,createMistState,type MistContext} from './mistWorkspace';
import {confirmShippingSampleBasis,consumeShipmentSamples,shipmentSampleCustodyBlocker,shippingSampleSourceSnapshot} from './mistShipmentSampleCustody';
import {fulfillmentCommandPermission} from './mistFulfillment';
import {scopedTargetViolation} from './mistDataScope';

function fixture() {
 let n=0;const context:MistContext={id:()=>`custody-${++n}`,now:'2026-11-19T14:00:00.000Z',actorId:'sales',actorName:'Sales',can:scope=>scope==='products:write',members:[{id:'sales',name:'Sales',active:true,groups:[]}]};
 const state=createMistState(context,'empty');
 state.orders=[{id:'o',type:'garment',ownerId:'sales',customerId:'c'}] as any;
 state.orderLines=[{id:'l',orderId:'o',qty:8,price:42,unit:'件'}] as any;
 state.productions=[{id:'p',orderId:'o',lineId:'l',pct:100}] as any;
 state.fulfillment.shipments=[{id:'ship',code:'SHP-1',state:'departed',domain:'garment',customer:'Customer',customerId:'c',departedAt:context.now,departureEvidence:'Original carrier confirmation',fileIds:[],lines:[{orderId:'o',lineId:'l',productionId:'p',quantity:8}]}] as any;
 state.fulfillment.packing=[{id:'box',shipmentId:'ship',lineId:'l',productionId:'p',carton:'A01',quantity:8,assortment:['S','M','L','XL'].map(size=>({color:'Blue',size,quantity:2}))}] as any;
 state.fulfillment.samples=[{id:'sample',code:'SMP-1',name:'Shipping sample',role:'shipping',shipmentId:'ship',source:{kind:'orderLine',orderId:'o',lineId:'l',productionId:'p'},quantity:4,available:4,unit:'件',color:'Blue',size:'S/M/L/XL',sizeQuantities:['S','M','L','XL'].map(size=>({size,quantity:1})),location:'A01',positions:[{location:'A01',available:4}],fileIds:[],note:'Inside commercial shipment',createdAt:context.now,qualityRevision:1}] as any;
 return {state,context};
}

it.each(['lend','send'] as const)('does not let an undeclared already-departed shipping specimen %s as warehouse stock',kind=>{
 const f=fixture();
 expect(()=>applyMistCommand(f.state,{type:'fulfillment.samples.move',payload:{id:'sample',kind,quantity:4,person:'Customer',borrowerId:kind==='lend'?'sales':undefined,sendPurpose:kind==='send'?'other':undefined,location:'A01',note:'Actual custody must first be confirmed'}} as any,f.context)).toThrow(/数量口径/);
});

function confirm(f:ReturnType<typeof fixture>,kind:'included'|'independent',extra:Record<string,unknown>={}){
 const sample=f.state.fulfillment.samples[0];return confirmShippingSampleBasis(f.state,{id:sample.id,kind,sourceSnapshot:shippingSampleSourceSnapshot(f.state,sample),evidence:'Physical item checked against original batch and carrier evidence',...(kind==='independent'?{independentSource:'Factory supplied an additional independent specimen; physically held at A01'}:{}),fileIds:[],...extra},f.context);
}
it('explicitly reconciles already-departed embedded specimens without issuing any commercial stock twice',()=>{
 const f=fixture(),original=structuredClone(f.state);confirm(f,'included',{reconcileDeparted:true});const sample=f.state.fulfillment.samples[0],move=f.state.fulfillment.sampleMovements[0];
 expect(sample).toMatchObject({quantity:4,available:0,shippingQuantityBasis:{kind:'included',consumption:{retrospective:true,shipmentId:'ship'}}});
 expect(move).toMatchObject({kind:'send',quantity:4,shipmentLink:{shipmentId:'ship',shipmentCode:'SHP-1',retrospective:true,departureAt:f.context.now}});
 expect(f.state.fulfillment.stock).toEqual(original.fulfillment.stock);expect(f.state.fulfillment.stockMovements).toEqual(original.fulfillment.stockMovements);expect(f.state.fulfillment.shipments).toEqual(original.fulfillment.shipments);expect(f.state.fulfillment.qcTasks).toEqual(original.fulfillment.qcTasks);
 expect(()=>confirm(f,'independent')).toThrow(/锁定/);expect(()=>confirm(f,'included',{reconcileDeparted:true})).toThrow(/锁定/);
 for(const kind of ['lend','send','return','move'])expect(()=>applyMistCommand(f.state,{type:'fulfillment.samples.move',payload:{id:'sample',kind,quantity:4,person:'Customer',location:'A01',note:'No duplicate flow'}} as any,f.context)).toThrow(/已随本批出运/);
});
it('requires an explicit retrospective instruction and the existing departure evidence',()=>{
 const f=fixture();expect(()=>confirm(f,'included')).toThrow(/显式补记/);delete f.state.fulfillment.shipments[0].departureEvidence;expect(()=>confirm(f,'included',{reconcileDeparted:true})).toThrow(/原出运依据/);
});
it('allows a factual independent declaration after departure without creating or consuming any balance',()=>{
 const f=fixture();confirm(f,'independent');expect(f.state.fulfillment.samples[0]).toMatchObject({quantity:4,available:4,shippingQuantityBasis:{kind:'independent'}});expect(f.state.fulfillment.sampleMovements).toEqual([]);
 const next=applyMistCommand(f.state,{type:'fulfillment.samples.move',payload:{id:'sample',kind:'lend',quantity:4,person:'',borrowerId:'sales',location:'A01',note:'Independent specimen loan'}} as any,f.context);expect(next.state.fulfillment.samples[0].available).toBe(0);
});
it('requires independent physical provenance rather than treating a missing legacy value as a default',()=>{
 const f=fixture();expect(()=>confirm(f,'independent',{independentSource:''})).toThrow(/独立实物来源/);expect(f.state.fulfillment.samples[0].shippingQuantityBasis).toBeUndefined();
});
it('keeps legitimate pre-departure corrections as history and consumes only the final included declaration',()=>{
 const f=fixture(),ship=f.state.fulfillment.shipments[0];ship.state='ready';delete ship.departedAt;confirm(f,'independent');const independent=structuredClone(f.state.fulfillment.samples[0].shippingQuantityBasis);confirm(f,'included');
 expect(f.state.fulfillment.samples[0].shippingQuantityBasisHistory).toEqual([independent]);expect(shipmentSampleCustodyBlocker(f.state,ship)).toBe(false);
 ship.state='departed';ship.departedAt=f.context.now;consumeShipmentSamples(f.state,ship,{...f.context,can:scope=>scope==='shipments:write'});expect(f.state.fulfillment.samples[0].available).toBe(0);expect(f.state.fulfillment.sampleMovements).toHaveLength(1);
});
it('does not consume an independently held specimen when its related commercial shipment departs',()=>{
 const f=fixture(),ship=f.state.fulfillment.shipments[0];ship.state='ready';delete ship.departedAt;confirm(f,'independent');expect(shipmentSampleCustodyBlocker(f.state,ship)).toBe(false);ship.state='departed';consumeShipmentSamples(f.state,ship,f.context);expect(f.state.fulfillment.samples[0].available).toBe(4);expect(f.state.fulfillment.sampleMovements).toEqual([]);
});
it.each(['short','loan','unit','color','size','quantity'] as const)('refuses included confirmation when %s does not match the actual physical source',problem=>{
 const f=fixture(),sample=f.state.fulfillment.samples[0];if(problem==='short'){sample.available=3;sample.positions![0].available=3;}if(problem==='loan')f.state.fulfillment.sampleMovements.push({id:'loan',sampleId:'sample',kind:'lend',quantity:4} as any);if(problem==='unit')sample.unit='份';if(problem==='color')sample.color='Red';if(problem==='size')sample.sizeQuantities![0].size='XXL';if(problem==='quantity')f.state.fulfillment.shipments[0].lines[0].quantity=3;
 expect(()=>confirm(f,'included',{reconcileDeparted:true})).toThrow();expect(sample.shippingQuantityBasis).toBeUndefined();
});
it('rechecks outstanding loans and current packing before departure without changing QC or either ledger',()=>{
 const f=fixture(),ship=f.state.fulfillment.shipments[0];ship.state='ready';delete ship.departedAt;confirm(f,'included');const original=structuredClone(f.state);f.state.fulfillment.sampleMovements.push({id:'loan',sampleId:'sample',kind:'lend',quantity:4} as any);expect(shipmentSampleCustodyBlocker(f.state,ship)).toMatch(/归还/);f.state.fulfillment.sampleMovements=[];f.state.fulfillment.packing[0].assortment![0].quantity=1;expect(shipmentSampleCustodyBlocker(f.state,ship)).toMatch(/来源已变/);expect(f.state.fulfillment.samples).toEqual(original.fulfillment.samples);
});
it('counts all included specimens against one source and does not double-allocate the same size capacity',()=>{
 const f=fixture(),ship=f.state.fulfillment.shipments[0];ship.state='ready';delete ship.departedAt;confirm(f,'included');const second=structuredClone(f.state.fulfillment.samples[0]);second.id='sample-2';delete second.shippingQuantityBasis;second.sizeQuantities=[{size:'S',quantity:4}];f.state.fulfillment.samples.push(second);expect(()=>confirmShippingSampleBasis(f.state,{id:second.id,kind:'included',sourceSnapshot:shippingSampleSourceSnapshot(f.state,second),evidence:'Separate checked specimen',fileIds:[]},f.context)).toThrow(/分码/);
});
it('binds the exact sample, production, shipment and packing snapshot rather than free-text notes',()=>{
 const f=fixture(),sample=f.state.fulfillment.samples[0],snapshot=shippingSampleSourceSnapshot(f.state,sample);sample.note='Independent sample according to an unverified note';expect(()=>confirmShippingSampleBasis(f.state,{id:sample.id,kind:'included',sourceSnapshot:{...snapshot,shipmentId:'another'},evidence:'Written record',fileIds:[],reconcileDeparted:true},f.context)).toThrow(/来源已变/);sample.source={kind:'orderLine',orderId:'o',lineId:'l',productionId:'another'};expect(()=>shippingSampleSourceSnapshot(f.state,sample)).toThrow(/准确/);
});
it('keeps quantity confirmation on existing sample authority while departure uses shipment authority',()=>{
 expect(fulfillmentCommandPermission({type:'fulfillment.samples.shippingBasis',payload:{}} as any)).toBe('products:write');expect(fulfillmentCommandPermission({type:'fulfillment.shipments.depart',payload:{}} as any)).toBe('shipments:write');
});
it('does not let a new card recreate available shipping specimens for an already departed batch',()=>{
 const f=fixture();expect(()=>applyMistCommand(f.state,{type:'fulfillment.samples.create',payload:{role:'shipping',shipmentId:'ship',source:{kind:'orderLine',orderId:'o',lineId:'l',productionId:'p'},name:'Duplicate physical group',category:'成衣',form:'船样',quantity:4,unit:'件',sizeQuantities:[{size:'M',quantity:4}],color:'Blue',location:'A01',fileIds:[],note:'Reusing a new card must not restore physical balance'}} as any,f.context)).toThrow(/不能追加船样/);
});
it('does not bind independent physical custody to later commercial packing or overstate same-colour fabric capacity',()=>{
 const f=fixture(),ship=f.state.fulfillment.shipments[0];ship.state='ready';delete ship.departedAt;confirm(f,'independent');f.state.fulfillment.packing[0].quantity=7;expect(shipmentSampleCustodyBlocker(f.state,ship)).toBe(false);
 const sample=f.state.fulfillment.samples[0];delete sample.shippingQuantityBasis;ship.domain='fabric';sample.unit='米';f.state.orderLines[0].unit='米';delete sample.sizeQuantities;sample.quantity=4;sample.available=4;sample.positions![0].available=4;f.state.fulfillment.packing[0].fabricColor='Blue';confirm(f,'included');const second=structuredClone(sample);second.id='fabric-second';delete second.shippingQuantityBasis;f.state.fulfillment.samples.push(second);expect(()=>confirmShippingSampleBasis(f.state,{id:second.id,kind:'included',sourceSnapshot:shippingSampleSourceSnapshot(f.state,second),evidence:'Must not allocate8 against7',fileIds:[]},f.context)).toThrow(/累计数量/);
});
it('checks the exact sample target against writable business scope before checking hidden source facts',()=>{
 const f=fixture(),command={type:'fulfillment.samples.shippingBasis',payload:{id:'sample'}};
 expect(scopedTargetViolation(f.state,{userIds:['sales'],teamIds:[]},command)).toBeNull();expect(scopedTargetViolation(f.state,{userIds:['stranger'],teamIds:[]},command)).toEqual({path:'fulfillment.samples',id:'sample'});
});
it('compares persisted source objects without depending on PostgreSQL JSON key order',()=>{
 const f=fixture();f.state.fulfillment.shipments[0].state='ready';delete f.state.fulfillment.shipments[0].departedAt;confirm(f,'included');const basis=f.state.fulfillment.samples[0].shippingQuantityBasis!;basis.sourceSnapshot=JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(basis.sourceSnapshot).reverse())));expect(shipmentSampleCustodyBlocker(f.state,f.state.fulfillment.shipments[0])).toBe(false);
});
it.each([{quantity:99},{reconcileDeparted:'yes'},{independentSource:'Contradictory independent origin'}])('rejects an unreviewable or contradictory quantity declaration %j',extra=>{
 const f=fixture();expect(()=>confirm(f,'included',{reconcileDeparted:true,...extra})).toThrow();expect(f.state.fulfillment.samples[0].shippingQuantityBasis).toBeUndefined();
});
it.each(['empty-unit','zero-quantity','inconsistent-position'] as const)('does not certify an invalid %s as independent physical stock',issue=>{
 const f=fixture(),sample=f.state.fulfillment.samples[0];if(issue==='empty-unit')sample.unit='';if(issue==='zero-quantity')sample.quantity=0;if(issue==='inconsistent-position')sample.positions![0].available=3;expect(()=>confirm(f,'independent')).toThrow(/数量、单位或位置/);expect(sample.shippingQuantityBasis).toBeUndefined();
});
it.each(['arrived','delivered'] as const)('keeps post-departure custody and explicit reconciliation locked through %s',state=>{
 const f=fixture();(f.state.fulfillment.shipments[0]as any).state=state;
 expect(()=>applyMistCommand(f.state,{type:'fulfillment.samples.move',payload:{id:'sample',kind:'lend',quantity:4,person:'Customer',location:'A01',note:'No revival after delivery'}}as any,f.context)).toThrow(/数量口径/);
 expect(()=>confirm(f,'included')).toThrow(/显式补记/);confirm(f,'included',{reconcileDeparted:true});expect(f.state.fulfillment.samples[0].available).toBe(0);expect(()=>confirm(f,'independent')).toThrow(/锁定/);
 const independent=fixture();(independent.state.fulfillment.shipments[0]as any).state=state;confirm(independent,'independent');expect(independent.state.fulfillment.samples[0].available).toBe(4);
});
it('uses original ATD and subsequent physical milestones rather than only a presentation state',()=>{
 const f=fixture();f.state.fulfillment.shipments[0].state='ready';f.state.fulfillment.shipments[0].arrival={at:f.context.now,evidence:'Arrived'}as any;
 expect(()=>applyMistCommand(f.state,{type:'fulfillment.samples.move',payload:{id:'sample',kind:'lend',quantity:4,person:'Customer',location:'A01',note:'Already departed'}}as any,f.context)).toThrow(/数量口径/);expect(()=>confirm(f,'included')).toThrow(/显式补记/);confirm(f,'included',{reconcileDeparted:true});expect(f.state.fulfillment.samples[0].available).toBe(0);
});
it.each(['lend','send','scrap','returnFactory','move'])('requires a declared physical basis before a new unknown shipping sample can %s',kind=>{
 const f=fixture();f.state.fulfillment.shipments[0].state='ready';delete f.state.fulfillment.shipments[0].departedAt;expect(()=>applyMistCommand(f.state,{type:'fulfillment.samples.move',payload:{id:'sample',kind,quantity:4,person:'Factory',location:'A01-QC',note:'Unknown is not independent'}}as any,f.context)).toThrow(/数量口径/);
});
it.each(['send','scrap','returnFactory'])('does not let an included specimen %s independently from commercial goods',kind=>{
 const f=fixture();const ship=f.state.fulfillment.shipments[0];ship.state='ready';delete ship.departedAt;confirm(f,'included');expect(()=>applyMistCommand(f.state,{type:'fulfillment.samples.move',payload:{id:'sample',kind,quantity:4,person:'Factory',location:'A01',note:'Must use shipment',sendPurpose:'other'}}as any,f.context)).toThrow(/不能独立寄出或处置/);
});
it('allows only onsite relocation for an included specimen and preserves both quantity ledgers',()=>{
 const f=fixture(),ship=f.state.fulfillment.shipments[0];ship.state='ready';delete ship.departedAt;confirm(f,'included');const moved=applyMistCommand(f.state,{type:'fulfillment.samples.move',payload:{id:'sample',kind:'move',quantity:0,person:'Warehouse',location:'A01-QC',note:'Onsite inspection'}}as any,f.context);expect(moved.state.fulfillment.samples[0]).toMatchObject({quantity:4,available:4,location:'A01-QC'});expect(moved.state.fulfillment.stock).toEqual(f.state.fulfillment.stock);expect(moved.state.fulfillment.stockMovements).toEqual(f.state.fulfillment.stockMovements);
});
it('allows a tracked old loan to return before an included declaration, without creating a new commercial loan',()=>{
 const f=fixture(),ship=f.state.fulfillment.shipments[0],sample=f.state.fulfillment.samples[0];ship.state='ready';delete ship.departedAt;sample.available=0;sample.positions![0].available=0;f.state.fulfillment.sampleMovements.push({id:'old-loan',sampleId:'sample',kind:'lend',quantity:4,person:'Sales',location:'A01',note:'Old tracked QA loan',at:'2026-11-18T04:00:00Z',actor:'Sales'});expect(()=>confirm(f,'included')).toThrow(/归还/);
 const returned=applyMistCommand(f.state,{type:'fulfillment.samples.move',payload:{id:'sample',kind:'return',loanId:'old-loan',quantity:4,person:'',location:'A01',note:'Actual original set returned'}}as any,f.context);f.state=returned.state;confirm(f,'included');expect(f.state.fulfillment.samples[0]).toMatchObject({available:4,shippingQuantityBasis:{kind:'included'}});
});
it('does not reclassify a declared post-departure set or backdate a loan returned after original ATD',()=>{
 const f=fixture(),ship=f.state.fulfillment.shipments[0];ship.state='ready';delete ship.departedAt;confirm(f,'included');ship.state='departed';ship.departedAt=f.context.now;expect(()=>confirm(f,'independent')).toThrow(/不能变更/);expect(()=>applyMistCommand(f.state,{type:'fulfillment.samples.move',payload:{id:'sample',kind:'lend',quantity:4,person:'Sales',location:'A01',note:'No revival'}}as any,f.context)).toThrow(/补记随货/);
 const legacy=fixture();legacy.state.fulfillment.sampleMovements.push({id:'old-loan',sampleId:'sample',kind:'lend',quantity:4,at:'2026-11-18T04:00:00Z'}as any,{id:'late-return',sampleId:'sample',kind:'return',loanId:'old-loan',quantity:4,at:'2026-11-20T04:00:00Z'}as any);expect(()=>confirm(legacy,'included',{reconcileDeparted:true})).toThrow(/原出运前存在未归还/);
});
it.each(['lend','send','scrap','returnFactory'])('retains the existing %s flow for explicitly independent physical stock',kind=>{
 const f=fixture();confirm(f,'independent');const next=applyMistCommand(f.state,{type:'fulfillment.samples.move',payload:{id:'sample',kind,quantity:4,person:'Factory',location:'A01',note:'Independent physical disposition',sendPurpose:'other'}}as any,f.context);expect(next.state.fulfillment.samples[0].available).toBe(0);expect(next.state.fulfillment.stock).toEqual(f.state.fulfillment.stock);
});
it('does not treat a normal unbound reference sample as commercial shipment stock',()=>{
 const f=fixture(),sample=f.state.fulfillment.samples[0];delete sample.role;delete sample.shipmentId;sample.source={kind:'manual',description:'Extra reference from supplier'};const next=applyMistCommand(f.state,{type:'fulfillment.samples.move',payload:{id:'sample',kind:'lend',quantity:4,person:'Sales',location:'Reference room',note:'Independent ordinary reference'}}as any,f.context);expect(next.state.fulfillment.samples[0].available).toBe(0);
});
