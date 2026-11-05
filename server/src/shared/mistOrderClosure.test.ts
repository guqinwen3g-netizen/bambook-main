import {describe,it,expect} from 'vitest';
import {applyMistCommand,createMistState,type MistContext,type MistState} from './mistWorkspace';
import {createOrderGovernance,applyOrderGovernanceCommand,getOrderGovernanceReviews,type OrderGovernanceInput,type OrderGovernanceCommand} from './mistOrderGovernance';
import {lineToleranceStatus,toleranceText,TOLERANCE_NONE,assertOrderLineOpen,assertShipmentWithinTolerance,shipmentToleranceCheck,approvedOverShip,orderInvoicedByLine} from './mistOrderClosure';
import {assertOrderFundingIntegrity,orderFundingCoveredAmount} from './mistOrderFunding';
import {applyFulfillmentCommand,type FulfillmentCommand} from './mistFulfillment';
import {applyPlatformCommand} from './mistPlatform';
function fixture(){let n=0;const c:MistContext={id:()=>`gov-${++n}`,now:'2026-10-13T08:00:00Z',actorName:'业务员',actorId:'sales',authority:{supplier:{},orderReviewerIds:{garment:['leader','sales'],fabric:['fabric-leader']}}};const state=createMistState(c,'empty');state.customers.push({id:'customer',name:'客户',code:'C',country:'CN',city:'',industry:'',owner:'业务员',grade:'',currency:'USD',terms:'',incoterm:'',categories:'',creditLimit:0,since:''});state.files.push({id:'contract-file',name:'confirmed.pdf',mimeType:'application/pdf',size:10,storageKey:'workspace/contract-file',createdAt:c.now});const contract:OrderGovernanceInput={kind:'external',poNumber:'PO-001',confirmationFileIds:['contract-file'],internalPurpose:'',receiver:'',paymentMethod:'TT',depositPercent:30,preShipmentPercent:30,paymentNote:'30%定金，余款按合同',incoterm:'FOB',deliveryPlace:'上海'};const order={id:'order',code:'SO-1',type:'garment' as const,customerId:'customer',customer:'客户',season:'AW26',lines:1,qty:10,amount:100,currency:'USD',due:'2026-12-01',progress:0,state:'订单草稿',tone:'neutral' as const,owner:'业务员',img:'coat' as const,checklist:[],handoffAt:null,createdAt:c.now,updatedAt:c.now,governance:createOrderGovernance(c,contract)};state.orders.push(order);state.orderLines.push({id:'line',orderId:order.id,fulfillmentMode:'cmt',cmtIncludedItems:[],name:'外套',style:'A',img:'coat',qty:10,unit:'件',price:10,made:0,qc:0});const run=(command:OrderGovernanceCommand,actor=c)=>applyOrderGovernanceCommand(state,command,actor);return{state,c,contract,order,run};}
const leader=(f:ReturnType<typeof fixture>)=>({...f.c,actorId:'leader'});
/** ±3% 的 1000 件条目，已批准。 */
function thousand(tolerance:Partial<OrderGovernanceInput>={overPercent:3,shortPercent:3}){
 const f=fixture();f.run({type:'order.governance.saveDraft',payload:{orderId:'order',input:{...f.contract,...tolerance},lines:[{id:'line',fulfillmentMode:'cmt',cmtIncludedItems:[],name:'外套',style:'A',img:'coat',qty:1000,unit:'件',price:10}]}});
 f.run({type:'order.governance.submit',payload:{orderId:'order'}});f.run({type:'order.governance.decide',payload:{id:'order',decision:'approved',note:'通过'}},leader(f));return f;
}
function ship(f:ReturnType<typeof fixture>,quantity:number,state:'departed'|'preparing'='departed',id='sh'+(f.state.fulfillment.shipments.length+1)){
 f.state.fulfillment.shipments.push({id,code:id.toUpperCase(),customerId:'customer',customer:'客户',domain:'garment',consignee:'客户',mode:'sea',portOfLoading:'上海',portOfDischarge:'汉堡',incoterm:'FOB',plannedDate:'2026-11-25',booking:'',lines:[{lineId:'line',orderId:'order',quantity,factoryConfirmedAt:f.c.now}],note:'',fileIds:[],state,requestedBy:'单证',requesterId:'docs',createdAt:f.c.now} as never);
}
const close=(f:ReturnType<typeof fixture>,reason='客户接受实际数量',actor=f.c)=>f.run({type:'order.governance.closeLine',payload:{orderId:'order',lineId:'line',reason}} as OrderGovernanceCommand,actor);
const closure=(f:ReturnType<typeof fixture>)=>(f.state.orderLines[0] as unknown as {closure?:Record<string,unknown>}).closure;

