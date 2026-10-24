import {assertOrderShipmentPaymentCovered,orderShipmentPaymentCoverage} from './mistOrderFunding';
import {describe,it,expect} from 'vitest';
import {createMistState,applyMistCommand,type MistContext} from './mistWorkspace';
import {applyOrderFundingCommand,assertOrderDepositCovered,assertOrderFundingIntegrity,orderDepositCoverage,orderFundingCoveredAmount,orderFundingCommandPermission,orderFundingReconciliationLimit} from './mistOrderFunding';
function setup(){let n=0;const context:MistContext={id:()=>`fund-${++n}`,now:'2026-10-13T00:00:00Z',actorName:'财务',actorId:'finance'};const state=createMistState(context,'empty');state.customers=[{id:'c',name:'客户',code:'C',country:'',city:'',industry:'',owner:'',grade:'',currency:'USD',terms:'',incoterm:'',categories:'',creditLimit:0,since:''}];state.orders=[{id:'o',code:'O',customerId:'c',currency:'USD',amount:100,governance:{contract:{paymentMethod:'TT',depositPercent:30}}},{id:'other',code:'OTHER',customerId:'c',currency:'USD',amount:100,governance:{contract:{paymentMethod:'TT',depositPercent:30}}}] as any;state.receipts=[{id:'r',code:'R',payer:'客户',currency:'USD',amount:50,remaining:50,state:'unmatched',date:'2026-10-13',ref:'r'},{id:'r2',code:'R2',payer:'客户',currency:'USD',amount:20,remaining:20,state:'unmatched',date:'2026-10-13',ref:'r2'}];const assign=(amount:number,receiptId='r',orderId:string|null='o')=>applyOrderFundingCommand(state,{type:'funding.assign',payload:{receiptId,customerId:'c',orderId,amount,note:'实际到账归属依据'}},context);return{state,context,assign};}
describe('order deposit funding',()=>{
 it('accepts multiple advance receipts without any CI and does not reconcile or consume either balance',()=>{const f=setup();f.assign(20);f.assign(10,'r2');expect(assertOrderDepositCovered(f.state,'o')).toMatchObject({required:30,received:30,status:'covered'});expect(f.state.receipts.map(r=>r.remaining)).toEqual([50,20]);expect(f.state.invoices).toEqual([]);expect(f.state.allocations).toEqual([]);});
 it('keeps customer balance separate until explicitly attributed to an order',()=>{const f=setup();const id=f.assign(30,'r',null).id!;expect(orderFundingCoveredAmount(f.state,'o')).toBe(0);expect(()=>assertOrderDepositCovered(f.state,'o')).toThrow('尚不足');applyOrderFundingCommand(f.state,{type:'funding.assign',payload:{id,receiptId:'r',customerId:'c',orderId:'o',amount:30,note:'确认客户定金用于本订单'}},f.context);expect(orderFundingCoveredAmount(f.state,'o')).toBe(30);expect(f.state.orderFunding!.assignments).toHaveLength(1);expect(f.state.orderFunding!.assignments[0].history).toHaveLength(2);});
 it('rejects duplicate allocation of a receipt atomically and validates source currency and customer',()=>{const f=setup();f.assign(30);const before=JSON.stringify(f.state.orderFunding);expect(()=>f.assign(21,'r','other')).toThrow('重复');expect(JSON.stringify(f.state.orderFunding)).toBe(before);(f.state.orders[1] as any).currency='CNY';expect(()=>f.assign(1,'r','other')).toThrow('同客户同币种');expect(()=>applyOrderFundingCommand(f.state,{type:'funding.assign',payload:{receiptId:'r',customerId:'missing',amount:1,note:'依据'}},f.context)).toThrow('客户不存在');});
 it('rejects another active assignment for the same receipt and target and caps attribution at the order contract',()=>{const f=setup();f.assign(20);expect(()=>f.assign(20)).toThrow('相同归属');expect(f.state.orderFunding!.assignments).toHaveLength(1);f.state.receipts[1].amount=100;expect(()=>f.assign(90,'r2')).toThrow('合同金额');expect(f.state.orderFunding!.assignments).toHaveLength(1);});
 it('counts a deposit and its eventual invoice allocation once and blocks spending it on another order',()=>{const f=setup();f.assign(30);f.state.invoices=[{id:'invoice',code:'I',orderId:'o',order:'O',customer:'客户',due:'2026-12-01',amount:100,open:70,currency:'USD'}];f.state.allocations=[{id:'a',receiptId:'r',invoiceId:'invoice',amount:30,currency:'USD',createdAt:'',actor:'财务'}];expect(orderFundingCoveredAmount(f.state,'o')).toBe(30);expect(()=>assertOrderFundingIntegrity(f.state)).not.toThrow();f.state.invoices[0].orderId='other';expect(()=>assertOrderFundingIntegrity(f.state)).toThrow('重复');});
 it('lets a customer balance cover that same customer invoice without double reservation',()=>{const f=setup();f.assign(50,'r',null);f.state.invoices=[{id:'invoice',code:'I',orderId:'o',order:'O',customer:'客户',due:'',amount:100,open:50,currency:'USD'}];f.state.allocations=[{id:'a',receiptId:'r',invoiceId:'invoice',amount:50,currency:'USD',createdAt:'',actor:'财务'}];expect(()=>assertOrderFundingIntegrity(f.state)).not.toThrow();expect(orderFundingCoveredAmount(f.state,'o')).toBe(50);});
 it('does not declare an unspecified T/T percentage covered and supports precise percentage cents',()=>{const f=setup();(f.state.orders[0] as any).governance.contract.depositPercent=null;expect(orderDepositCoverage(f.state,'o').status).toBe('unconfigured');expect(()=>assertOrderDepositCovered(f.state,'o')).toThrow('明确');(f.state.orders[0] as any).governance.contract.depositPercent=30.01;expect(orderDepositCoverage(f.state,'o').required).toBe(30.01);f.assign(30.01);expect(assertOrderDepositCovered(f.state,'o').status).toBe('covered');});
 it('retains the released assignment history and requires a real actor and finance permission',()=>{const f=setup(),id=f.assign(30).id!;applyOrderFundingCommand(f.state,{type:'funding.release',payload:{id,note:'按客户确认重新归属'}},f.context);expect(f.state.orderFunding!.assignments[0]).toMatchObject({state:'released',amount:30});expect(orderFundingCoveredAmount(f.state,'o')).toBe(0);expect(orderFundingCommandPermission({type:'funding.release',payload:{id,note:'依据'}})).toBe('invoices:reconcile');expect(()=>applyOrderFundingCommand(f.state,{type:'funding.assign',payload:{receiptId:'r',customerId:'c',orderId:'o',amount:1,note:'依据'}},{...f.context,actorId:undefined})).toThrow('真实操作账号');});
 it('names the receipt amount and resulting total when a single attribution exceeds the receipt',()=>{const f=setup();expect(()=>f.assign(60)).toThrow('此到账金额 50.00 USD，归属与核销合计将达 60.00 USD');expect(f.state.orderFunding!.assignments).toHaveLength(0);});
});

