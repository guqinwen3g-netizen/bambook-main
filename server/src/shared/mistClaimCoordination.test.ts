import {describe,it,expect} from 'vitest';
import {applyMistCommand,createMistState,mistCommandPermission,type MistContext,type MistCommand} from './mistWorkspace';
import {testClaimNumberConsumer,seedIssuedClaimSource} from './mistClaimTestFixtures';
import {claimLedger,currentClaimVerification,assertClaimRecoveriesSettled} from './mistClaimCoordination';

function fixture(){
 let id=0;const ctx:MistContext={id:()=>`coord-${++id}`,now:'2026-10-14T08:00:00Z',actorId:'business',actorName:'业务员顾言',consumeBusinessNumber:testClaimNumberConsumer('2026-10-14T08:00:00Z'),authority:{supplier:{},claimReviewerId:'reviewer',orderReviewerIds:{garment:['reviewer'],fabric:['reviewer']}}};let state=createMistState(ctx,'empty');
 const run=(command:MistCommand,actor=ctx)=>{const result=applyMistCommand(state,command,actor);state=result.state;return result.result as Record<string,any>;};
 const qc={...ctx,actorId:'qc',actorName:'质检许言',can:(scope:string)=>['qc:inspect','qc:garment_chain:write'].includes(scope)},leader={...ctx,actorId:'reviewer',actorName:'负责人周敏'},finance={...ctx,actorId:'finance',actorName:'财务'};
 run({type:'market.customer.create',payload:{input:{name:'实际客户',country:'FR',city:'巴黎',industry:'成衣',ownerId:'business',grade:'A',currency:'USD',terms:'OA 30天',incoterm:'FOB',categories:'成衣',creditLimit:0,since:'2026-10-13'}}});
 run({type:'files.add',payload:{file:{id:'photo',name:'客户照片.jpg',mimeType:'image/jpeg',size:10,storageKey:'fixture/photo',createdAt:ctx.now}}});
 const supplierId=run({type:'market.supplier.save',payload:{input:{code:'F1',name:'江南成衣',type:'成衣加工',country:'CN',address:'嘉兴',capabilities:'成衣',capacity:1,capacityUnit:'件',leadDays:10}}} as MistCommand).id;
 const orderId=run({type:'order.create',payload:{type:'garment',customerId:state.customers[0].id,season:'AW',currency:'USD',due:'2026-12-01',ownerId:'business',governance:{kind:'external',poNumber:'PO-1',confirmationFileIds:['photo'],internalPurpose:'',receiver:'',paymentMethod:'OA',depositPercent:null,paymentNote:'发票后30天',incoterm:'FOB',deliveryPlace:'上海'},lines:[{fulfillmentMode:'cmt',cmtIncludedItems:[],name:'外套',style:'A',img:'coat',qty:4,unit:'件',price:15}]}} as MistCommand).id;
 run({type:'order.governance.submit',payload:{orderId}} as MistCommand);run({type:'order.governance.decide',payload:{id:orderId,decision:'approved',note:'核对合同'}} as MistCommand,leader);
 const draft=run({type:'platform.invoice.save',payload:{orderId,due:'2026-12-31',amount:60,note:'原票'}}).id;const invoiceId=run({type:'platform.invoice.issue',payload:{id:draft}}).invoiceId;seedIssuedClaimSource(state,invoiceId);
 const claimId=run({type:'platform.claim.create',payload:{orderId,invoiceId,problem:'客户反映色差',fileIds:['photo']}}).id;
 return{ctx,qc,leader,finance,run,supplierId,claimId,get state(){return state;},claim(){return state.platform!.claims.find(c=>c.id===claimId)!;}};
}
const notify=(f:ReturnType<typeof fixture>)=>f.run({type:'platform.claim.notify',payload:{id:f.claimId,supplierId:f.supplierId,factoryChannel:'微信群',note:'客户要求赔 10000'}});
const allowance=(f:ReturnType<typeof fixture>,amount:number)=>{const id=f.run({type:'platform.claim.disposition',payload:{claimId:f.claimId,kind:'Allowance',amount,quantity:0,unit:'',returnDisposition:'',basis:'客户书面同意减款',fileIds:[]}}).id;f.run({type:'platform.claim.submit',payload:{id}});f.run({type:'platform.claim.decide',payload:{id,decision:'approved',note:'批准'}},f.leader);f.run({type:'platform.claim.execute',payload:{id}});return id;};

