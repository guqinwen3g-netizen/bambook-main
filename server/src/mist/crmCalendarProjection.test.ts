import {describe,expect,it} from 'vitest';
import {projectState} from './access';
import {applyMistCommand,createMistState,type MistCommand,type MistContext} from '../shared/mistWorkspace';

function fixture(){
  let n=0;
  const context: MistContext={id:()=>`crm-calendar-${++n}`,now:'2026-11-14T02:00:00Z',actorId:'demo-sales',actorName:'顾言',members:[
    {id:'demo-sales',name:'顾言',active:true,groups:['garment','fabric']},
    {id:'new-sales',name:'新负责人',active:true,groups:['garment','fabric']},
  ]};
  let state=createMistState(context,'demo');
  const run=(command:MistCommand,actorId=context.actorId,actorName=context.actorName)=>{const result=applyMistCommand(state,command,{...context,actorId,actorName});state=result.state;return result.result;};
  run({type:'crm.followUp.save',payload:{customerId:'customer-0',method:'other',content:'确认选料需求',at:context.now,nextDate:'2026-11-23',link:null}});
  const follow=state.crm.followUps.find(row=>row.customerId==='customer-0'&&row.content==='确认选料需求')!;
  const event=state.calendar.find(row=>row.sourceTaskId===follow.nextTaskId)!;
  const view=(userId:string,permissions=['relations:read','crm:read'])=>projectState(state,{userId,roles:[],permissions,authorizationLoaded:true} as any,()=>createMistState(context,'empty'),undefined,{userIds:[userId],teamIds:[]}).state;
  return {get state(){return state;},run,view,follow,event};
}

describe('CRM customer appointments through real row and module projection',()=>{
  it('shows a customer-wide follow-up appointment to its responsible account',()=>{
    const f=fixture(),before=structuredClone(f.state),view=f.view('demo-sales');
    expect(view.tasks.find(row=>row.id===f.follow.nextTaskId)).toBeDefined();
    expect(view.calendar.find(row=>row.id===f.event.id)).toMatchObject({date:'2026-11-23',ownerId:'demo-sales',target:{view:'crm',id:'customer-0'}});
    expect(f.state).toEqual(before);
  });

  it('moves the same appointment to the recipient after customer handover without changing historical actors',()=>{
    const f=fixture(),original=structuredClone(f.follow);
    f.run({type:'handover.customer',payload:{customerId:'customer-0',toUserId:'new-sales',reason:'区域业务调整',orderIds:[],opportunityIds:[]}});
    const before=structuredClone(f.state),received=f.view('new-sales');
    expect(received.tasks.find(row=>row.id===f.follow.nextTaskId)?.assigneeIds).toEqual(['new-sales']);
    expect(received.calendar.find(row=>row.id===f.event.id)).toMatchObject({sourceTaskId:f.follow.nextTaskId,ownerId:'new-sales',date:'2026-11-23'});
    expect(f.view('demo-sales').calendar.some(row=>row.id===f.event.id)).toBe(false);
    expect(f.state.crm.followUps.find(row=>row.id===f.follow.id)).toEqual(original);
    expect(f.state.calendar.find(row=>row.id===f.event.id)).toEqual(f.event);
    expect(f.state).toEqual(before);
  });

  it('does not treat the shared customer directory or a customerId hint as access to another customer appointment',()=>{
    const f=fixture();
    f.state.calendar.push(
      {...f.event,id:'other-customer',sourceTaskId:undefined,ownerId:'demo-sales',target:{view:'crm',id:'customer-1'}},
      {...f.event,id:'unknown-object',sourceTaskId:undefined,ownerId:'demo-sales',target:{view:'crm',id:'unknown',customerId:'customer-0'}},
    );
    const view=f.view('demo-sales');
    expect(view.customers.some(row=>row.id==='customer-1')).toBe(true);
    expect(view.calendar.some(row=>['other-customer','unknown-object'].includes(row.id))).toBe(false);
    expect(f.view('outsider').calendar.some(row=>row.id===f.event.id)).toBe(false);
  });

  it('retains exact visible CRM record links while keeping the CRM module grant mandatory',()=>{
    const f=fixture();
    f.state.calendar.push({...f.event,id:'exact-follow-up',sourceTaskId:undefined,target:{view:'crm',id:f.follow.id}});
    expect(f.view('demo-sales').calendar.some(row=>row.id==='exact-follow-up')).toBe(true);
    expect(f.view('demo-sales',['relations:read']).calendar.some(row=>[f.event.id,'exact-follow-up'].includes(row.id))).toBe(false);
  });
});

