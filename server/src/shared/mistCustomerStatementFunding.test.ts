import {it,expect} from 'vitest';
import {createMistState,type MistState} from './mistWorkspace';
import {customerStatementContent,customerStatementBlocker,customerHasStatementItems} from './mistCustomerStatement';
import {canGenerateScopedStatement} from './mistDataScope';
const day='2026-11-13',now=day+'T12:00:00Z';
function fixture(){const s=createMistState({id:()=>crypto.randomUUID(),now,actorId:'finance',actorName:'Finance'},'empty');s.settings.companyProfile={...s.settings.companyProfile,legalName:'Company'} as any;
 s.customers=[{id:'payer',name:'Payer'},{id:'owner',name:'Owner'}] as any;
 s.orders=[{id:'p1',code:'P1',customerId:'payer',currency:'USD',amount:1000,type:'garment',ownerId:'member'},{id:'p2',code:'P2',customerId:'payer',currency:'USD',amount:1000,type:'garment',ownerId:'member'},{id:'o1',code:'O1',customerId:'owner',currency:'USD',amount:1000,type:'garment',ownerId:'other'}] as any;
 return s;
}
const bank=(id:string,amount:number,remaining=amount,payer='Payer',currency='USD',date=day)=>({id,code:id,date,payer,amount,remaining,currency,ref:id,state:'unmatched' as const});
const assign=(id:string,receiptId:string,customerId:string,amount:number,orderId:string|null=null,currency='USD',state='active')=>({id,receiptId,customerId,amount,orderId,currency,state,note:'Bank instruction',createdAt:now,updatedAt:now,actor:'Finance',history:[]}) as any;
const allocation=(id:string,receiptId:string,invoiceId:string,amount:number)=>({id,receiptId,invoiceId,amount,currency:'USD',createdAt:now,actor:'Finance'});
const pending=(s:MistState,customer:string,currency='USD')=>customerStatementContent(s,customer,day).sections.find(x=>x.currency===currency)?.totalUnapplied;
it('uses explicit customer ownership over a same-name payer and permits a prepayment-only statement for the owner',()=>{
 const s=fixture();s.receipts=[bank('r',120)];s.orderFunding!.assignments=[assign('a','r','owner',120)];const before=structuredClone(s);
 expect(pending(s,'payer')).toBeUndefined();expect(pending(s,'owner')).toBe('120.00');expect(customerStatementBlocker(s,'owner',day)).toBeNull();expect(s).toEqual(before);
});
it('shows only unused customer balance after a development application and restores it on reversal',()=>{
 const s=fixture();s.receipts=[bank('r',120,70)];s.orderFunding!.assignments=[assign('a','r','owner',120)];
 s.invoices=[{id:'di',code:'DI',orderId:'',devId:'development',customerId:'owner',customer:'Owner',currency:'USD',amount:180,open:130,due:day}] as any;s.allocations=[allocation('applied','r','di',50)];
 const section=customerStatementContent(s,'owner',day).sections.find(x=>x.currency==='USD')!;
 expect(section.totalUnapplied).toBe('70.00');expect(section.net).toBe('60.00');expect(pending(s,'payer')).toBeUndefined();
 s.allocations=[];s.receipts[0].remaining=120;s.invoices[0].open=180;
 const restored=customerStatementContent(s,'owner',day).sections.find(x=>x.currency==='USD')!;expect(restored.totalUnapplied).toBe('120.00');expect(restored.net).toBe('60.00');
});
it('deducts receipt-side currency from the same customer advance for a cross-currency development invoice',()=>{
 const s=fixture();s.receipts=[bank('r',100,60,'Third party','EUR')];s.orderFunding!.assignments=[assign('a','r','owner',100,null,'EUR')];
 s.invoices=[{id:'di',code:'DI',orderId:'',devId:'development',customerId:'owner',customer:'Owner',currency:'USD',amount:100,open:50,due:day}] as any;s.allocations=[{...allocation('applied','r','di',50),receiptAmount:40,receiptCurrency:'EUR',rate:'1.25'} as any];
 expect(pending(s,'owner','EUR')).toBe('60.00');expect(pending(s,'payer','EUR')).toBeUndefined();
});
it('splits one receipt between owners without counting applied cash or another customer reservation again',()=>{
 const s=fixture();s.receipts=[bank('r',1000,650)];s.orderFunding!.assignments=[assign('a','r','payer',500,'p1'),assign('b','r','owner',400,'o1')];
 s.invoices=[{id:'pi',orderId:'p1',code:'PI',customer:'Payer',currency:'USD',amount:1000,open:700,due:day},{id:'oi',orderId:'o1',code:'OI',customer:'Owner',currency:'USD',amount:1000,open:950,due:day}] as any;s.allocations=[allocation('a1','r','pi',300),allocation('a2','r','oi',50)];
 // 200 still earmarked to payer +100 free same-name cash; 350 reserved to owner.
 expect(pending(s,'payer')).toBe('300.00');expect(pending(s,'owner')).toBe('350.00');
});
it('consumes generic customer balances together with order allocations while preserving another order earmark',()=>{
 const s=fixture();s.receipts=[bank('r',1000,700)];s.orderFunding!.assignments=[assign('a','r','payer',500),assign('b','r','payer',100,'p1'),assign('c','r','owner',400,'o1')];s.invoices=[{id:'pi',code:'PI',orderId:'p1',customer:'Payer',currency:'USD',amount:1000,open:700,due:day}] as any;s.allocations=[allocation('a1','r','pi',300)];
 expect(pending(s,'payer')).toBe('300.00');expect(pending(s,'owner')).toBe('400.00');
 s.receipts=[bank('r',250,150,'Third party')];s.orderFunding!.assignments=[assign('a','r','payer',100,'p1')];s.invoices[0].orderId='p2';s.allocations[0].amount=100;
 expect(pending(s,'payer')).toBe('100.00');
});
it('keeps receipt currencies separate, ignores released ownership and future receipts',()=>{
 const s=fixture();s.receipts=[bank('usd',120,120,'Third party'),bank('eur',80,80,'Third party','EUR'),bank('future',90,90,'Third party','USD','2026-11-14')];s.orderFunding!.assignments=[assign('a','usd','owner',120),assign('b','eur','owner',60,null,'EUR'),assign('released','eur','owner',20,null,'EUR','released'),assign('c','future','owner',90)];
 expect(customerStatementContent(s,'owner',day).sections.map(x=>[x.currency,x.totalUnapplied,x.net])).toEqual([['EUR','60.00','-60.00'],['USD','120.00','-120.00']]);
});
it('uses receipt-side amounts for cross-currency applications and leaves only unreserved same-name cash',()=>{
 const s=fixture();s.receipts=[bank('r',100,60,'Payer','EUR')];s.orderFunding!.assignments=[assign('a','r','owner',50,null,'EUR')];s.invoices=[{id:'pi',code:'PI',orderId:'p1',customer:'Payer',currency:'USD',amount:100,open:50,due:day}] as any;s.allocations=[{...allocation('a1','r','pi',50),receiptAmount:40,receiptCurrency:'EUR',rate:1.25} as any];
 expect(pending(s,'payer','EUR')).toBe('10.00');expect(pending(s,'owner','EUR')).toBe('50.00');
});
it('blocks a whole-customer statement when an assigned third-party receipt is outside the current scope',()=>{
 const s=fixture();s.receipts=[bank('r',120,120,'Third party')];s.orderFunding!.assignments=[assign('a','r','owner',120)];
 expect(canGenerateScopedStatement(s,{userIds:['member'],teamIds:[]},'owner')).toBe(false);
});
it('does not crash a visibility probe with unavailable order sources, while the actual snapshot stays strict',()=>{
 const s=fixture();s.receipts=[bank('r',120)];s.orderFunding!.assignments=[assign('a','r','payer',120,'p1')];s.orders=[];
 expect(()=>customerHasStatementItems(s,'payer',day)).not.toThrow();expect(customerHasStatementItems(s,'payer',day)).toBe(false);expect(()=>customerStatementContent(s,'payer',day)).toThrow();
});
it('lists only active bank accounts of the statement currency, without treating an unverified profile account as a multicurrency account',()=>{
 const s=fixture();s.settings.companyProfile={...s.settings.companyProfile,bankName:'Profile bank',bankAccount:'UNCONFIRMED-CURRENCY',swift:'PROFILE-SWIFT'} as any;s.receipts=[bank('eur',10,10,'Third party','EUR'),bank('usd',20,20,'Third party')];s.orderFunding!.assignments=[assign('a','eur','owner',10,null,'EUR'),assign('b','usd','owner',20)];
 s.bankAccounts=[{id:'usd-bank',code:'USD',name:'USD',currency:'USD',bankName:'Dollar bank',accountNo:'USD-ONLY',openingDate:'2026-01-01',openingBalance:0},{id:'closed-eur',code:'EUR',name:'EUR',currency:'EUR',bankName:'Closed bank',accountNo:'CLOSED-EUR',openingDate:'2026-01-01',openingBalance:0,closed:{at:now,actor:'Finance',reason:'Closed'}}] as any;
 const content=customerStatementContent(s,'owner',day);expect(content.sections.find(x=>x.currency==='EUR')!.remit).toEqual([]);expect(content.sections.find(x=>x.currency==='USD')!.remit.map(x=>x.accountNo)).toEqual(['USD-ONLY']);expect(content.sections.find(x=>x.currency==='USD')!.remit[0].swift).toBe('');
 s.settings.companyProfile!.bankName='Dollar bank';s.settings.companyProfile!.bankAccount='USD-ONLY';expect(customerStatementContent(s,'owner',day).sections.find(x=>x.currency==='USD')!.remit[0].swift).toBe('PROFILE-SWIFT');
});
it('refuses inconsistent funding rather than fabricating a capped statement balance',()=>{
 const s=fixture();s.receipts=[bank('r',50)];s.orderFunding!.assignments=[assign('a','r','owner',80)];const before=structuredClone(s);
 expect(()=>customerStatementContent(s,'owner',day)).toThrow('到账资金归属与核销不一致');expect(customerHasStatementItems(s,'owner',day)).toBe(false);expect(s).toEqual(before);
});