function bankReceipt(f:ReturnType<typeof fixture>,value:number,currency='USD',payer='江南成衣'){
 let account=f.state.bankAccounts?.find(row=>row.currency===currency);
 if(!account){f.run({type:'finance.account.save',payload:{name:'补偿到账户',bankName:'测试银行',accountNo:'TEST-'+currency,currency,openingDate:'2026-01-01',openingBalance:0}} as MistCommand,f.finance);account=f.state.bankAccounts!.at(-1)!;}
 f.run({type:'finance.importReceipts',payload:{accountId:account.id,receipts:[{date:'2026-10-14',payer,amount:value,currency,ref:'SUP-'+f.state.receipts.length}]}},f.finance);
 return f.state.receipts.at(-1)!.id;
}
function cashRecovery(f:ReturnType<typeof fixture>,value=100){const id=f.run({type:'platform.claim.recovery.open',payload:{claimId:f.claimId,supplierId:f.supplierId,currency:'USD',requested:value,basis:'质检与合同依据'}}).id;f.run({type:'platform.claim.recovery.agree',payload:{id,agreed:value,method:'payment',note:'工厂确认付款'}});return id;}
describe('售后索赔协同',()=>{
 it('maps permissions to the people who actually do each step',()=>{
  const p=(type:string)=>mistCommandPermission({type,payload:{}} as unknown as MistCommand);
  expect(p('platform.claim.notify')).toBe('aftersales:write');expect(p('platform.claim.verify')).toBe('qc:inspect');expect(p('platform.claim.recovery.open')).toBe('aftersales:write');
  expect(p('platform.claim.recovery.settle')).toBe('invoices:reconcile');expect(p('platform.claim.recovery.waive')).toBe('aftersales:approve');
 });
 it('records notification of internal parties and factory without sending anything externally, and creates follow-up work',()=>{
  const f=fixture(),before=structuredClone([f.claim().dispositions,f.state.platform.credits,f.state.payments,f.state.payables]);notify(f);const n=f.claim().coordination!.notices[0];
  expect(n).toMatchObject({supplierName:'江南成衣',factoryChannel:'微信群',note:'客户要求赔 10000',byId:'business'});
  const tasks=f.state.tasks.filter(t=>t.target.id===f.claimId&&!t.done).map(t=>t.kind);expect(tasks).toEqual(expect.arrayContaining(['claim-verify:'+f.claimId,'claim-factory:'+f.claimId]));
  expect(f.state.notifications[0].detail).toBe('业务员顾言 · 江南成衣');expect([f.claim().dispositions,f.state.platform.credits,f.state.payments,f.state.payables]).toEqual(before);
  expect(()=>f.run({type:'platform.claim.notify',payload:{id:f.claimId,supplierId:'nope',factoryChannel:'电话',note:''}})).toThrow('准确工厂');
 });
 it('lets QC record facts, closes the QC task and flags safety issues',()=>{
  const f=fixture();notify(f);
  f.run({type:'platform.claim.verify',payload:{id:f.claimId,result:'partial',scope:'A款 第2批',affectedQuantity:120,unit:'件',goodsLocation:'customer',mitigation:'挑选后可降级销售',factoryResponse:'工厂确认染缸批次有偏差',safety:true,fileIds:['photo']}},f.qc);
  expect(currentClaimVerification(f.claim())).toMatchObject({result:'partial',affectedQuantity:120,goodsLocation:'customer',safety:true,byId:'qc'});
  expect(f.state.tasks.filter(t=>t.target.id===f.claimId&&!t.done)).toHaveLength(0);
  expect(f.state.notifications[0].detail).toContain('停售或召回');
  expect(()=>f.run({type:'platform.claim.verify',payload:{id:f.claimId,result:'maybe' as any,scope:'x',affectedQuantity:1,unit:'件',goodsLocation:'customer',mitigation:'',factoryResponse:'',safety:false,fileIds:[]}},f.qc)).toThrow('核实结论');
 });
 it('keeps customer settlement and factory recovery as two separate ledgers and blocks closing until the factory side is settled',()=>{
  const f=fixture();notify(f);allowance(f,50);
  const rid=f.run({type:'platform.claim.recovery.open',payload:{claimId:f.claimId,supplierId:f.supplierId,currency:'usd',requested:50,basis:'染色批次偏差，工厂责任'}}).id;
  expect(()=>f.run({type:'platform.claim.recovery.open',payload:{claimId:f.claimId,supplierId:f.supplierId,currency:'USD',requested:1,basis:'重复'}})).toThrow('未落实的追偿');
  expect(()=>f.run({type:'platform.claim.recovery.settle',payload:{id:rid,amount:1,reference:'x',date:'2026-10-14'}},f.finance)).toThrow('须先记录工厂同意');
  f.run({type:'platform.claim.recovery.agree',payload:{id:rid,agreed:30,method:'payment',note:'工厂邮件确认承担 30'}});
  let ledger=claimLedger(f.state,f.claim() as any);expect(ledger).toMatchObject({currency:'USD',customer:50,recoveryAgreed:30,recoverySettled:0,companyLoss:20,customerSettled:true,recoveryOpen:true});
  f.state.platform!.credits.forEach(n=>{f.run({type:'platform.credit.refund',payload:{creditId:n.id,amount:50,date:'2026-10-14',reference:'TT-1'}},f.finance);});
  expect(()=>f.run({type:'platform.claim.close',payload:{id:f.claimId}})).toThrow('工厂补偿未落实');
  expect(()=>f.run({type:'platform.claim.recovery.settle',payload:{id:rid,amount:35,reference:'x',date:'2026-10-14'}},f.finance)).toThrow('超过工厂补偿未落实余额');
  const receiptId=bankReceipt(f,30);f.state.receipts.find(row=>row.id===receiptId)!.date='2026-12-01';expect(()=>f.run({type:'platform.claim.recovery.receipt.allocate',payload:{id:rid,receiptId,amount:30}},f.finance)).toThrow('未来');f.state.receipts.find(row=>row.id===receiptId)!.date='2026-10-14';
  f.run({type:'platform.claim.recovery.receipt.allocate',payload:{id:rid,receiptId,amount:30}},f.finance);
  ledger=claimLedger(f.state,f.claim() as any);expect(ledger).toMatchObject({recoverySettled:30,companyLoss:20,recoveryOpen:false});
  f.run({type:'platform.claim.close',payload:{id:f.claimId}});expect(f.claim().state).toBe('Closed');
  expect(f.state.tasks.filter(t=>t.target.id===f.claimId&&!t.done)).toHaveLength(0);
 });
 it('requires a different person to approve giving up recovery and does not compute loss across currencies',()=>{
  const f=fixture();allowance(f,10);const rid=f.run({type:'platform.claim.recovery.open',payload:{claimId:f.claimId,supplierId:f.supplierId,currency:'CNY',requested:500,basis:'工厂责任'}}).id;
  expect(claimLedger(f.state,f.claim() as any)).toMatchObject({sameCurrency:false,companyLoss:null});
  expect(()=>f.run({type:'platform.claim.recovery.waive',payload:{id:rid,reason:'长期合作'}})).toThrow('不能自己批准');
  f.run({type:'platform.claim.recovery.waive',payload:{id:rid,reason:'工厂已停业，追偿成本过高'}},f.leader);
  expect(f.claim().coordination!.recoveries[0]).toMatchObject({state:'Waived',waiveReason:'工厂已停业，追偿成本过高'});
 });
 it('withdraws open recoveries with the case but refuses to cancel once factory money was settled',()=>{
  const f=fixture();const rid=f.run({type:'platform.claim.recovery.open',payload:{claimId:f.claimId,supplierId:f.supplierId,currency:'USD',requested:50,basis:'先行登记'}}).id;
  f.run({type:'platform.claim.cancel',payload:{id:f.claimId,reason:'客户撤回投诉'}});expect(f.claim().coordination!.recoveries[0].state).toBe('Withdrawn');
  const g=fixture();const r2=g.run({type:'platform.claim.recovery.open',payload:{claimId:g.claimId,supplierId:g.supplierId,currency:'USD',requested:50,basis:'x'}}).id;g.run({type:'platform.claim.recovery.agree',payload:{id:r2,agreed:50,method:'payment',note:'工厂确认'}});g.run({type:'platform.claim.recovery.receipt.allocate',payload:{id:r2,receiptId:bankReceipt(g,50),amount:50}},g.finance);
  expect(()=>g.run({type:'platform.claim.cancel',payload:{id:g.claimId,reason:'撤回'}})).toThrow('已落实');expect(rid).toBeTruthy();
 });
});

 it('requires current QC authority for the source order business line and leaves denied evidence unchanged',()=>{
  for(const domain of ['garment','fabric'] as const){
   const f=fixture();f.state.orders.find(o=>o.id===f.claim().orderId)!.type=domain;
   const command={type:'platform.claim.verify',payload:{id:f.claimId,result:'confirmed',scope:'来源订单当前批次',affectedQuantity:1,unit:'件',goodsLocation:'customer',mitigation:'',factoryResponse:'',safety:false,fileIds:[]}} as MistCommand;
   const before=structuredClone(f.state),other=domain==='garment'?'fabric':'garment';
   for(const can of [undefined,()=>false,(scope:string)=>scope==='qc:inspect'||scope===`qc:${other}_chain:write`,(scope:string)=>scope===`qc:${domain}_chain:write`]){
    expect(()=>f.run(command,{...f.qc,can})).toThrow('对应业务线');expect(f.state).toEqual(before);
   }
   f.run(command,{...f.qc,can:scope=>scope==='qc:inspect'||scope===`qc:${domain}_chain:write`});
   expect(currentClaimVerification(f.claim())?.byId).toBe('qc');
  }
 });
 it('routes QC follow-up to the source line and retains claim currency when invoice access is hidden',()=>{
  const f=fixture();notify(f);expect(f.state.tasks.find(t=>t.kind==='claim-verify:'+f.claimId)?.permission).toBe('qc:garment_chain:write');
  f.state.invoices=[];expect(claimLedger(f.state,f.claim()).currency).toBe('USD');
 });