describe('BB-ORD-5 over/short tolerance and closing a line at actual quantity',()=>{
 it('stores ±3% as contract terms, shows the allowed range and predicts the verdict before departure',()=>{
  const f=thousand();expect(f.order.governance.contract).toMatchObject({overPercent:3,shortPercent:3});expect(toleranceText(f.order.governance.contract)).toBe('溢装 +3% / 短装 −3%');
  ship(f,950,'preparing');
  expect(lineToleranceStatus(f.state,f.order,f.state.orderLines[0])).toMatchObject({min:970,max:1030,planned:950,departed:0,remaining:50,verdict:'short'});
  expect(()=>f.run({type:'order.governance.saveDraft',payload:{orderId:'order',input:{...f.contract,overPercent:12}}})).toThrow('溢装上限须为 0 至 10 之间的百分数');
 });
 it('treats a legacy order without tolerance as "未约定，按足量"',()=>{
  const f=thousand({});expect('overPercent' in f.order.governance.contract).toBe(false);expect(toleranceText(f.order.governance.contract)).toBe(TOLERANCE_NONE);
  expect(lineToleranceStatus(f.state,f.order,f.state.orderLines[0])).toMatchObject({min:1000,max:1000,agreed:false});
 });
 it('lets the salesperson close 980 of 1000 directly and marks the order 履约完成',()=>{
  const f=thousand();ship(f,980);
  expect(()=>close(f,'  ')).toThrow('结案原因未填写');
  const result=close(f);expect(result).toMatchObject({closure:'closed'});
  expect(closure(f)).toMatchObject({status:'closed',quantity:980,ordered:1000,min:970,max:1030,reason:'客户接受实际数量'});
  expect(f.state.events[0].text).toContain('请到发票/收款核对结算金额');
  expect(f.state.orderLines[0].qty).toBe(1000);expect(f.state.invoices.length).toBe(0);
  const next=applyMistCommand(f.state,{type:'order.governance.discardChange',payload:{orderId:'order'}},f.c).state;
  expect(next.orders[0].state).toBe('履约完成');
 });
 it('sends 950 of 1000 to the order reviewer; the requester cannot approve it; approval closes the line',()=>{
  const f=thousand();ship(f,950);
  expect(close(f)).toMatchObject({closure:'pending'});expect(closure(f)).toMatchObject({status:'pending',reviewerIds:['leader']});
  const review=getOrderGovernanceReviews(f.state).find(r=>r.id.startsWith('order-close:'))!;
  expect(review).toMatchObject({kind:'order',status:'pending',requesterId:'sales',reviewerIds:['leader'],entityId:'order#close:line'});
  expect(review.details).toEqual(expect.arrayContaining([{label:'允许范围',value:'970–1030 件'},{label:'实际离港（结案数量）',value:'950 件'},{label:'差异',value:'-50 件'}]));
  expect(()=>f.run({type:'order.governance.decide',payload:{id:review.entityId,decision:'approved',note:'自批'}})).toThrow('申请人不能审批自己的结案申请');
  expect(()=>close(f)).toThrow('条目已有待审批的结案申请');
  f.run({type:'order.governance.decide',payload:{id:review.entityId,decision:'approved',note:'客户书面同意短装'}},leader(f));
  expect(closure(f)).toMatchObject({status:'closed',decidedBy:'leader',note:'客户书面同意短装'});
  expect(getOrderGovernanceReviews(f.state).find(r=>r.id===review.id)!.status).toBe('approved');
  expect(f.state.tasks.filter(t=>t.kind==='order-line-close:line').every(t=>t.done)).toBe(true);
 });
 it('lets a rejected closure be re-applied and refuses to close while a shipment has not departed',()=>{
  const f=thousand();ship(f,900);close(f);
  f.run({type:'order.governance.decide',payload:{id:'order#close:line',decision:'rejected',note:'先补出 50 件'}},leader(f));expect(closure(f)).toMatchObject({status:'rejected'});
  ship(f,80,'preparing','open');
  expect(()=>close(f)).toThrow('该条目还有未离港的有效出运（OPEN），须先离港或取消后再结案');
  f.state.fulfillment.shipments.find(s=>s.id==='open')!.state='departed';expect(close(f)).toMatchObject({closure:'closed'});
 });
 it('blocks further shipments and quantity changes once the line is closed',()=>{
  const f=thousand();ship(f,1000);close(f);
  expect(()=>assertOrderLineOpen(f.state.orderLines[0])).toThrow('已结案，不能再建出运');
  expect(()=>f.run({type:'order.governance.saveDraft',payload:{orderId:'order',input:f.contract,lines:[{id:'line',fulfillmentMode:'cmt',cmtIncludedItems:[],name:'外套',style:'A',img:'coat',qty:1010,unit:'件',price:10}],reason:'追加'}})).toThrow('已结案，不能再改数量');
  f.run({type:'order.governance.saveDraft',payload:{orderId:'order',input:f.contract,orderPatch:{due:'2026-12-20'},reason:'改交期'}});expect(f.order.governance.changeDraft?.orderPatch.due).toBe('2026-12-20');
 });
 it('treats a tolerance change after approval as a contract change through the change draft',()=>{
  const f=thousand();f.run({type:'order.governance.saveDraft',payload:{orderId:'order',input:{...f.contract,overPercent:5,shortPercent:3},reason:'客户放宽溢装'}});
  expect(f.order.governance.contract.overPercent).toBe(3);expect(f.order.governance.changeDraft?.contract.overPercent).toBe(5);
  f.run({type:'order.governance.submit',payload:{orderId:'order'}});
  expect(getOrderGovernanceReviews(f.state).find(r=>r.status==='pending')!.details).toContainEqual({label:'溢短装',value:'溢装 +5% / 短装 −3%'});
  f.run({type:'order.governance.decide',payload:{id:'order',decision:'approved',note:'通过'}},leader(f));expect(f.order.governance.contract.overPercent).toBe(5);
 });
});