describe('approved pre-shipment cumulative receipts',()=>{
 it('blocks an unpaid balance and one-cent shortage, then counts assigned and reconciled cash once',()=>{
  const f=setup();(f.state.orders[0] as any).governance.contract.preShipmentPercent=100;
  expect(()=>assertOrderShipmentPaymentCovered(f.state,'o')).toThrow('出运前收款不足');
  f.state.receipts[0].amount=100;f.state.receipts[0].remaining=100;f.assign(99.99);
  expect(orderShipmentPaymentCoverage(f.state,'o')).toMatchObject({required:100,received:99.99,shortage:0.01,status:'insufficient'});
  expect(()=>assertOrderShipmentPaymentCovered(f.state,'o')).toThrow('0.01 USD');
  f.state.orderFunding.assignments[0].amount=100;
  f.state.invoices=[{id:'i',orderId:'o',currency:'USD'}] as any;f.state.allocations=[{id:'a',receiptId:'r',invoiceId:'i',amount:100,currency:'USD'}] as any;
  expect(assertOrderShipmentPaymentCovered(f.state,'o')).toMatchObject({received:100,status:'covered'});
 });
 it('does not infer an unknown collection gate from payment text or unassigned money',()=>{
  const f=setup();(f.state.orders[0] as any).governance.contract.paymentNote='100% before shipment';
  expect(orderShipmentPaymentCoverage(f.state,'o').status).toBe('unconfigured');
  expect(()=>assertOrderShipmentPaymentCovered(f.state,'o')).toThrow('出运前累计收款比例');
  (f.state.orders[0] as any).governance.contract.preShipmentPercent=50;
  expect(orderShipmentPaymentCoverage(f.state,'o').received).toBe(0);
 });
 it('supports an explicit credit shipment condition without inventing payment',()=>{
  const f=setup();Object.assign((f.state.orders[0] as any).governance.contract,{paymentMethod:'OA',depositPercent:null,preShipmentPercent:0});
  expect(assertOrderShipmentPaymentCovered(f.state,'o')).toMatchObject({required:0,received:0,status:'covered'});
 });
 it('rounds the approved percentage in minor units and rejects malformed values',()=>{
  const f=setup();Object.assign(f.state.orders[0],{amount:123.45});(f.state.orders[0] as any).governance.contract.preShipmentPercent=30.01;
  expect(orderShipmentPaymentCoverage(f.state,'o').required).toBe(37.05);
  (f.state.orders[0] as any).governance.contract.preShipmentPercent=101;
  expect(orderShipmentPaymentCoverage(f.state,'o').status).toBe('unconfigured');
 });
});

