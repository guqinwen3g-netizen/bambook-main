import {describe,it,expect} from 'vitest';
import {applyMistCommand,createMistState,mistCommandPermission,type MistContext,type MistCommand,type MistState} from './mistWorkspace';
import {customerHandovers,accountHandoverBlockers} from './mistHandover';

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
    expect(()=>f.run({...base,toUserId:'nobody'})).toThrow('须为本公司的成员账号');
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

describe('成员按账号整体交接',()=>{
  function accountFixture(groups:string[]=['garment','fabric']){
    let id=0;const ctx={id:()=>`ah-${++id}`,now:'2026-10-18T02:00:00Z',actorId:'owner',actorName:'所有者',members:[{id:'demo-sales',name:'顾言',active:true,groups:['garment']},{id:'demo-new',name:'林舟',active:true,groups},{id:'gone',name:'已离职',active:false,groups:[]}]} as unknown as MistContext;
    let state=createMistState(ctx,'demo');
    const run=(payload:Record<string,unknown>)=>{const r=applyMistCommand(state,{type:'handover.account',payload} as MistCommand,ctx);state=r.state;return r.result as {id:string};};
    return {run,get state(){return state as MistState;}};
  }
  it('只由所有者办理；须指定在用成员并写原因',()=>{
    expect(mistCommandPermission({type:'handover.account',payload:{}} as MistCommand)).toBeNull();
    const f=accountFixture();
    expect(()=>f.run({fromUserId:'demo-buyer',toUserId:'gone',reason:'离职'})).toThrow('账号已停用');
    expect(()=>f.run({fromUserId:'demo-new',toUserId:'demo-new',reason:'离职'})).toThrow('不能与原负责人相同');
    expect(()=>f.run({fromUserId:'demo-buyer',toUserId:'demo-new',reason:''})).toThrow('交接原因');
    expect(()=>f.run({fromUserId:'nobody-owns',toUserId:'demo-new',reason:'离职'})).toThrow('无需交接');
  });
  it('把原账号名下客户、订单、开发、寻样、商机、供应商经手与未完成待办一次交给新负责人，并留记录与接手待办',async()=>{
    const {accountOwnedObjects}=await import('./mistAccounts');
    const {accountHandovers,accountOwners}=await import('./mistHandover');
    const f=accountFixture();
    for(const o of f.state.orders)if(o.ownerId==='demo-buyer'&&o.governance)o.governance.status='approved' as any;
    const before=accountOwnedObjects(f.state,'demo-buyer'),tasks=f.state.tasks.filter(t=>!t.done&&t.assigneeIds.includes('demo-buyer')).map(t=>t.id);
    expect(before.length).toBeGreaterThan(0);
    expect(accountOwners(f.state).find(a=>a.id==='demo-buyer')).toMatchObject({name:'沈禾',count:before.length});
    f.run({fromUserId:'demo-buyer',toUserId:'demo-new',reason:'沈禾离职，全部业务由林舟接手'});
    const s=f.state;
    expect(accountOwnedObjects(s,'demo-buyer')).toEqual([]);
    expect(accountOwnedObjects(s,'demo-new').length).toBeGreaterThanOrEqual(before.length);
    for(const id of tasks)expect(s.tasks.find(t=>t.id===id)!.assigneeIds).toContain('demo-new');
    expect(s.tasks.some(t=>!t.done&&t.assigneeIds.includes('demo-buyer'))).toBe(false);
    const record=accountHandovers(s)[0];
    expect(record).toMatchObject({fromId:'demo-buyer',from:'沈禾',toId:'demo-new',to:'林舟',tasks:tasks.length});
    expect(record.objects).toHaveLength(before.length);
    expect(s.tasks[0]).toMatchObject({kind:'account-handover',assigneeIds:['demo-new'],due:'2026-10-21'});
    expect(s.events.some(e=>e.entityType==='workspace'&&e.text.startsWith('成员交接：沈禾→林舟'))).toBe(true);
  });
  it('审批中的订单与新负责人不在对应业务组的供应商经手会阻止交接，且不改动任何数据',()=>{
    const f=accountFixture([]);
    const s0=structuredClone(f.state);
    const supplier=f.state.market.suppliers.find(x=>Object.values(x.handlers||{}).some(h=>h?.id==='demo-buyer'));
    const pending=f.state.orders.find(o=>o.ownerId==='demo-buyer'&&o.governance?.status==='pending');
    expect(supplier||pending).toBeTruthy();
    expect(()=>f.run({fromUserId:'demo-buyer',toUserId:'demo-new',reason:'离职'})).toThrow(supplier?'业务组':'审批中');
    expect(f.state).toEqual(s0);
  });
});

it('locks customer and whole-account handover throughout cancellation review without changing records',()=>{
 const f=fixture(),o=order(f.state,'SO-G-2026-015') as any;o.governance={...o.governance,status:'approved',cancellation:{id:'cancel-1',status:'pending',requesterId:'demo-sales',reviewerIds:['leader']}};
 const before=JSON.stringify(f.state);
 expect(()=>f.run({customerId:'customer-0',toUserId:'demo-new',reason:'调岗',orderIds:[o.id]})).toThrow('审批中，审批完成后再交接');
 expect(accountHandoverBlockers(f.state,o.ownerId)).toContain(`订单 ${o.code} 审批中，审批完成后再交接`);
 expect(JSON.stringify(f.state)).toBe(before);
 o.governance.cancellation.status='rejected';expect(accountHandoverBlockers(f.state,o.ownerId)).not.toContain(`订单 ${o.code} 审批中，审批完成后再交接`);
});

it('moves selected old orders to the existing customer owner without changing commercial facts or unrelated tasks',()=>{
 const f=fixture(),customer=f.state.customers.find(row=>row.id==='customer-1')!,selected=order(f.state,'SO-G-2026-009'),other=order(f.state,'SO-G-2026-017');expect(selected.ownerId).not.toBe(customer.ownerId);
 f.state.tasks.push({id:'old-order-task',title:'核对原单',due:'2026-10-20',done:false,kind:'order',target:{view:'orders/detail',id:selected.id},assigneeIds:[selected.ownerId]},{id:'other-order-task',title:'另一原单',due:'2026-10-20',done:false,kind:'order',target:{view:'orders/detail',id:other.id},assigneeIds:['demo-sales']});const before=structuredClone(f.state),ownerId=customer.ownerId;
 f.run({customerId:customer.id,toUserId:ownerId,reason:'在手订单由现客户负责人接续',orderIds:[selected.id]});const after=order(f.state,selected.code);expect(after).toEqual({...before.orders.find(row=>row.id===selected.id),ownerId,owner:customer.owner});expect(f.state.customers.find(row=>row.id===customer.id)?.ownerId).toBe(ownerId);expect(order(f.state,other.code)).toEqual(before.orders.find(row=>row.id===other.id));expect(f.state.orderLines).toEqual(before.orderLines);expect(f.state.fulfillment).toEqual(before.fulfillment);expect(f.state.invoices).toEqual(before.invoices);expect(f.state.payments).toEqual(before.payments);expect(f.state.tasks.find(row=>row.id==='old-order-task')?.assigneeIds).toEqual([ownerId]);expect(f.state.tasks.find(row=>row.id==='other-order-task')).toEqual(before.tasks.find(row=>row.id==='other-order-task'));expect(f.state.events.some(row=>row.text.startsWith('在手业务交接给 '+customer.owner))).toBe(true);
});