describe('BB-ORD-6 shipments above the over-ship cap need manager approval',()=>{
 const request=(f:ReturnType<typeof fixture>,quantity:number,actor=f.c)=>f.run({type:'order.governance.requestOverShip',payload:{orderId:'order',lineId:'line',quantity,reason:'客户要求多发补损'}} as OrderGovernanceCommand,actor);
 const cap=(f:ReturnType<typeof fixture>,cumulative:number)=>assertShipmentWithinTolerance(f.state.orderLines[0],f.order.governance.contract,cumulative);
 it('±3% of 1000: cumulative 1030 is allowed, 1050 is refused; short shipments are only a hint',()=>{
  const f=thousand();expect(cap(f,1030).verdict).toBe('within');
  expect(()=>cap(f,1050)).toThrow('超出允许溢装，须经理审批');
  expect(shipmentToleranceCheck(f.state.orderLines[0],f.order.governance.contract,900)).toMatchObject({verdict:'short',min:970});expect(cap(f,900).verdict).toBe('short');
 });
 it('approved request for 1050 lets 1050 through but 1060 is still refused',()=>{
  const f=thousand();const res=request(f,1050);expect(res.reviewId).toMatch(/^order-overship:/);
  const review=getOrderGovernanceReviews(f.state).find(r=>r.id===res.reviewId)!;expect(review).toMatchObject({kind:'order',status:'pending',reviewerIds:['leader'],requesterId:'sales'});
  expect(review.details).toEqual(expect.arrayContaining([{label:'拟出数量（累计）',value:'1050 件'},{label:'超出量',value:'20 件'},{label:'溢装上限',value:'1030 件'}]));
  expect(()=>cap(f,1050)).toThrow('超出允许溢装');
  expect(()=>f.run({type:'order.governance.decide',payload:{id:review.entityId,decision:'approved',note:'自批'}})).toThrow('申请人不能审批自己的超量出运申请');
  f.run({type:'order.governance.decide',payload:{id:review.entityId,decision:'approved',note:'同意多发'}},leader(f));
  expect(approvedOverShip(f.state.orderLines[0])).toBe(1050);expect(cap(f,1050).verdict).toBe('within');
  expect(()=>cap(f,1060)).toThrow('已批准上限 1050');
  expect(f.state.events.some(e=>e.text.includes('超量出运审批通过'))).toBe(true);expect(f.state.notifications[0].title).toContain('超量出运审批通过');
 });
 it('refuses requests that are within the cap, duplicated while pending, or have no other reviewer',()=>{
  const f=thousand();expect(()=>request(f,1020)).toThrow('无需申请');request(f,1050);expect(()=>request(f,1060)).toThrow('已有待审批');
  const g=thousand();expect(()=>request(g,1050,{...g.c,authority:{supplier:{},orderReviewerIds:{garment:['sales'],fabric:[]}}})).toThrow('尚未配置除申请人外');
 });
 it('a rejected request grants no allowance',()=>{
  const f=thousand();const res=request(f,1050),review=getOrderGovernanceReviews(f.state).find(r=>r.id===res.reviewId)!;
  f.run({type:'order.governance.decide',payload:{id:review.entityId,decision:'rejected',note:'不同意'}},leader(f));
  expect(approvedOverShip(f.state.orderLines[0])).toBe(0);expect(()=>cap(f,1050)).toThrow('溢装上限 1030');
 });
});