describe('reconciliation headroom matches the authoritative funding guard',()=>{
 it.each([
  {name:'unreserved cash',target:0,balance:0,other:0,used:0,orderPaidElsewhere:0,want:[50,50,50]},
  {name:'full order earmark',target:50,balance:0,other:0,used:0,orderPaidElsewhere:0,want:[50,0,0]},
  {name:'partial order earmark',target:30,balance:0,other:0,used:0,orderPaidElsewhere:0,want:[50,20,20]},
  {name:'customer balance',target:0,balance:50,other:0,used:0,orderPaidElsewhere:0,want:[50,50,0]},
  {name:'customer balance and exact order',target:20,balance:30,other:0,used:0,orderPaidElsewhere:0,want:[50,30,0]},
  {name:'different order and customer pool',target:0,balance:20,other:30,used:0,orderPaidElsewhere:0,want:[20,50,0]},
  {name:'partial allocation overlaps its earmark',target:50,balance:0,other:0,used:10,orderPaidElsewhere:0,want:[40,0,0]},
  {name:'allocation beyond earmark',target:20,balance:10,other:0,used:25,orderPaidElsewhere:0,want:[25,25,20]},
  {name:'contract already partly covered elsewhere',target:0,balance:0,other:0,used:0,orderPaidElsewhere:80,want:[20,50,50]},
 ])('$name',scenario=>{
  const f=setup();f.state.orderLines=f.state.orders.map(o=>({id:'line-'+o.id,orderId:o.id,name:'商品',style:'A',img:'clay',qty:1,unit:'件',price:100,made:0,qc:0}));f.state.receipts[1].amount=100;f.state.receipts[1].remaining=100;
  if(scenario.target)f.assign(scenario.target);
  if(scenario.balance)f.assign(scenario.balance,'r',null);
  if(scenario.other)f.assign(scenario.other,'r','other');
  if(scenario.orderPaidElsewhere)f.assign(scenario.orderPaidElsewhere,'r2','o');
  f.state.invoices=['o','other'].map((orderId,n)=>({id:'i'+n,code:'I'+n,orderId,order:orderId,customer:'客户',due:'2026-10-13',currency:'USD',amount:100,open:100}));
  f.state.invoices.push({id:'dev',code:'DEV',orderId:'',order:'',customer:'客户',due:'2026-10-13',currency:'USD',amount:100,open:100,devId:'development'} as any);
  if(scenario.used){f.state.allocations.push({id:'used',receiptId:'r',invoiceId:'i0',currency:'USD',amount:scenario.used,createdAt:f.context.now,actor:'财务'});f.state.receipts[0].remaining-=scenario.used;f.state.invoices[0].open-=scenario.used;}
  const original=JSON.stringify(f.state);
  for(const [n,invoiceId] of ['i0','i1','dev'].entries()){
   const limit=orderFundingReconciliationLimit(f.state,'r',invoiceId);expect(limit).toBe(scenario.want[n]);
   if(limit>0)expect(()=>applyMistCommand(f.state,{type:'finance.reconcile',payload:{receiptId:'r',invoiceId,amount:limit,payerBasis:'核对原始付款依据'}},f.context)).not.toThrow();
   expect(()=>applyMistCommand(f.state,{type:'finance.reconcile',payload:{receiptId:'r',invoiceId,amount:limit+.01,payerBasis:'核对原始付款依据'}},f.context)).toThrow();
  }
  expect(JSON.stringify(f.state)).toBe(original);
 });
 it('returns zero for a different currency or missing source',()=>{const f=setup();f.state.invoices=[{id:'eur',currency:'EUR',open:50} as any];expect(orderFundingReconciliationLimit(f.state,'r','eur')).toBe(0);expect(orderFundingReconciliationLimit(f.state,'missing','eur')).toBe(0);expect(orderFundingReconciliationLimit(f.state,'r','missing')).toBe(0);});
});

it('keeps customer-only balances out of another customer and development invoices',()=>{
 const f=setup();f.assign(50,'r',null);f.state.orders[1].customerId='other-customer';f.state.invoices=[{id:'foreign',orderId:'other',currency:'USD',open:100} as any,{id:'opening',currency:'USD',open:100,opening:{}} as any];
 expect(orderFundingReconciliationLimit(f.state,'r','foreign')).toBe(0);expect(orderFundingReconciliationLimit(f.state,'r','opening')).toBe(0);
 f.state.orderFunding!.assignments[0].state='released';expect(orderFundingReconciliationLimit(f.state,'r','foreign')).toBe(50);expect(orderFundingReconciliationLimit(f.state,'r','opening')).toBe(50);
});

it('reserves tax-refund receipt usage instead of allowing the same money to become a customer deposit',()=>{
 const f=setup();f.state.receipts[0].currency='CNY';f.state.orders.forEach(o=>o.currency='CNY');f.state.exportRebate!.claims.push({receipts:[{receiptId:'r',amount:20}]} as any);
 expect(()=>f.assign(31,'r',null)).toThrow('超出到账金额');
});