it('requires the dedicated approval scope for a claim decision',()=>{expect(mistCommandPermission({type:'platform.claim.decide',payload:{id:'pending',decision:'approved',note:'review'}})).toBe('aftersales:approve');});

describe('工厂补偿对应银行到账',()=>{
 it('rejects a text-only payment and retains partial receipts until the exact agreed amount is fulfilled',()=>{
  const f=fixture(),id=cashRecovery(f),receiptId=bankReceipt(f,100),before=JSON.stringify(f.state);
  expect(()=>f.run({type:'platform.claim.recovery.settle',payload:{id,amount:40,reference:'没有到账来源',date:'2026-10-14'}},f.finance)).toThrow('对应到账');expect(JSON.stringify(f.state)).toBe(before);
  f.run({type:'platform.claim.recovery.receipt.allocate',payload:{id,receiptId,amount:40}},f.finance);expect(f.claim().coordination!.recoveries[0]).toMatchObject({state:'Agreed',settled:40});expect(f.state.receipts.find(r=>r.id===receiptId)).toMatchObject({amount:100,remaining:60});expect(()=>assertClaimRecoveriesSettled(f.claim())).toThrow('工厂补偿未落实');
  expect(()=>f.run({type:'platform.claim.recovery.receipt.allocate',payload:{id,receiptId,amount:60.01}},f.finance)).toThrow('超过工厂补偿未落实余额');
  f.run({type:'platform.claim.recovery.receipt.allocate',payload:{id,receiptId,amount:60}},f.finance);expect(f.claim().coordination!.recoveries[0]).toMatchObject({state:'Settled',settled:100});expect(f.claim().coordination!.recoveries[0].settlements).toHaveLength(2);expect(f.state.receipts.find(r=>r.id===receiptId)).toMatchObject({amount:100,remaining:0,state:'matched'});expect(f.state.allocations).toHaveLength(0);expect(()=>assertClaimRecoveriesSettled(f.claim())).not.toThrow();
 });
 it('reverses only the correspondence, preserves bank cash and old facts, and permits a corrected allocation',()=>{
  const f=fixture(),id=cashRecovery(f),receiptId=bankReceipt(f,100);f.run({type:'platform.claim.recovery.receipt.allocate',payload:{id,receiptId,amount:100}},f.finance);const item=f.claim().coordination!.recoveries[0].settlements![0];
  expect(mistCommandPermission({type:'platform.claim.recovery.settlement.reverse',payload:{id,settlementId:item.id,reason:'错配'}})).toBe('invoices:reconcile');
  expect(()=>f.run({type:'finance.account.assign',payload:{kind:'receipt',id:receiptId,accountId:null,reason:'试图解除'}},f.finance)).toThrow('工厂补偿对应');
  f.run({type:'platform.claim.recovery.settlement.reverse',payload:{id,settlementId:item.id,reason:'对应有误'}},f.finance);expect(f.state.receipts.find(r=>r.id===receiptId)).toMatchObject({amount:100,remaining:100,state:'unmatched'});expect(f.claim().coordination!.recoveries[0]).toMatchObject({state:'Agreed'});expect(f.claim().coordination!.recoveries[0].settlements![0]).toMatchObject({id:item.id,reversed:{reason:'对应有误'}});
  expect(()=>f.run({type:'platform.claim.recovery.settlement.reverse',payload:{id,settlementId:item.id,reason:'重复冲回'}},f.finance)).toThrow('已冲回');f.run({type:'platform.claim.recovery.receipt.allocate',payload:{id,receiptId,amount:100}},f.finance);expect(f.state.receipts).toHaveLength(1);
 });
 it('rejects currency, account, payer and customer-reservation conflicts without changing either ledger',()=>{
  const f=fixture(),id=cashRecovery(f),wrong=bankReceipt(f,50,'EUR'),unassigned=bankReceipt(f,50);delete f.state.receipts.find(r=>r.id===unassigned)!.accountId;
  expect(()=>f.run({type:'platform.claim.recovery.receipt.allocate',payload:{id,receiptId:wrong,amount:1}},f.finance)).toThrow('币种不同');expect(()=>f.run({type:'platform.claim.recovery.receipt.allocate',payload:{id,receiptId:unassigned,amount:1}},f.finance)).toThrow('归属公司账户');
  const alias=bankReceipt(f,50,'USD','工厂付款代理');expect(()=>f.run({type:'platform.claim.recovery.receipt.allocate',payload:{id,receiptId:alias,amount:1}},f.finance)).toThrow('付款方关系依据');
  const reserved=bankReceipt(f,30);f.run({type:'funding.assign',payload:{receiptId:reserved,customerId:f.state.customers[0].id,orderId:f.claim().orderId,amount:30,note:'已确认客户款项用途'}},f.finance);const before=JSON.stringify(f.state);expect(()=>f.run({type:'platform.claim.recovery.receipt.allocate',payload:{id,receiptId:reserved,amount:1}},f.finance)).toThrow('归属客户款项');expect(JSON.stringify(f.state)).toBe(before);
  f.run({type:'platform.claim.recovery.receipt.allocate',payload:{id,receiptId:alias,amount:1,payerBasis:'工厂书面确认由此代理付补偿款'}},f.finance);
 });
 it('does not let already-corresponded money fund a customer, and keeps received amounts after waiver of the remainder',()=>{
  const f=fixture(),id=cashRecovery(f),receiptId=bankReceipt(f,100);f.run({type:'platform.claim.recovery.receipt.allocate',payload:{id,receiptId,amount:40}},f.finance);
  expect(()=>f.run({type:'funding.assign',payload:{receiptId,customerId:f.state.customers[0].id,orderId:null,amount:61,note:'错误重复用途'}},f.finance)).toThrow();expect(()=>f.run({type:'platform.claim.cancel',payload:{id:f.claimId,reason:'有部分收款仍撤案'}})).toThrow('已落实');
  f.run({type:'platform.claim.recovery.waive',payload:{id,reason:'经核对放弃剩余60'}},f.leader);expect(f.state.receipts.find(r=>r.id===receiptId)?.remaining).toBe(60);expect(claimLedger(f.state,f.claim() as any)).toMatchObject({recoverySettled:40,recoveryAgreed:40,recoveryOpen:false});
 });
});

it('derives the posting date and reference from the exact bank receipt and refuses reuse after full correspondence',()=>{
 const f=fixture(),id=cashRecovery(f,50),receiptId=bankReceipt(f,50);const receipt=f.state.receipts.find(r=>r.id===receiptId)!;
 f.run({type:'platform.claim.recovery.receipt.allocate',payload:{id,receiptId,amount:50,date:'2099-01-01',reference:'伪造回单号'}},f.finance);expect(f.claim().coordination!.recoveries[0].settlements![0]).toMatchObject({date:receipt.date,reference:receipt.ref,receiptId,amount:50});
 const other=f.run({type:'platform.claim.recovery.open',payload:{claimId:f.claimId,supplierId:f.supplierId,currency:'USD',requested:50,basis:'另一项责任'}}).id;f.run({type:'platform.claim.recovery.agree',payload:{id:other,agreed:50,method:'payment',note:'确认'}});const before=JSON.stringify(f.state);expect(()=>f.run({type:'platform.claim.recovery.receipt.allocate',payload:{id:other,receiptId,amount:1}},f.finance)).toThrow('可对应余额不足');expect(JSON.stringify(f.state)).toBe(before);
});
