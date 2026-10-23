import {describe,expect,it} from 'vitest';
import {applyMistCommand,createMistState,type MistCommand,type MistContext} from './mistWorkspace';
function fixture(domain:'fabric'|'garment'='fabric', twoColors=false){
 let n=0;const context:MistContext={id:()=>`dual-${++n}`,now:'2026-10-13T12:00:00Z',actorName:'业务员',actorId:'sales',authority:{supplier:{},orderReviewerIds:{garment:['reviewer'],fabric:['reviewer']}}};
 for(const kind of ['purchase','processing'])context.authority!.supplier[`supplierCommitment.approvers.${kind}.${domain}`]={version:1,userIds:['reviewer']};
 let state=createMistState(context,'empty');const run=(command:MistCommand,actor=context)=>{const result=applyMistCommand(state,command,actor);state=result.state;return result.result;};
 state.customers.push({id:'customer',name:'测试客户',code:'C',country:'',city:'',industry:'',owner:'sales',grade:'',currency:'EUR',terms:'',incoterm:'',categories:'',creditLimit:0,since:''});
 for(const id of ['factory-a','factory-b'])state.market.suppliers.push({id,code:id,name:id,type:'工厂',country:'',address:'测试现场',capabilities:'加工',capacity:100,capacityUnit:domain==='fabric'?'码':'件',leadDays:5,status:'active',blockReason:'',contacts:[],fileIds:[],note:'',createdAt:context.now,updatedAt:context.now});
 state.files.push({id:'contract',name:'test.pdf',mimeType:'application/pdf',size:1,storageKey:'test/contract',createdAt:context.now});
 const orderId=run({type:'order.create',payload:{type:domain,customerId:'customer',season:'AW',currency:'EUR',due:'2026-11-01',ownerId:'sales',governance:{kind:'external',poNumber:'TEST-PO',confirmationFileIds:['contract'],internalPurpose:'',receiver:'',paymentMethod:'TT',depositPercent:0,paymentNote:'测试付款',incoterm:'FOB',deliveryPlace:'上海'},lines:[{name:'测试产品',style:'TEST',qty:domain==='fabric'?100.5:100,unit:domain==='fabric'?'码':'件',price:2,img:'clay',...(twoColors?{breakdown:{kind:'fabric' as const,composition:'羊毛',width:148,weight:300,rows:[{color:'Navy',quantity:60.5},{color:'Stone',quantity:40}]}}:{})}]}}).id!;
 run({type:'order.governance.submit',payload:{orderId}});run({type:'order.governance.decide',payload:{id:orderId,decision:'approved',note:'测试批准'}},{...context,actorId:'reviewer'});
 function pending(quantity=100.5,unit=domain==='fabric'?'码':'件',supplierId='factory-a',kind:'material'|'processing'|'finished'='processing'){
 const id=run({type:'fulfillment.procurement.save',payload:{orderId,lineId:state.orderLines[0].id,kind,supplierId,supplier:'客户端不可作真源',description:'测试供给',quantity,unit,price:1,currency:'EUR',due:'2026-10-30',terms:'测试约定',destination:'测试现场',note:'',fileIds:[]}}).id!;
 run({type:'fulfillment.procurement.submit',payload:{id}});return id;}
 const approve=(id:string)=>run({type:'fulfillment.procurement.decide',payload:{id,decision:'approved',note:'测试批准'}},{...context,actorId:'reviewer'});
 return{pending,approve,run,orderId,context,get state(){return state;}};
}
describe('fabric single-factory fulfillment versus garment capacity splits',()=>{
 it.each(['processing','finished'] as const)('creates one complete fabric %s branch in the original contractual unit',kind=>{const f=fixture(),id=f.pending(100.5,'码','factory-a',kind);f.approve(id);expect(f.state.productions).toHaveLength(1);expect(f.state.productions[0]).toMatchObject({qty:100.5,sourcePurchaseId:id});expect(f.state.productions[0].risk).toContain('先锋样');expect(f.state.orderLines[0].unit).toBe('码');});
 it.each(['factory-a','factory-b'])('rejects a second fabric branch even for %s without changing approved facts',supplier=>{const f=fixture(),first=f.pending();f.approve(first);const second=f.pending(1,'码',supplier),before=JSON.stringify(f.state);expect(()=>f.approve(second)).toThrow('仅允许一个工厂履约分支');expect(JSON.stringify(f.state)).toBe(before);expect(f.state.fulfillment.purchases.find(p=>p.id===second)?.state).toBe('pending');expect(f.state.productions).toHaveLength(1);});
 it('rejects garment-style partial assignment while preserving the pending snapshot',()=>{const f=fixture(),id=f.pending(50),before=JSON.stringify(f.state);expect(()=>f.approve(id)).toThrow('完整订单条目数量');expect(JSON.stringify(f.state)).toBe(before);});
 it('does not compare or convert unlike units by equal numerical quantity',()=>{const f=fixture(),id=f.pending(100.5,'米'),before=JSON.stringify(f.state);expect(()=>f.approve(id)).toThrow('单位须与订单条目一致');expect(JSON.stringify(f.state)).toBe(before);});
 it('keeps raw material procurement separate and permits the one processing branch',()=>{const f=fixture(),material=f.pending(20,'公斤','factory-b','material');f.approve(material);expect(f.state.productions).toHaveLength(0);f.approve(f.pending());expect(f.state.productions).toHaveLength(1);expect(f.state.fulfillment.purchases.filter(p=>p.state==='approved')).toHaveLength(2);});
 it('still permits garment capacity to be assigned to different factories',()=>{const f=fixture('garment');f.approve(f.pending(40,'件','factory-a'));f.approve(f.pending(60,'件','factory-b'));expect(f.state.productions.map(p=>p.qty)).toEqual([40,60]);expect(f.state.productions.every(p=>p.risk?.includes('产前样'))).toBe(true);});
 it('rejects a legacy fabric branch collision without fabricating an approved purchase',()=>{const f=fixture();f.state.productions.push({id:'legacy',code:'LEGACY',orderId:f.orderId,lineId:f.state.orderLines[0].id,order:'OLD',name:'历史分支',factory:'历史工厂',qty:10,due:'2026-11-01',pct:0,img:'clay',col:'finish'});const id=f.pending(),before=JSON.stringify(f.state);expect(()=>f.approve(id)).toThrow('仅允许一个');expect(JSON.stringify(f.state)).toBe(before);});
});


