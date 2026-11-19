// @vitest-environment jsdom
import {it,expect} from 'vitest';
import {financeArea,financeCurrencyTotals,financeCustomerReceivables,financeRecords} from './FinanceWorkspace';
import {createMistState} from '../../../../server/src/shared/mistWorkspace';
const empty=()=>createMistState({id:()=>'',actorName:'测试',now:'2026-10-14T00:00:00Z'},'empty');
it('combines order, development, sample and opening receivables by customer ID and currency', () => {
  const s=empty();
  s.customers=[{id:'c1',name:'客户新名'},{id:'c2',name:'客户新名'}] as any;
  s.orders=[{id:'o',customerId:'c1'}] as any;
  s.devs=[{id:'d',customerId:'c1'}] as any;
  const base={orderId:'',customer:'客户旧名',currency:'USD',amount:12,open:12};
  s.invoices=[
    {...base,id:'order',orderId:'o'}, {...base,id:'dev',devId:'d'},
    {...base,id:'sample',sampleRequestId:'sr',customerId:'c1'}, {...base,id:'opening',opening:{},customerId:'c1'},
    {...base,id:'other',opening:{},customerId:'c2'}, {...base,id:'eur',customerId:'c1',currency:'EUR'},
    {...base,id:'unknown1'}, {...base,id:'unknown2'}, {...base,id:'notposted',customerId:'c1',financeStatus:'pending'},
  ] as any;
  const rows=financeCustomerReceivables(s);
  expect(rows.find(r=>r.customerId==='c1'&&r.currency==='USD')).toMatchObject({name:'客户新名',amount:48,invoices:4});
  expect(rows.find(r=>r.customerId==='c2')).toMatchObject({amount:12,invoices:1});
  expect(rows.find(r=>r.currency==='EUR')).toMatchObject({amount:12,invoices:1});
  expect(rows.filter(r=>!r.customerId)).toHaveLength(2);
});
it('groups original currencies in cents without FX conversion or floating-point tails',()=>{expect(financeCurrencyTotals([{currency:'USD',amount:0.1},{currency:'EUR',amount:200},{currency:'USD',amount:0.2}])).toEqual([{currency:'EUR',amount:200},{currency:'USD',amount:0.3}]);});
it('maps legacy overdue and funding deep links to receivables',()=>{for(const section of [undefined,'open','overdue:fabric','funding:order'])expect(financeArea(section)).toBe('receivables');expect(financeArea('accounts')).toBe('accounts');});
it('uses exact customer identities, separate currencies and only active open invoices',()=>{const s=empty();s.orders=[{id:'o1',customerId:'c1'},{id:'o2',customerId:'c2'}] as any;s.invoices=[{id:'a',orderId:'o1',customer:'同名客户',currency:'EUR',amount:100,open:10},{id:'b',orderId:'o1',customer:'同名客户',currency:'USD',amount:100,open:20},{id:'c',orderId:'o2',customer:'同名客户',currency:'EUR',amount:100,open:30},{id:'void',orderId:'o1',customer:'同名客户',currency:'EUR',amount:100,open:100,voidedAt:'2026-10-01'},{id:'closed',orderId:'o1',customer:'同名客户',currency:'EUR',amount:100,open:0}] as any;expect(financeCustomerReceivables(s).map(({customerId,currency,amount})=>({customerId,currency,amount}))).toEqual([{customerId:'c1',currency:'EUR',amount:10},{customerId:'c1',currency:'USD',amount:20},{customerId:'c2',currency:'EUR',amount:30}]);});
it('keeps original receipt and payment facts, directions and chronological order',()=>{const s=empty();s.receipts=[{id:'r',code:'R',date:'2026-10-01',payer:'客户',amount:50,remaining:30,currency:'EUR',ref:'bank-r',state:'unmatched'}];s.payments=[{id:'p',code:'P',date:'2026-10-02',payee:'供应商',amount:20,currency:'USD',ref:'bank-p'}];const before=JSON.stringify(s),rows=financeRecords(s);expect(rows.map(r=>[r.id,r.direction,r.amount,r.currency])).toEqual([['p','payment',20,'USD'],['r','receipt',50,'EUR']]);expect(rows[1].receipt).toBe(s.receipts[0]);expect(JSON.stringify(s)).toBe(before);});

it('keeps qualified transaction filter routes in the records area',()=>{for(const section of ['records:unassigned','records:receipt','records:payment'])expect(financeArea(section)).toBe('records');});
it('does not treat a partial scoped allocation as an original bank transaction',()=>{const s=empty();s.partialReceipts=[{id:'part',code:'PART',date:'2026-10-01',payer:'客户',currency:'USD',visibleAllocatedAmount:40,hiddenCount:1}];expect(financeRecords(s)).toEqual([]);});