function delegatedAppointment(){
 const f=fixture();
 const opportunityId=f.run({type:'crm.opportunity.save',payload:{input:{customerId:'customer-0',title:'AW28 selection',domain:'fabric',amount:'2400.00',currency:'EUR',expectedDate:'2026-11-30',ownerId:'new-sales',note:'',devIds:[],quotationIds:[],orderIds:[]}}}).id;
 const followId=f.run({type:'crm.followUp.save',payload:{customerId:'customer-0',method:'other',content:'复核本商机预算与起订量',at:'2026-11-14T02:00:00Z',nextDate:'2026-11-23',link:{kind:'opportunity',id:opportunityId}}},'new-sales','新负责人').id;
 const follow=f.state.crm.followUps.find(row=>row.id===followId)!;
 const event=f.state.calendar.find(row=>row.sourceTaskId===follow.nextTaskId)!;
 return {f,opportunityId,follow,event};
}

describe('CRM appointments from an individually owned opportunity',()=>{
 it.each([false,true])('retains the exact visible follow-up without granting the entire customer (legacy: %s)',legacy=>{
  const {f,follow,event}=delegatedAppointment();if(legacy)delete event.sourceTaskId;
  const before=structuredClone(f.state),view=f.view('new-sales');
  expect(view.crm.followUps.map(row=>row.id)).toContain(follow.id);
  expect(view.tasks.find(row=>row.id===follow.nextTaskId)).toBeDefined();
  expect(view.calendar.find(row=>row.id===event.id)).toMatchObject({sourceTaskId:follow.nextTaskId,date:'2026-11-23',ownerId:'new-sales',target:{view:'crm',id:'customer-0'}});
  expect(view.calendar.some(row=>row.id===f.event.id)).toBe(false);expect(f.state).toEqual(before);
 });

 it('does not admit another appointment from a shared customer hint or a borrowed task pointer',()=>{
  const {f,event}=delegatedAppointment();
  f.state.calendar.push({...event,id:'shared-customer-only',sourceTaskId:undefined,note:'其他商机的私有内容'}, {...event,id:'borrowed-task-note',note:'其他商机的私有内容'}, {...event,id:'borrowed-task-title',title:'其他商机的私有标题'});
  const view=f.view('new-sales');expect(view.calendar.some(row=>row.id===event.id)).toBe(true);
  expect(view.calendar.some(row=>['shared-customer-only','borrowed-task-note','borrowed-task-title'].includes(row.id))).toBe(false);
 });

 it('rechecks current business visibility when the opportunity leaves the account',()=>{
  const {f,opportunityId,event}=delegatedAppointment();f.state.crm.opportunities.find(row=>row.id===opportunityId)!.ownerId='demo-sales';
  expect(f.view('new-sales').calendar.some(row=>row.id===event.id)).toBe(false);
 });

 it('still requires the CRM module permission for a source-backed private appointment',()=>{
  const {f,event}=delegatedAppointment();expect(f.view('new-sales',['relations:read']).calendar.some(row=>row.id===event.id)).toBe(false);
 });

 it('rejects an ambiguous originating follow-up instead of inferring one from the task ID',()=>{
  const {f,follow,event}=delegatedAppointment();f.state.crm.followUps.push({...follow,id:'ambiguous-follow-up'});
  expect(f.view('new-sales').calendar.some(row=>row.id===event.id)).toBe(false);
 });

 it('does not accept a different task customer through a matching customerId hint',()=>{
  const {f,follow,event}=delegatedAppointment();f.state.tasks.find(row=>row.id===follow.nextTaskId)!.target={view:'crm',id:'customer-1',customerId:'customer-0'};
  expect(f.view('new-sales').calendar.some(row=>row.id===event.id)).toBe(false);
 });
});