describe('CI invoicing follows the per-line shipment cap (tolerance or approved over-ship)',()=>{
 const request=(f:ReturnType<typeof fixture>,quantity:number)=>f.run({type:'order.governance.requestOverShip',payload:{orderId:'order',lineId:'line',quantity,reason:'客户要求多发补损'}} as OrderGovernanceCommand);
 const approveRequest=(f:ReturnType<typeof fixture>,reviewId:string)=>{const review=getOrderGovernanceReviews(f.state).find(r=>r.id===reviewId)!;f.run({type:'order.governance.decide',payload:{id:review.entityId,decision:'approved',note:'同意多发'}},leader(f));};
 const issueCi=(f:ReturnType<typeof fixture>,shipmentId:string)=>{
  const id='ci-'+shipmentId;
  f.state.fulfillment.documents.push({id,shipmentId,orderId:'order',type:'CI',number:'CI-'+shipmentId,version:1,title:'CI',dueDate:'2026-12-01',content:'已核对CI',fileIds:['contract-file'],status:'draft',createdAt:f.c.now,actor:'单证'});
  return applyFulfillmentCommand(f.state,{type:'fulfillment.documents.issue',payload:{id}} as FulfillmentCommand,f.c);
 };
 const invoiced=(f:ReturnType<typeof fixture>)=>f.state.invoices.filter(i=>!i.voidedAt).map(i=>i.amount);
 it('issues a full CI for 1030 of 1000 within the agreed +3% over-shipment',()=>{
  const f=thousand();expect(f.order.amount).toBe(10000);ship(f,1030,'preparing','a');
  issueCi(f,'a');expect(invoiced(f)).toEqual([10300]);
 });
 it('issues a full CI for an approved over-shipment of 1050',()=>{
  const f=thousand();approveRequest(f,request(f,1050).reviewId!);ship(f,1050,'preparing','a');
  issueCi(f,'a');expect(invoiced(f)).toEqual([10500]);
 });
 it('still refuses a CI above the line cap, with or without a rejected request',()=>{
  const f=thousand();ship(f,1031,'preparing','a');
  expect(()=>issueCi(f,'a')).toThrow('超过可开票上限 1030');expect(f.state.invoices).toHaveLength(0);
  const g=thousand();approveRequest(g,request(g,1050).reviewId!);ship(g,1051,'preparing','a');
  expect(()=>issueCi(g,'a')).toThrow('超过可开票上限 1050');
 });
 it('caps cumulative CIs per line across shipments',()=>{
  const f=thousand();ship(f,600,'preparing','a');ship(f,430,'preparing','b');ship(f,1,'preparing','c');
  issueCi(f,'a');issueCi(f,'b');expect(invoiced(f)).toEqual([6000,4300]);
  expect(()=>issueCi(f,'c')).toThrow('累计开票 1031');expect(invoiced(f)).toEqual([6000,4300]);
 });
 it('keeps legacy order-level invoices at the contract amount and counts them against CI room',()=>{
  const f=thousand();ship(f,970,'preparing','a');issueCi(f,'a');
  const save=(amount:number)=>applyPlatformCommand(f.state,{type:'platform.invoice.save',payload:{orderId:'order',due:'2026-12-01',amount,note:'历史草稿'}},f.c).id!;
  expect(()=>applyPlatformCommand(f.state,{type:'platform.invoice.issue',payload:{id:save(301)}},f.c)).toThrow('尚未开票金额');
  applyPlatformCommand(f.state,{type:'platform.invoice.issue',payload:{id:save(300)}},f.c);expect(invoiced(f)).toEqual([9700,300]);
  // 剩余可开：上限 1030 件 = 10300，已归属 9700 + 旧票 300 → 仅剩 300（30 件）。
  ship(f,31,'preparing','b');expect(()=>issueCi(f,'b')).toThrow('尚未开票额度');
  const g=thousand();ship(g,970,'preparing','a');issueCi(g,'a');applyPlatformCommand(g.state,{type:'platform.invoice.issue',payload:{id:applyPlatformCommand(g.state,{type:'platform.invoice.save',payload:{orderId:'order',due:'2026-12-01',amount:300,note:'历史草稿'}},g.c).id!}},g.c);
  ship(g,30,'preparing','b');issueCi(g,'b');expect(invoiced(g)).toEqual([9700,300,300]);
 });
 it('lets finance collect the full over-shipped CI, not only the contract amount',()=>{
  const f=thousand();ship(f,1030,'preparing','a');issueCi(f,'a');
  let st=f.state;const run=(cmd:Parameters<typeof applyMistCommand>[1])=>{const r=applyMistCommand(st,cmd,{...f.c,actorId:'fin'});st=r.state;return r.result;};
  run({type:'finance.receivable.confirm',payload:{invoiceId:st.invoices[0].id}});
  run({type:'finance.importReceipts',payload:{receipts:[{date:'2026-10-13',payer:'客户',amount:10400,currency:'USD',ref:'R1'}]}});
  run({type:'finance.reconcile',payload:{receiptId:st.receipts[0].id,invoiceId:st.invoices[0].id,amount:10300}});
  expect(st.invoices[0].open).toBe(0);
  // 超出有效发票的部分仍不能计入本订单。
  expect(()=>run({type:'funding.assign',payload:{receiptId:st.receipts[0].id,customerId:'customer',orderId:'order',amount:10400,note:'超额归属'}})).toThrow('超过合同金额');
 });
});

