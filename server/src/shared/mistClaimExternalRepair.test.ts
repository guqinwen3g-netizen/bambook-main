import {expect,it} from 'vitest';
import {applyMistCommand,createMistState,type MistContext,type MistCommand} from './mistWorkspace';
import {createClaimReturnReceipt,assertClaimGoodsInventorySettled} from './mistClaimInventory';
import type {PlatformClaimGoodsSource} from './mistPlatform';

function fixture(quantity=2,domain:'garment'|'fabric'='garment'){
 let sequence=0;const warehouse:MistContext={id:()=>`repair-${++sequence}`,now:'2026-10-13T08:00:00Z',actorId:'warehouse',actorName:'Warehouse',can:scope=>scope==='inventory:write',consumeBusinessNumber:prefix=>prefix+'-2026-0001'};
 const qc:MistContext={...warehouse,actorId:'qc',actorName:'QC',can:scope=>['qc:inspect',`qc:${domain}_chain:write`].includes(scope)};
 let state=createMistState(warehouse,'empty');state.orders.push({id:'order',type:domain} as any);state.customers.push({id:'customer',name:'Source customer'} as any);state.market.suppliers.push({id:'factory',name:'Repair factory'} as any);state.files.push({id:'proof',name:'repair.pdf',mimeType:'application/pdf',size:1,storageKey:'fixture/proof',createdAt:warehouse.now});
 const source:PlatformClaimGoodsSource={schemaVersion:1,claimId:'case',dispositionId:'disposition',invoiceId:'invoice',documentId:'document',orderId:'order',lineId:'line',shipmentId:'shipment',productionId:'production',customerId:'customer',currency:'USD',name:'Coat',style:'A',unit:'件',quantity,unitPrice:15,sourceQuantity:4,sourceAmount:60,orderApprovedVersion:1};
 state.platform.claims.push({id:'case',code:'CLM-REPAIR',orderId:'order',invoiceId:'invoice',problem:'Repair and return',fileIds:['proof'],state:'Processing',createdAt:warehouse.now,dispositions:[{id:'disposition',kind:'Repair',amount:0,quantity,unit:'件',returnDisposition:'Repair',basis:'Approved repair and handback',fileIds:['proof'],state:'Executed',reviewDecision:'approved',requesterId:'business',reviewerId:'leader',submittedAt:warehouse.now,goodsSource:structuredClone(source),snapshot:JSON.stringify({kind:'Repair',amount:0,quantity,unit:'件',destination:'Repair',basis:'Approved repair and handback',goodsSource:source}),goodsId:'goods'}]});
 state.platform.claimGoods.push({id:'goods',claimId:'case',dispositionId:'disposition',orderId:'order',quantity,unit:'件',destination:'Repair',source:structuredClone(source),state:'AwaitingReturn',events:[]});
 const run=(command:MistCommand,actor=warehouse)=>{const result=applyMistCommand(state,command,actor);state=result.state;return result.result;};
 const warehouseId=run({type:'fulfillment.claimInventory.warehouse.save',payload:{code:'WH',name:'Company warehouse',address:'Physical site',active:true}}).id!;createClaimReturnReceipt(state,'goods',warehouseId,warehouse);
 const receive=(amount=1,batch='LOT-A',ownership:'Owned'|'Transferred'='Transferred')=>run({type:'fulfillment.claimInventory.receive',payload:{goodsId:'goods',quantity:amount,unit:'件',warehouseId,location:'Repair area',batchNumber:batch,ownership,ownershipDate:'2026-10-13',ownershipEvidence:'Customer retains ownership',receivedAt:'2026-10-13',basis:'Actual count and receipt',fileIds:['proof']}});
 const repair=(receivedEventId:string,completedAt='2026-10-13')=>run({type:'fulfillment.claimInventory.repair.record',payload:{goodsId:'goods',receivedEventId,supplierId:'factory',technician:'Technician',completedAt,basis:'On-site seam repair completed',fileIds:['proof']}});
 const check=(repairId:string,result:'pass'|'fail'='pass',actor=qc)=>run({type:'fulfillment.claimInventory.repair.qc',payload:{goodsId:'goods',repairId,result,checkedAt:'2026-10-13',basis:'Inspect repaired seam and compare source specification',fileIds:['proof']}},actor);
 const handback=(repairId:string,date='2026-10-13')=>run({type:'fulfillment.claimInventory.repair.handback',payload:{goodsId:'goods',repairId,date,recipient:'Source customer agent',reference:'HANDOVER-1',basis:'Handed to the source customer agent at warehouse',fileIds:['proof']}});
 return{run,receive,repair,check,handback,qc,warehouse,get state(){return state;},get goods(){return state.platform.claimGoods[0];}};
}


