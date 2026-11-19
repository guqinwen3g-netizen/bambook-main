import {expect,it} from 'vitest';
import {applyMistCommand,type MistCommand} from './mistWorkspace';
import {stockDepartureAtomicFixture} from '../mist/__tests__/stockDepartureAtomic';
import {commercialSampleLoanSources,commercialSampleDepartureBlocker} from './mistCommercialSampleLoan';
import {stockCustodyQuantity,stockLoanAdjustedValuationQuantity,stockSampleLoanQuantity} from './mistStockSampleLoan';
import {consumeReservations,freeQuantity,stockReservedQuantity,reservationOpen} from './mistFulfillment';
import {shippingSampleSourceSnapshot} from './mistShipmentSampleCustody';

function setup(){
 const x=stockDepartureAtomicFixture();x.f.context.can=scope=>scope==='products:write';x.f.context.members=[{id:'sales',name:'业务员',active:true,groups:['garment']},{id:'borrower',name:'借用同事',active:true,groups:[]}];return x;
}
const financial=(state:ReturnType<typeof setup>['f']['state'])=>({orders:state.orders,invoices:state.invoices,payables:state.payables,receipts:state.receipts,allocations:state.allocations,fx:state.fxRecords,costs:state.orderCosts,purchases:state.fulfillment.purchases});
const lend=(x:ReturnType<typeof setup>)=>x.f.run({type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'lend',quantity:4,person:'',borrowerId:'borrower',location:'',note:'原商业组借出'}}).id!;
const stock=(x:ReturnType<typeof setup>)=>x.f.state.fulfillment.stock.find(s=>s.id===x.stockId)!;
function unchangedReject(x:ReturnType<typeof setup>,command:MistCommand,pattern?:RegExp){const before=structuredClone(x.f.state);expect(()=>x.f.run(command)).toThrow(pattern);expect(x.f.state).toEqual(before);}
it('lends the exact included shipping group while retaining owned assets and only the remaining warehouse quantity',()=>{
 const x=setup(),before=structuredClone(x.f.state),loan=x.f.run({type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'lend',quantity:4,person:'',borrowerId:'borrower',location:'',note:'按原组借出',expectedReturn:'2026-10-14'}}),sample=x.f.state.fulfillment.samples.find(s=>s.id===x.sampleId)!,stock=x.f.state.fulfillment.stock.find(s=>s.id===x.stockId)!,hold=stock.reservations!.find(r=>(r as any).sampleLoan?.loanId===loan.id)!;
 expect(sample).toMatchObject({quantity:4,available:0,sizeQuantities:[{size:'M',quantity:1},{size:'L',quantity:3}]});expect(stock).toMatchObject({quantity:10,available:6});expect(hold).toMatchObject({quantity:4,sampleLoan:{sampleId:x.sampleId,loanId:loan.id}});expect(financial(x.f.state)).toEqual(financial(before));expect(x.f.state.fulfillment.stockMovements.filter(m=>m.kind==='issue')).toEqual(before.fulfillment.stockMovements.filter(m=>m.kind==='issue'));
});
it('returns the same whole group and releases only its original protected hold once',()=>{
 const x=setup(),loan=x.f.run({type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'lend',quantity:4,person:'',borrowerId:'borrower',location:'',note:'原组合借出'}});x.f.run({type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'return',quantity:4,person:'',loanId:loan.id!,location:'A01',note:'原组合完整归还'}});expect(x.f.state.fulfillment.samples.find(s=>s.id===x.sampleId)?.available).toBe(4);expect(x.f.state.fulfillment.stock.find(s=>s.id===x.stockId)?.available).toBe(10);const original=structuredClone(x.f.state);expect(()=>x.f.run({type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'return',quantity:4,person:'',loanId:loan.id!,location:'A01',note:'不能重复归还'}})).toThrow();expect(x.f.state).toEqual(original);
});
it('does not accept a caller-forged sampleLoan marker on an ordinary reservation',()=>{
 const x=setup(),before=structuredClone(x.f.state);expect(()=>applyMistCommand(x.f.state,{type:'fulfillment.stock.reserve',payload:{stockId:x.stockId,orderId:x.f.orderId,lineId:x.f.state.orderLines.find(l=>l.orderId===x.f.orderId)!.id,quantity:1,purpose:'sampleLoan is only text',sampleLoan:{loanId:'forged',sampleId:x.sampleId}}}as any,x.f.context)).toThrow(/借样|借出/);expect(x.f.state).toEqual(before);
});
it('excludes the offsite group from ordinary reserved/free without reducing its owned asset value twice',()=>{
 const x=setup();lend(x);expect(stockReservedQuantity(stock(x))).toBe(0);expect(freeQuantity(stock(x))).toBe(6);expect(stockSampleLoanQuantity(stock(x))).toBe(4);expect(stockCustodyQuantity(stock(x))).toBe(10);expect(stockLoanAdjustedValuationQuantity(stock(x))).toBe(10);
 const customerOwned={...stock(x),owner:'客户',ownership:'Transferred' as const};expect(stockLoanAdjustedValuationQuantity(customerOwned)).toBe(6);
});
it('does not consume or release an offsite sampleLoan through the source line or ordinary release',()=>{
 const x=setup(),loanId=lend(x),hold=stock(x).reservations![0],sameLine={orderId:stock(x).orderId,lineId:stock(x).lineId};
 consumeReservations(stock(x),6,sameLine);expect(hold.issued).toBeUndefined();expect(reservationOpen(hold)).toBe(4);
 unchangedReject(x,{type:'fulfillment.stock.release',payload:{stockId:x.stockId,reservationId:hold.id,reason:'不能消除实物借用'}} ,/原借出归还/);
 expect(x.f.state.fulfillment.sampleMovements.find(m=>m.id===loanId)?.commercialLoan).toBeDefined();
});
it('generic issues and location moves only use the physical warehouse remainder and cannot create a sample return',()=>{
 const x=setup();lend(x);unchangedReject(x,{type:'fulfillment.inventory.move',payload:{id:x.stockId,kind:'issue',quantity:7,location:'现场',person:'工厂',note:'不能发走在外四件'}},/可用量不足/);
 x.f.run({type:'fulfillment.inventory.move',payload:{id:x.stockId,kind:'move',quantity:2,location:'B01',person:'仓储',note:'仅移动仓内余量'}});
 expect(stock(x).positions).toEqual([{location:'成品仓',available:4},{location:'B01',available:2}]);expect(stockSampleLoanQuantity(stock(x))).toBe(4);
 x.f.run({type:'fulfillment.inventory.move',payload:{id:x.stockId,kind:'issue',quantity:2,sourceLocation:'B01',location:'工厂',person:'工厂',note:'仅仓内两件'}});expect(stock(x).available).toBe(4);expect(stockSampleLoanQuantity(stock(x))).toBe(4);
});
it('keeps original source warehouse and return location through a whole-remainder transfer',()=>{
 const x=setup(),loan=lend(x);x.f.state.fulfillment.warehouses.push({id:'destination',code:'DEST',name:'目标仓',address:'',active:true}as any);const oldWarehouse=stock(x).warehouseId;
 unchangedReject(x,{type:'fulfillment.stock.transfer',payload:{stockId:x.stockId,quantity:7,toWarehouseId:'destination',toLocation:'N01',carrier:'承运',note:'不能调出在外件'}},/可调拨数量不足/);
 const transfer=x.f.run({type:'fulfillment.stock.transfer',payload:{stockId:x.stockId,quantity:6,toWarehouseId:'destination',toLocation:'N01',carrier:'承运',note:'仅仓内余量'}}).id!;
 x.f.run({type:'fulfillment.stock.transfer.receive',payload:{id:transfer,note:'实际点收'}});expect(stock(x).warehouseId).toBe(oldWarehouse);
 unchangedReject(x,{type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'return',loanId:loan,quantity:4,person:'',location:'随意新仓',note:'不能变更借出来源'}},/原借出位置/);
 x.f.run({type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'return',loanId:loan,quantity:4,person:'',location:'A01',note:'原组归原位置'}});expect(stock(x).positions).toContainEqual({location:'成品仓',available:4});expect(stock(x).available).toBe(10);
});
it('counts only warehouse quantity and keeps the offsite obligation after an approved physical adjustment',()=>{
 const x=setup();lend(x);const count=x.f.run({type:'fulfillment.stock.count',payload:{lines:[{stockId:x.stockId,location:'成品仓',counted:5}],note:'仓内实盘五件'}}).id!;
 expect(x.f.state.fulfillment.stockCounts!.find(c=>c.id===count)?.lines[0]).toMatchObject({book:6,difference:-1});
 x.f.run({type:'fulfillment.stock.count.decide',payload:{id:count,decision:'approved',note:'核实仓内差异'}},{...x.f.context,actorId:'reviewer'});expect(stock(x).available).toBe(5);expect(stockSampleLoanQuantity(stock(x))).toBe(4);expect(stockCustodyQuantity(stock(x))).toBe(9);
});
it('rejects changed physical identity/basis and non-whole group loans atomically',()=>{
 const x=setup();unchangedReject(x,{type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'lend',quantity:1,person:'',borrowerId:'borrower',location:'',note:'不得拆组合'}},/整组/);lend(x);
 unchangedReject(x,{type:'fulfillment.samples.edit',payload:{id:x.sampleId,location:'A01',color:'红',note:'不得覆盖',fileIds:[]}},/未归还/);
});
it('requires an explicit distinguishable source when several legitimate positions can supply the group',()=>{
 const x=setup();stock(x).positions=[{location:'第一位',available:5},{location:'第二位',available:5}];stock(x).location='多个位置';
 expect(commercialSampleLoanSources(x.f.state,x.f.state.fulfillment.samples.find(s=>s.id===x.sampleId)!)).toMatchObject({status:'available',options:[{maxQuantity:4},{maxQuantity:4}]});
 unchangedReject(x,{type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'lend',quantity:4,person:'',borrowerId:'borrower',location:'',note:'不能猜商业来源'}},/准确库存来源/);
 x.f.run({type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'lend',quantity:4,person:'',borrowerId:'borrower',location:'',note:'明确选原位置',commercialSources:[{stockId:x.stockId,location:'第二位',quantity:4}]}});expect(stock(x).positions).toContainEqual({location:'第二位',available:1});
});
it('a genuine no-stock processing handover never fabricates warehouse goods and retains the same group return',()=>{
 const x=stockDepartureAtomicFixture(true);x.f.context.members=[{id:'borrower',name:'同事',active:true,groups:[]}];const before=structuredClone(x.f.state.fulfillment.stock),id=x.f.run({type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'lend',quantity:4,person:'',borrowerId:'borrower',location:'',note:'原工厂交接组'}}).id!;
 expect(x.f.state.fulfillment.stock).toEqual(before);expect(x.f.state.fulfillment.sampleMovements.find(m=>m.id===id)?.commercialLoan?.kind).toBe('direct');
 x.f.run({type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'return',loanId:id,quantity:4,person:'',location:'A01',note:'原组归还'}});expect(x.f.state.fulfillment.stock).toEqual(before);
});
it('protects the remaining exact colour/size against another consignment after cancellation/replanning',()=>{
 const x=setup();lend(x);const original=x.f.state.fulfillment.shipments.find(s=>s.id===x.shipmentId)!;original.state='cancelled';
 const target={...structuredClone(original),id:'new-target',state:'ready' as const,lines:original.lines.map(l=>({...l,quantity:6}))};x.f.state.fulfillment.shipments.push(target);
 const packing=structuredClone(x.f.state.fulfillment.packing.find(p=>p.shipmentId===original.id)!);packing.id='new-packing';packing.shipmentId=target.id;packing.quantity=6;packing.assortment=[{color:'蓝',size:'M',quantity:4},{color:'蓝',size:'L',quantity:2}];x.f.state.fulfillment.packing.push(packing);
 expect(commercialSampleDepartureBlocker(x.f.state,target.id)).toMatch(/颜色尺码/);packing.assortment=[{color:'蓝',size:'M',quantity:3},{color:'蓝',size:'L',quantity:3}];expect(commercialSampleDepartureBlocker(x.f.state,target.id)).toBe('');
});
it('keeps historical unmatched commercial loans blocked at source until their original physical return, without inventing stock',()=>{
 const x=setup(),loan=lend(x),borrowed=x.f.state.fulfillment.sampleMovements.find(m=>m.id===loan)!;
 // Historical sample loans predate commercial custody accounting: the warehouse was never decremented.
 delete borrowed.commercialLoan;stock(x).reservations=[];stock(x).available=10;stock(x).positions=[{location:'成品仓',available:10}];
 for(const command of [
  {type:'fulfillment.inventory.move',payload:{id:x.stockId,kind:'issue',quantity:1,location:'工厂',person:'工厂',note:'未知历史不可重复用'}},
  {type:'fulfillment.stock.reserve',payload:{stockId:x.stockId,orderId:stock(x).orderId,lineId:stock(x).lineId,quantity:1,purpose:'不能绕过原借出'}},
  {type:'fulfillment.stock.count',payload:{lines:[{stockId:x.stockId,location:'成品仓',counted:10}],note:'不能盘掉历史借用'}},
 ]as MistCommand[])unchangedReject(x,command,/原商业借样缺少/);
 x.f.run({type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'return',loanId:loan,quantity:4,person:'',location:'A01',note:'原实际四件归还'}});expect(stock(x).available).toBe(10);expect(x.f.state.fulfillment.samples.find(s=>s.id===x.sampleId)?.available).toBe(4);
});
it('does not reclassify included goods as independent while their exact commercial loan remains open',()=>{
 const x=setup();lend(x);const sample=x.f.state.fulfillment.samples.find(s=>s.id===x.sampleId)!;
 unchangedReject(x,{type:'fulfillment.samples.shippingBasis',payload:{id:sample.id,kind:'independent',sourceSnapshot:shippingSampleSourceSnapshot(x.f.state,sample),evidence:'不能转分类重造余额',independentSource:'不能把商业借出实物假改独立',fileIds:[]}},/归还/);
});
it.each(['wrong unit','other owner','claim quarantine','locked','source ID'])('never supplies a commercial loan using %s',condition=>{
 const x=setup(),s=stock(x);if(condition==='wrong unit')s.unit='份';if(condition==='other owner'){s.owner='客户';s.ownership='Transferred';}if(condition==='claim quarantine')s.sourceKind='claimReturn';if(condition==='locked')s.locked=4;if(condition==='source ID')s.orderId='other-source';
 unchangedReject(x,{type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'lend',quantity:4,person:'',borrowerId:'borrower',location:'',note:'不能用别源实物'}},/可借实物|商业库存|交接/);
});
it.each([false,true])('temporarily moves only its own normal reservation into sample custody and never revives a released reservation (%s)',release=>{
 const x=setup(),id=x.f.run({type:'fulfillment.stock.reserve',payload:{stockId:x.stockId,orderId:stock(x).orderId,lineId:stock(x).lineId,quantity:10,purpose:'本订单商业实物'}}).id!,loanId=lend(x);
 const ordinary=()=>stock(x).reservations!.find(r=>r.id===id)!;
 expect(stock(x).available).toBe(6);expect(reservationOpen(ordinary())).toBe(6);expect(stockReservedQuantity(stock(x))).toBe(6);expect(freeQuantity(stock(x))).toBe(0);expect(stockSampleLoanQuantity(stock(x))).toBe(4);
 if(release)x.f.run({type:'fulfillment.stock.release',payload:{stockId:x.stockId,reservationId:id,reason:'只释放仓内普通预留'}});
 x.f.run({type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'return',loanId:loanId,quantity:4,person:'',location:'A01',note:'同组归还原来源'}});
 expect(stock(x).available).toBe(10);expect(reservationOpen(ordinary())).toBe(release?0:10);expect(stockSampleLoanQuantity(stock(x))).toBe(0);expect(freeQuantity(stock(x))).toBe(release?10:0);
});
it('never borrows another order reservation and never consumes offsite goods through same-line reserve add-back',()=>{
 const x=setup();x.f.run({type:'fulfillment.stock.reserve',payload:{stockId:x.stockId,orderId:x.otherOrderId,lineId:x.otherLineId,quantity:8,purpose:'另一订单硬预留'}});
 unchangedReject(x,{type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'lend',quantity:4,person:'',borrowerId:'borrower',location:'',note:'不能动他单预留'}},/不足/);
});
it('does not turn an existing counted stock shortage into a larger suspended reservation than the physical group',()=>{
 const x=setup();x.f.run({type:'fulfillment.stock.reserve',payload:{stockId:x.stockId,orderId:stock(x).orderId,lineId:stock(x).lineId,quantity:10,purpose:'原单预留'}});const count=x.f.run({type:'fulfillment.stock.count',payload:{lines:[{stockId:x.stockId,location:'成品仓',counted:5}],note:'实际盘亏待核原预留'}}).id!;
 x.f.run({type:'fulfillment.stock.count.decide',payload:{id:count,decision:'approved',note:'核实仓内盘亏'}},{...x.f.context,actorId:'reviewer'});expect(freeQuantity(stock(x))).toBe(-5);
 unchangedReject(x,{type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'lend',quantity:4,person:'',borrowerId:'borrower',location:'',note:'先解决原占用差额'}},/商业库存/);
});
it('requires a new physical count if a commercial loan changed the warehouse book before count approval',()=>{
 const x=setup(),id=x.f.run({type:'fulfillment.stock.count',payload:{lines:[{stockId:x.stockId,location:'成品仓',counted:9}],note:'借出前已登记的盘点差异'}}).id!;lend(x);const before=structuredClone(x.f.state);
 expect(()=>x.f.run({type:'fulfillment.stock.count.decide',payload:{id,decision:'approved',note:'旧账面不能审批'}},{...x.f.context,actorId:'reviewer'})).toThrow(/账面已变化/);expect(x.f.state).toEqual(before);
});
it('does not reopen the receipt/completion fact to reject already completed stock while the commercial group is borrowed',()=>{
 const x=setup();lend(x);const receipt=x.f.state.fulfillment.receipts.find(r=>r.purchaseId===x.purchaseId)!;
 unchangedReject(x,{type:'fulfillment.procurement.rejectReceived',payload:{receiptId:receipt.id,quantity:1,location:'拒收区',evidence:'不能用拒收绕过完工源和借样债务'}},/完工|冻结|票据|结算/);
});
it('cannot rebuild an outstanding loan colour pool from changed planning, but can return its frozen original physical group',()=>{
 const x=setup(),loanId=lend(x),sourceLine=x.f.state.orderLines.find(l=>l.id===stock(x).lineId)!;sourceLine.breakdown!.kind==='garment'&&(sourceLine.breakdown.rows[0].color='红');x.f.state.fulfillment.shipments.find(s=>s.id===x.shipmentId)!.lines[0].quantity=6;
 expect(commercialSampleDepartureBlocker(x.f.state,x.shipmentId)).toMatch(/来源已变/);
 x.f.run({type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'return',loanId:loanId,quantity:4,person:'',location:'A01',note:'原蓝色组合按原来源归还'}});expect(stock(x).available).toBe(10);expect(stockSampleLoanQuantity(stock(x))).toBe(0);
});
