import {describe,it,expect} from 'vitest';
import {applyMistCommand,createMistState,type MistContext,type MistCommand,type MistState} from './mistWorkspace';
import {invoiceCollectionStatus} from './mistCrm';

function fixture(){
  let id=0;const ctx={id:()=>`col-${++id}`,now:'2026-10-14T02:00:00Z',actorId:'sales',actorName:'顾言'} as MistContext;
  let state=createMistState(ctx,'demo');
  const run=(command:MistCommand)=>{const result=applyMistCommand(state,command,ctx);state=result.state;return result.result as {id:string};};
  return {run,get state(){return state;}};
}
const save=(customerId:string,invoiceId:string,collection:Record<string,unknown>|undefined,patch:Record<string,unknown>={})=>({type:'crm.followUp.save',payload:{customerId,method:'call',content:'电话确认付款安排',at:'2026-10-14T01:00:00Z',nextDate:'',link:{kind:'invoice',id:invoiceId},collection,...patch}}) as MistCommand;

describe('应收催收',()=>{
  it('催收须关联同一客户的未结应收；承诺日与金额须同时填写且不超过未收',()=>{
    const f=fixture();
    expect(()=>f.run({type:'crm.followUp.save',payload:{customerId:'customer-0',method:'call',content:'催款',at:'2026-10-14T01:00:00Z',nextDate:'',link:null,collection:{level:1}}} as MistCommand)).toThrow('须关联应收票据');
    expect(()=>f.run(save('customer-1','INV-G-2026-0412',{level:1}))).toThrow('不属于该客户');
    expect(()=>f.run(save('customer-2','INV-G-2026-0388',{level:1}))).toThrow('已结清');
    expect(()=>f.run(save('customer-0','INV-G-2026-0412',{level:4}))).toThrow('级别无效');
    expect(()=>f.run(save('customer-0','INV-G-2026-0412',{level:2,promisedDate:'2026-10-20'}))).toThrow('同时填写');
    expect(()=>f.run(save('customer-0','INV-G-2026-0412',{level:2,promisedDate:'2026-10-10',promisedAmount:'100'}))).toThrow('不能早于今天');
    expect(()=>f.run(save('customer-0','INV-G-2026-0412',{level:2,promisedDate:'2026-10-20',promisedAmount:'42240.01'}))).toThrow('不能超过当前未收');
    expect(()=>f.run(save('customer-0','INV-G-2026-0412',{level:2,promisedDate:'2026-10-20',promisedAmount:'0'}))).toThrow('大于零');
  });
  it('登记催收写入承诺与币种，下次跟进待办指向应收台账，客户与票据各记一条事件',()=>{
    const f=fixture();
    const {id}=f.run(save('customer-0','INV-G-2026-0412',{level:2,promisedDate:'2026-10-20',promisedAmount:'20000'},{nextDate:'2026-10-21'}));
    const row=f.state.crm.followUps.find(r=>r.id===id)!;
    expect(row.collection).toEqual({level:2,promisedDate:'2026-10-20',promisedAmount:'20000',currency:'USD',openAtLog:42240});
    expect(f.state.tasks.find(t=>t.id===row.nextTaskId)).toMatchObject({kind:'crm-follow-up',due:'2026-10-21',target:{view:'invoices',id:'INV-G-2026-0412'}});
    expect(f.state.tasks.find(t=>t.id===row.nextTaskId)!.title).toContain('催收 INV-G-2026-0412');
    expect(f.state.events.some(e=>e.entityType==='invoice'&&e.entityId==='INV-G-2026-0412'&&e.text.includes('逾期催收'))).toBe(true);
    expect(f.state.events.some(e=>e.entityType==='customer'&&e.entityId==='customer-0'&&e.text.includes('承诺 2026-10-20 付 20000 USD'))).toBe(true);
    // 普通跟进关联票据但不带催收，不计入催收次数
    f.run(save('customer-0','INV-G-2026-0412',undefined));
    expect(invoiceCollectionStatus(f.state,'INV-G-2026-0412','2026-10-14')).toMatchObject({count:1,level:2,promise:{state:'pending',paidSince:0}});
  });
  it('承诺兑现判断：承诺后核销达到承诺金额为兑现，过承诺日仍不足为未兑现',()=>{
    const f=fixture();
    f.run(save('customer-0','INV-G-2026-0412',{level:1,promisedDate:'2026-10-20',promisedAmount:'20000'}));
    const s=f.state as MistState;
    expect(invoiceCollectionStatus(s,'INV-G-2026-0412','2026-10-21').promise?.state).toBe('broken');
    const withPay=(amount:number,createdAt:string)=>({...s,allocations:[...s.allocations,{id:'a1',receiptId:'r1',invoiceId:'INV-G-2026-0412',amount,currency:'USD',createdAt,actor:'财务'}]}) as MistState;
    expect(invoiceCollectionStatus(withPay(20000,'2026-10-19T03:00:00Z'),'INV-G-2026-0412','2026-10-21').promise).toMatchObject({state:'kept',paidSince:20000});
    expect(invoiceCollectionStatus(withPay(5000,'2026-10-19T03:00:00Z'),'INV-G-2026-0412','2026-10-21').promise).toMatchObject({state:'broken',paidSince:5000});
    expect(invoiceCollectionStatus(withPay(20000,'2026-10-01T03:00:00Z'),'INV-G-2026-0412','2026-10-21').promise?.state).toBe('broken');
  });
});