function externalFixture(){
 const f=fixture(),home=f.state.fulfillment.warehouses[0].id;Object.assign(f.state.market.suppliers[0],{type:'成衣加工',status:'active'});
 const site=f.run({type:'fulfillment.claimInventory.warehouse.save',payload:{code:'EXTERNAL',name:'Factory repair site',address:'External site',active:true,supplierId:'factory'}}).id!;
 const received=f.receive(2,'LOT-A'),stockId=received.stockId!,recordId=received.receivedEventId!;
 const dispatch=(patch:Record<string,unknown>={},actor=f.warehouse)=>f.run({type:'fulfillment.claimInventory.repair.dispatch',payload:{goodsId:'goods',receivedEventId:recordId,supplierId:'factory',warehouseId:site,location:'Repair desk',date:'2026-10-13',recipient:'Factory agent',reference:'OUT-1',basis:'Actual repair handover',fileIds:['proof'],...patch}} as MistCommand,actor);
 const back=(id:string,patch:Record<string,unknown>={},actor=f.warehouse)=>f.run({type:'fulfillment.claimInventory.repair.return',payload:{goodsId:'goods',dispatchId:id,date:'2026-10-13',recipient:'Warehouse agent',reference:'BACK-1',basis:'Actual returned count',fileIds:['proof'],...patch}} as MistCommand,actor);
 return Object.assign(f,{home,site,stockId,recordId,dispatch,back,recordRepair:()=>f.repair(recordId),stock:()=>f.state.fulfillment.stock.find(s=>s.id===stockId)!});
}
const money=(state:ReturnType<typeof externalFixture>['state'])=>structuredClone([state.payments,state.receipts,state.invoices,state.allocations,state.payables,state.fxRecords]);
it('moves the exact locked customer lot out and back, then requires repair, inspection and handback without changing money',()=>{
 const f=externalFixture(),original=structuredClone(f.state.fulfillment.receivedRecords),source=structuredClone(f.goods.source),cash=money(f.state),trip=f.dispatch().id!;
 expect(f.stock()).toMatchObject({warehouseId:f.site,location:'Repair desk',onHand:2,locked:2,available:0,ownership:'Transferred',ownerCustomerId:'customer'});
 expect(()=>f.recordRepair()).toThrow('尚未返库');expect(()=>assertClaimGoodsInventorySettled(f.state,'goods')).toThrow('尚未交还');expect(()=>f.run({type:'platform.claim.close',payload:{id:'case'}})).toThrow('尚未交还');
 expect(f.state.tasks.find(t=>t.kind==='claim-repair-return:'+trip)).toMatchObject({done:false,permission:'inventory:write',target:{view:'inventory',id:f.stockId}});
 f.back(trip);expect(f.stock()).toMatchObject({warehouseId:f.home,location:'Repair area',onHand:2,locked:2,available:0});
 const job=f.recordRepair().id!;expect(f.goods.repairs![0]).toMatchObject({externalDispatchId:trip,place:'Factory repair site · Repair desk',warehouseId:f.home});
 expect(()=>f.handback(job)).toThrow('复检合格');f.check(job);expect(()=>assertClaimGoodsInventorySettled(f.state,'goods')).toThrow('尚未交还');f.handback(job);expect(()=>assertClaimGoodsInventorySettled(f.state,'goods')).not.toThrow();
 expect(f.stock()).toMatchObject({onHand:0,locked:0,available:0,ownership:'Transferred',ownerCustomerId:'customer'});expect(f.goods.state).toBe('HandedBack');f.run({type:'platform.claim.close',payload:{id:'case'}});expect(f.state.platform.claims[0].state).toBe('Closed');
 expect(f.state.fulfillment.stockMovements.filter(m=>m.kind==='move').map(m=>[m.sourceLocation,m.location,m.quantity,m.lockedBefore,m.lockedAfter])).toEqual([['Repair area','Repair desk',2,2,2],['Repair desk','Repair area',2,2,2]]);
 expect(f.state.fulfillment.receivedRecords.map(({releasedRepairId,...r})=>r)).toEqual(original);expect(f.goods.source).toEqual(source);expect(money(f.state)).toEqual(cash);
});
it('rejects wrong destinations, dates, duplicate transfers and non-inventory actors without mutation',()=>{
 const f=externalFixture(),before=structuredClone(f.state);
 for(const patch of [{warehouseId:f.home},{supplierId:'unknown'},{warehouseId:'unknown'},{date:'2026-10-12'},{date:'2026-10-14'}]){expect(()=>f.dispatch(patch)).toThrow();expect(f.state).toEqual(before);}
 expect(()=>f.dispatch({},f.qc)).toThrow('仓储经手人');expect(f.state).toEqual(before);
 const trip=f.dispatch().id!,out=structuredClone(f.state);expect(()=>f.dispatch()).toThrow('尚未返库');expect(f.state).toEqual(out);expect(()=>f.back(trip,{},f.qc)).toThrow('仓储经手人');expect(f.state).toEqual(out);
 f.back(trip);const returned=structuredClone(f.state);expect(()=>f.back(trip)).toThrow('尚未返库');expect(f.state).toEqual(returned);
});
it('invalidates prior passed QC after a new external trip and preserves failed work across repeat repair',()=>{
 const f=externalFixture(),old=f.recordRepair().id!;f.check(old);const oldJob=structuredClone(f.goods.repairs![0]),first=f.dispatch().id!;
 expect(f.goods.state).toBe('Repairing');expect(()=>f.handback(old)).toThrow('尚未返库');f.back(first);expect(()=>f.handback(old)).toThrow('本次外修结果');expect(()=>f.dispatch()).toThrow('上次外修结果');
 const failed=f.recordRepair().id!;f.check(failed,'fail');const firstTrip=structuredClone(f.goods.repairDispatches![0]),failedJob=structuredClone(f.goods.repairs!.at(-1));
 const second=f.dispatch().id!;f.back(second);const passed=f.recordRepair().id!;f.check(passed);f.handback(passed);
 expect(f.goods.repairs![0]).toEqual(oldJob);expect(f.goods.repairs![1]).toEqual(failedJob);expect(f.goods.repairDispatches![0]).toEqual(firstTrip);expect(f.goods.state).toBe('HandedBack');
});
it('prevents changing an occupied external custodian and allows already-dispatched goods to return after cooperation pauses',()=>{
 const f=externalFixture(),trip=f.dispatch().id!,before=structuredClone(f.state);
 expect(()=>f.run({type:'fulfillment.claimInventory.warehouse.save',payload:{id:f.site,code:'EXTERNAL',name:'Factory repair site',address:'External site',active:true,supplierId:''}})).toThrow('不能变更保管单位');expect(f.state).toEqual(before);
 expect(()=>f.run({type:'fulfillment.claimInventory.warehouse.save',payload:{id:f.home,code:'WH',name:'Company warehouse',address:'Physical site',active:false}})).toThrow('待返库批次');expect(f.state).toEqual(before);
 f.state.market.suppliers[0].status='paused';f.state.market.suppliers[0].statusFrom='2026-10-13';f.back(trip);expect(f.stock().warehouseId).toBe(f.home);
});
it('detects forged movement balances and incorrect current physical warehouse',()=>{
 const f=externalFixture();f.dispatch();const movement=f.state.fulfillment.stockMovements.find(m=>m.kind==='move')!;movement.lockedAfter=0;
 expect(()=>assertClaimGoodsInventorySettled(f.state,'goods')).toThrow('返库流水');movement.lockedAfter=2;f.stock().warehouseId=f.home;expect(()=>assertClaimGoodsInventorySettled(f.state,'goods')).toThrow('退货库存');
});

it('does not silently classify an existing warehouse and keeps custody separate from customer ownership',()=>{
 const f=externalFixture(),home=()=>f.state.fulfillment.warehouses.find(w=>w.id===f.home)!;expect(home().custodian).toBeUndefined();
 f.run({type:'fulfillment.claimInventory.warehouse.save',payload:{id:f.home,code:'WH',name:'Company warehouse',address:'Physical site',active:true}});expect(home().custodian).toBeUndefined();
 f.run({type:'fulfillment.claimInventory.warehouse.save',payload:{id:f.home,code:'WH',name:'Company warehouse',address:'Physical site',active:true,custodian:'company',supplierId:''}});expect(home().custodian).toBe('company');expect(f.stock().ownership).toBe('Transferred');expect(f.stock().ownerCustomerId).toBe('customer');
 expect(f.state.fulfillment.warehouses.find(w=>w.id===f.site)?.custodian).toBe('supplier');
});