describe('order collectible cap follows finance-confirmed CIs only',()=>{
 const issueCi=(f:ReturnType<typeof fixture>,shipmentId:string)=>{
  const id='ci-'+shipmentId;
  f.state.fulfillment.documents.push({id,shipmentId,orderId:'order',type:'CI',number:'CI-'+shipmentId,version:1,title:'CI',dueDate:'2026-12-01',content:'已核对CI',fileIds:['contract-file'],status:'draft',createdAt:f.c.now,actor:'单证'});
  return applyFulfillmentCommand(f.state,{type:'fulfillment.documents.issue',payload:{id}} as FulfillmentCommand,f.c);
 };
 /** 1030 件溢装 CI（10300）待财务确认；另一张同客户订单 SO-2 用于验证不被牵连。 */
 function overShipped(){
  const f=thousand();ship(f,1030,'preparing','a');issueCi(f,'a');
  f.state.orders.push({...structuredClone(f.state.orders[0]),id:'order2',code:'SO-2'} as never);
  f.state.orderLines.push({...structuredClone(f.state.orderLines[0]),id:'line2',orderId:'order2',qty:50} as never);
  let st=f.state;const run=(cmd:Parameters<typeof applyMistCommand>[1])=>{const r=applyMistCommand(st,cmd,{...f.c,actorId:'fin'});st=r.state;return r.result;};
  run({type:'finance.importReceipts',payload:{receipts:[{date:'2026-10-13',payer:'客户',amount:11000,currency:'USD',ref:'R1'}]}});
  const receiptId=st.receipts[0].id,invoiceId=st.invoices[0].id;
  const assign=(amount:number,orderId:string|null='order')=>run({type:'funding.assign',payload:{receiptId,customerId:'customer',orderId,amount,note:'到账归属'}});
  return{f,run,assign,invoiceId,get st(){return st;}};
 }
 const voidCi=(t:ReturnType<typeof overShipped>)=>t.run({type:'fulfillment.documents.void',payload:{id:'ci-a',reason:'单证有误'}} as never);
 it('does not let a CI pending finance confirmation raise the cap above the contract amount',()=>{
  const t=overShipped();
  expect(()=>t.assign(10300)).toThrow('订单 SO-1 已归属与核销 10,300.00 USD，超过合同金额 10,000.00 USD');
  t.assign(10000);expect(orderFundingCoveredAmount(t.st,'order')).toBe(10000);
 });
 it('lets a finance-confirmed over-shipped CI be earmarked in full',()=>{
  const t=overShipped();t.run({type:'finance.receivable.confirm',payload:{invoiceId:t.invoiceId}});
  t.assign(10300);expect(orderFundingCoveredAmount(t.st,'order')).toBe(10300);
  expect(()=>t.assign(1,'order2')).not.toThrow();
 });
 it('refuses voiding the confirmed CI that carries the over-shipped earmark, naming the order and the excess',()=>{
  const t=overShipped();t.run({type:'finance.receivable.confirm',payload:{invoiceId:t.invoiceId}});
  const id=t.assign(10300).id!;const before=t.st;
  expect(()=>voidCi(t)).toThrow('订单 SO-1 已归属与核销 10,300.00 USD，作废后可收上限 10,000.00 USD，请先把超出的 300.00 USD 改登为客户余额');
  expect(t.st).toBe(before);expect(t.st.invoices[0].voidedAt).toBeUndefined();
  // 同样不能绕过 applyMistCommand 直接作废。
  expect(()=>applyFulfillmentCommand(structuredClone(t.st),{type:'fulfillment.documents.void',payload:{id:'ci-a',reason:'单证有误'}} as FulfillmentCommand,t.f.c)).toThrow('作废后可收上限');
  // 其他订单的资金操作不受影响。
  t.assign(100,'order2');
  // 先释放（或改登客户余额）后再作废可以通过。
  t.run({type:'funding.release',payload:{id,note:'溢装 CI 作废，改登客户余额'}});
  t.assign(10000);t.assign(300,null);
  voidCi(t);expect(t.st.invoices[0].voidedAt).toBeTruthy();
  expect(()=>assertOrderFundingIntegrity(t.st)).not.toThrow();
 });
 it('keeps finance rejection of a pending over-shipped CI from leaving an over-funded order',()=>{
  const t=overShipped();
  expect(()=>t.assign(10300)).toThrow('订单 SO-1');
  t.assign(10000);
  t.run({type:'finance.receivable.reject',payload:{invoiceId:t.invoiceId,reason:'数量待核'}});
  expect(t.st.invoices[0].financeStatus).toBe('rejected');
  expect(()=>assertOrderFundingIntegrity(t.st)).not.toThrow();
  t.assign(100,'order2');expect(orderFundingCoveredAmount(t.st,'order2')).toBe(100);
 });
 it('names the over-funded order when a residual bad state blocks an unrelated funding command',()=>{
  const t=overShipped();t.assign(10000);
  t.st.orderFunding!.assignments[0].amount=10300;
  expect(()=>t.assign(100,'order2')).toThrow('订单 SO-1 已归属与核销 10,300.00 USD，超过合同金额 10,000.00 USD，请先把超出的 300.00 USD 改登为客户余额');
 });
});