describe('fabric pioneer colour coverage',()=>{
 function prepare(){
  const f=fixture('fabric',true),purchaseId=f.pending();f.approve(purchaseId);
  f.run({type:'fulfillment.procurement.send',payload:{id:purchaseId,at:f.context.now,evidence:'测试发出',fileIds:[]}});
  f.run({type:'fulfillment.procurement.confirm',payload:{id:purchaseId,at:f.context.now,confirmedDue:'2026-10-30',evidence:'测试确认',fileIds:[]}});
  const productionId=f.state.productions[0].id;
  const source={kind:'orderLine' as const,orderId:f.orderId,lineId:f.state.orderLines[0].id,productionId};
  const add=(color:string,result?:'pass'|'conditional'|'reject')=>{
   const sampleId=f.run({type:'fulfillment.samples.create',payload:{name:color,category:'面料',form:'米样',quantity:1,unit:'码',size:'',color,location:'现场',source,role:'pioneer',fileIds:[],note:'测试实物'}}).id!;
   if(!result)return sampleId;
   const id=f.run({type:'fulfillment.qc.request',payload:{source,sampleId,domain:'fabric',kind:'sample',factory:'factory-a',location:'现场',contact:'',due:'2026-10-13'}}).id!;
   const qc={...f.context,actorId:'qc',actorName:'测试QC'};
   f.run({type:'fulfillment.qc.claim',payload:{id,domain:'fabric'}},qc);
   f.run({type:'fulfillment.qc.report',payload:{id,domain:'fabric',result,report:'R-'+sampleId,opinion:result==='conditional'?'布边卷曲，首批大货复核':'测试结论',measurements:[],fileIds:[],reviewedAt:f.context.now}},qc);
   if(result!=='reject'){
    f.run({type:'fulfillment.qc.confirm',payload:{id,result:'approved',note:'测试知情采用'}});
    f.run({type:'fulfillment.qc.continue',payload:{id,note:'测试业务继续'}});
   }
   return sampleId;
  };
  const release=()=>f.run({type:'fulfillment.production.release',payload:{productionId,note:'测试放行'}});
  return{f,productionId,add,release};
 }
 it('does not release all colours using only one approved pioneer sample',()=>{
  const t=prepare();t.add('Navy','pass');const before=JSON.stringify(t.f.state);
  expect(t.release).toThrow(/Stone/);expect(JSON.stringify(t.f.state)).toBe(before);
 });
 it('uses the latest physical sample of each colour instead of a superseded approval',()=>{
  const t=prepare();t.add('Navy','pass');t.add('Stone','pass');t.add('Navy');
  expect(t.release).toThrow(/Navy/);
  const newest=t.add('Navy','pass');t.release();
  expect(t.f.state.fulfillment.productionFacts[0].release?.sampleChecks?.filter(row=>row.color==='Navy').map(row=>row.sampleId)).toEqual([newest]);
 });
 it('freezes every colour and the conditional finding for the production QC handoff',()=>{
  const t=prepare();const navy=t.add('Navy','pass'),stone=t.add('Stone','conditional');t.release();
  const checks=t.f.state.fulfillment.productionFacts[0].release?.sampleChecks;
  expect(checks?.map(row=>row.sampleId)).toEqual([navy,stone]);
  expect(checks?.find(row=>row.sampleId===stone)).toMatchObject({result:'conditional',opinion:'布边卷曲，首批大货复核'});
 });
 it('records one explicit multi-colour sample once without duplicating its evidence',()=>{
  const t=prepare();const sample=t.add('navy, Stone','conditional');t.release();
  expect(t.f.state.fulfillment.productionFacts[0].release?.sampleChecks?.map(row=>row.sampleId)).toEqual([sample]);
 });
});

