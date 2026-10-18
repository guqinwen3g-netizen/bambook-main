import {describe,it,expect} from 'vitest';
import {applyMistCommand,createMistState,mistCommandPermission,type MistContext,type MistCommand,type MistState} from './mistWorkspace';
import {customerHandovers} from './mistHandover';

function fixture(){
  let id=0;const ctx={id:()=>`ho-${++id}`,now:'2026-10-18T02:00:00Z',actorId:'demo-sales',actorName:'顾言',members:[{id:'demo-sales',name:'顾言',active:true,groups:['garment']},{id:'demo-buyer',name:'沈禾',active:true,groups:['garment']},{id:'demo-new',name:'林舟',active:true,groups:['garment']},{id:'gone',name:'已离职',active:false,groups:[]}]} as unknown as MistContext;
  let state=createMistState(ctx,'demo');
  const run=(payload:Record<string,unknown>)=>{const r=applyMistCommand(state,{type:'handover.customer',payload} as MistCommand,ctx);state=r.state;return r.result as {id:string};};
  return {run,get state(){return state as MistState;}};
}
const order=(s:MistState,code:string)=>s.orders.find(o=>o.code===code)!;

describe('客户在手业务交接',()=>{
  it('主管把客户连同勾选的订单、商机交给新负责人，改派原负责人的待办并给新负责人生成接手待办',()=>{
    const f=fixture();
    expect(mistCommandPermission({type:'handover.customer',payload:{}} as MistCommand)).toBe('relations:admin');
    const base={customerId:'customer-1',toUserId:'demo-new',reason:'沈禾调岗至面料组，Northwind 由林舟接手'};
    expect(()=>f.run({...base,toUserId:'gone'})).toThrow('账号已停用');
    expect(()=>f.run({...base,toUserId:'nobody'})).toThrow('须为本工作区的成员账号');
    expect(()=>f.run({...base,reason:' '})).toThrow('交接原因');
    expect(()=>f.run({...base,orderIds:[order(f.state,'SO-G-2026-018').id]})).toThrow('不属于该客户');
    const opp=f.state.crm.opportunities.find(o=>o.customerId==='customer-1')!;
    const followUp=f.state.tasks.find(t=>!t.done&&t.kind==='crm-follow-up'&&t.assigneeIds.includes('demo-sales'))!;
    f.run({...base,orderIds:[order(f.state,'SO-G-2026-017').id,order(f.state,'SO-G-2026-009').id],opportunityIds:[opp.id]});
    const s=f.state, c=s.customers.find(x=>x.id==='customer-1')!;
    expect(c).toMatchObject({ownerId:'demo-new',owner:'林舟'});
    expect([order(s,'SO-G-2026-017'),order(s,'SO-G-2026-009')].map(o=>[o.ownerId,o.owner])).toEqual([['demo-new','林舟'],['demo-new','林舟']]);
    expect(s.crm.opportunities.find(o=>o.id===opp.id)).toMatchObject({ownerId:'demo-new',owner:'林舟'});
    expect(s.tasks.find(t=>t.id===followUp.id)!.assigneeIds).toEqual(['demo-new']);
    expect(customerHandovers(c)).toEqual([expect.objectContaining({fromId:'demo-buyer',from:'沈禾',toId:'demo-new',to:'林舟',orders:['SO-G-2026-017','SO-G-2026-009'],opportunities:[opp.title],tasks:1})]);
    expect(s.tasks[0]).toMatchObject({kind:'customer-handover',assigneeIds:['demo-new'],due:'2026-10-21',done:false});
    const relation=s.market.relations.find(r=>r.customerId==='customer-1')!;
    expect(s.tasks[0].target).toEqual({view:'relations',id:relation.id});
    expect(s.events.some(e=>e.entityId===relation.id&&e.text.startsWith('客户交接：沈禾→林舟；订单 2 张'))).toBe(true);
    expect(s.events.some(e=>e.entityType==='order'&&e.entityId===order(s,'SO-G-2026-009').id&&e.text.includes('负责人：顾言→林舟'))).toBe(true);
    expect(()=>f.run({...base,orderIds:[order(s,'SO-G-2026-017').id]})).toThrow('林舟 已是该客户及所选业务的负责人');
  });
  it('未勾选的订单保留原负责人；审批中的订单不能交接',()=>{
    const f=fixture();
    f.run({customerId:'customer-0',toUserId:'demo-buyer',reason:'顾言休假两周，由沈禾代管',orderIds:[order(f.state,'SO-G-2026-018').id]});
    expect(order(f.state,'SO-G-2026-018').ownerId).toBe('demo-buyer');
    expect(order(f.state,'SO-G-2026-015').ownerId).toBe('demo-sales');
    const o=order(f.state,'SO-G-2026-015') as any;o.governance={...o.governance,status:'pending'};
    expect(()=>f.run({customerId:'customer-0',toUserId:'demo-new',reason:'再交接',orderIds:[o.id]})).toThrow('审批中，审批完成后再交接');
  });
});