describe('invoicing headroom uses the actual amounts of issued invoices',()=>{
 const issueCi=(f:ReturnType<typeof fixture>,shipmentId:string)=>{
  const id='ci-'+shipmentId;
  f.state.fulfillment.documents.push({id,shipmentId,orderId:'order',type:'CI',number:'CI-'+shipmentId,version:1,title:'CI',dueDate:'2026-12-01',content:'已核对CI',fileIds:['contract-file'],status:'draft',createdAt:f.c.now,actor:'单证'});
  return applyFulfillmentCommand(f.state,{type:'fulfillment.documents.issue',payload:{id}} as FulfillmentCommand,f.c);
 };
 type Line={id:string;style:string;name:string;qty:number;price:number};
 const asLines=(lines:Line[])=>lines.map(l=>({fulfillmentMode:'cmt' as const,cmtIncludedItems:[],img:'coat' as const,unit:'件',...l}));
 const approved=(lines:Line[])=>{const f=fixture();f.run({type:'order.governance.saveDraft',payload:{orderId:'order',input:{...f.contract,overPercent:3,shortPercent:3},lines:asLines(lines)}});f.run({type:'order.governance.submit',payload:{orderId:'order'}});f.run({type:'order.governance.decide',payload:{id:'order',decision:'approved',note:'通过'}},leader(f));return f;};
 /** 已开票后经变更审批下调单价：订单变更只生成核对待办，已开 CI 金额不变。 */
 const reprice=(f:ReturnType<typeof fixture>,lines:Line[])=>{f.run({type:'order.governance.saveDraft',payload:{orderId:'order',input:{...f.contract,overPercent:3,shortPercent:3},lines:asLines(lines),reason:'客户书面降价'}});f.run({type:'order.governance.submit',payload:{orderId:'order'}});f.run({type:'order.governance.decide',payload:{id:'order',decision:'approved',note:'批准降价'}},leader(f));f.state.orders[0].amount=lines.reduce((n,l)=>n+l.qty*l.price,0);};
 const coat=(price:number):Line=>({id:'line',style:'A',name:'外套',qty:1000,price});
 const legacy=(f:ReturnType<typeof fixture>,amount:number)=>applyPlatformCommand(f.state,{type:'platform.invoice.issue',payload:{id:applyPlatformCommand(f.state,{type:'platform.invoice.save',payload:{orderId:'order',due:'2026-12-01',amount,note:'历史草稿'}},f.c).id!}},f.c);
 it('does not let a legacy invoice exceed the contract after the unit price is lowered',()=>{
  const f=thousand();ship(f,500,'preparing','a');issueCi(f,'a');expect(f.state.invoices[0].amount).toBe(5000);
  reprice(f,[coat(8)]);expect(f.state.orderLines[0].price).toBe(8);
  expect(()=>legacy(f,3000.01)).toThrow('尚未开票金额');
  legacy(f,3000);expect(f.state.invoices.map(i=>i.amount)).toEqual([5000,3000]);
 });
 it('does not overstate CI room after the unit price is lowered',()=>{
  const f=thousand();ship(f,500,'preparing','a');issueCi(f,'a');
  reprice(f,[coat(8)]);
  legacy(f,3000);
  // 条目上限 1030×8=8240，已开 5000（实际）+ 本次 CI；旧票 3000 只剩 8240−5000−CI 的余量。
  ship(f,31,'preparing','b');expect(()=>issueCi(f,'b')).toThrow('尚未开票额度');
  ship(f,30,'preparing','c');issueCi(f,'c');expect(f.state.invoices.filter(i=>!i.voidedAt).map(i=>i.amount)).toEqual([5000,3000,240]);
 });
 it('splits a multi-line invoice by issue-time price, else current price, summing exactly to the invoice amount',()=>{
  const f=approved([coat(10),{id:'line-b',style:'B',name:'裤子',qty:100,price:5}]);
  f.state.fulfillment.shipments.push({id:'m',code:'M',customerId:'customer',customer:'客户',domain:'garment',consignee:'客户',mode:'sea',portOfLoading:'上海',portOfDischarge:'汉堡',incoterm:'FOB',plannedDate:'2026-11-25',booking:'',lines:[{lineId:'line',orderId:'order',quantity:1,factoryConfirmedAt:f.c.now},{lineId:'line-b',orderId:'order',quantity:1,factoryConfirmedAt:f.c.now}],note:'',fileIds:[],state:'preparing',requestedBy:'单证',requesterId:'docs',createdAt:f.c.now} as never);
  issueCi(f,'m');const invoice=f.state.invoices[0];expect(invoice.amount).toBe(15);
  // 单价改为 1 与 2 后，按开票时单价 10:5 分摊。
  f.state.orderLines[0].price=1;f.state.orderLines[1].price=2;
  expect(orderInvoicedByLine(f.state,'order').amount).toEqual(new Map([['line',1000],['line-b',500]]));
  // 没有开票时单价的旧记录按当前单价 1:2 分摊，尾差使合计等于发票金额。
  delete (invoice as {issuedLinePrices?:unknown}).issuedLinePrices;invoice.amount=10;
  const split=orderInvoicedByLine(f.state,'order');
  expect(split.amount).toEqual(new Map([['line',333],['line-b',667]]));expect(split.qty).toEqual(new Map([['line',1],['line-b',1]]));
 });
});