describe('post-receipt rejection',()=>{
 function received(){
  const f=fixture(),purchaseId=f.pending(100.5,'码','factory-a','finished');f.approve(purchaseId);
  f.run({type:'fulfillment.procurement.send',payload:{id:purchaseId,at:f.context.now,evidence:'测试发出',fileIds:[]}});
  f.run({type:'fulfillment.procurement.confirm',payload:{id:purchaseId,at:f.context.now,confirmedDue:'2026-10-30',evidence:'测试回签',fileIds:[]}});
  const receiptId=f.run({type:'fulfillment.procurement.receive',payload:{id:purchaseId,quantity:110.5,rejected:0,destination:'warehouse',location:'仓库A',date:'2026-10-13',evidence:'测试点数记录',fileIds:[]}}).id!;
  const reject=(quantity=10)=>f.run({type:'fulfillment.procurement.rejectReceived',payload:{receiptId,quantity,location:'拒收隔离区',evidence:'超量部分不予接受'}});
  return{f,purchaseId,receiptId,reject};
 }
 it('reclassifies only available, unsettled goods and preserves the original receipt facts',()=>{
  const t=received();t.reject();const receipt=t.f.state.fulfillment.receipts.find(r=>r.id===t.receiptId)!;
  expect(receipt).toMatchObject({quantity:100.5,rejected:10,evidence:'测试点数记录'});
  expect(receipt.postReceiptRejections).toEqual([expect.objectContaining({quantity:10,previousQuantity:110.5,previousRejected:0,evidence:'超量部分不予接受'})]);
  expect(t.f.state.fulfillment.stock[0]).toMatchObject({quantity:110.5,available:100.5});
  expect(t.f.state.fulfillment.stockMovements.at(-1)).toMatchObject({kind:'reject',quantity:10,location:'拒收隔离区'});
  expect(t.f.state.fulfillment.purchases[0].received).toBe(100.5);
  t.f.run({type:'fulfillment.procurement.return',payload:{receiptId:t.receiptId,quantity:10,disposition:'noReplace',date:'2026-10-13',evidence:'退回多交货物'}});
  t.f.run({type:'payable.settlement.submit',payload:{purchaseId:t.purchaseId,receiptIds:[t.receiptId],final:true,note:'按合格实收结算',fileIds:[]}} as MistCommand);
  expect(t.f.state.payables?.settlements[0]).toMatchObject({quantity:100.5,rejected:10,amount:100.5});
 });
 it('blocks changing a receipt already used in settlement',()=>{
  const t=received();t.f.state.payables!.settlements.push({id:'s',state:'pending',purchaseId:t.purchaseId,receiptIds:[t.receiptId]} as any);
  const before=JSON.stringify(t.f.state);expect(t.reject).toThrow(/结算/);expect(JSON.stringify(t.f.state)).toBe(before);
 });
 it('cannot reject goods already issued from stock',()=>{
  const t=received(),stock=t.f.state.fulfillment.stock[0];
  t.f.run({type:'fulfillment.inventory.move',payload:{id:stock.id,kind:'issue',quantity:105,location:'外部仓',person:'领用人',note:'已发出'}});
  const before=JSON.stringify(t.f.state);expect(t.reject).toThrow(/可用/);expect(JSON.stringify(t.f.state)).toBe(before);
 });
 it.each([0,-1,111])('rejects invalid quantity %s atomically',quantity=>{
  const t=received(),before=JSON.stringify(t.f.state);expect(()=>t.reject(quantity)).toThrow();expect(JSON.stringify(t.f.state)).toBe(before);
 });
 it('requires a specific stock position and preserves remaining balances',()=>{
  const t=received(),stock=t.f.state.fulfillment.stock[0];stock.positions=[{location:'A',available:5},{location:'B',available:105.5}];
  const before=JSON.stringify(t.f.state);expect(t.reject).toThrow(/位置/);expect(JSON.stringify(t.f.state)).toBe(before);
  t.f.run({type:'fulfillment.procurement.rejectReceived',payload:{receiptId:t.receiptId,quantity:10,sourceLocation:'B',location:'拒收区',evidence:'后验检查'}});
  expect(t.f.state.fulfillment.stock[0].positions).toEqual([{location:'A',available:5},{location:'B',available:95.5}]);
 });
 it('does not allow rejected goods to be returned through a normal inventory issue',()=>{
  const t=received();t.reject();const movement=t.f.state.fulfillment.stockMovements.at(-1)!;
  const before=JSON.stringify(t.f.state);
  expect(()=>t.f.run({type:'fulfillment.inventory.move',payload:{id:movement.stockId,kind:'return',issueId:movement.id,quantity:10,location:'仓库A',person:'人员',note:'尝试恢复'}})).toThrow(/原批次出库/);
  expect(JSON.stringify(t.f.state)).toBe(before);
 });
 it('blocks changes after final completion and when a supplier bill is open',()=>{
  const t=received(),fact=t.f.state.fulfillment.productionFacts[0];fact.completion={id:'done'} as any;
  expect(t.reject).toThrow(/完工/);delete fact.completion;
  t.f.state.payables!.bills.push({id:'bill',state:'open',lines:[{purchaseId:t.purchaseId}]} as any);
  expect(t.reject).toThrow(/票据/);
 });
 it('invalidates earlier production inspection without releasing a quality hold',()=>{
  const t=received(),branch=t.f.state.productions[0],revision=t.f.state.fulfillment.productionFacts[0].revision;
  t.f.state.fulfillment.qcTasks.push({id:'qc',kind:'production',source:{kind:'orderLine',orderId:t.f.orderId,lineId:branch.lineId,productionId:branch.id},state:'reported'} as any);
  t.reject();expect(t.f.state.fulfillment.productionFacts[0].revision).toBe(revision+1);expect(t.f.state.fulfillment.qcTasks[0].state).toBe('working');
  t.f.state.fulfillment.qcTasks[0].state='blocked';t.reject(1);expect(t.f.state.fulfillment.qcTasks[0].state).toBe('blocked');
 });
});
