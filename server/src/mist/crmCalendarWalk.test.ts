import {describe,expect,it} from 'vitest';
import {applyMistCommand,createMistState,type MistCommand} from '../shared/mistWorkspace';
import {projectState,MIST_READ_SECTIONS} from './access';
import {testActor} from './__tests__/support';

function scenario(){
  let n=0;const ctx={id:()=>`walk-${++n}`,actorName:'顾言',actorId:'sales',now:'2026-11-03T04:00:00Z',members:[{id:'other',name:'沈禾',active:true,groups:[]},{id:'sales',name:'顾言',active:true,groups:[]}]};
  let state=createMistState(ctx,'demo');const c=state.customers[0];
  const run=(cmd:MistCommand)=>{const result=applyMistCommand(state,cmd,ctx);state=result.state;return result.result?.id;};
  run({type:'crm.followUp.save',payload:{customerId:c.id,method:'call',content:'确认款式',at:ctx.now,nextDate:'2026-11-06',link:null}});
  const record=state.crm.followUps[0],task=record.nextTaskId,e=state.calendar.at(-1)!;
  const visible=(id:string)=>projectState(state,{...testActor(id),authorizationLoaded:true,permissions:[...new Set(MIST_READ_SECTIONS.flatMap(s=>s.permissions))]},()=>createMistState(ctx,'empty')).state.calendar;
  return {get state(){return state;},e,record,task,run,visible};
}
describe('customer follow-up calendar',()=>{
  it.each([false,true])('reflects completion, reopening and voiding on the customer appointment (old record: %s)',legacy=>{
    const f=scenario();if(legacy){delete f.e.sourceTaskId;delete f.record.actorId;}
    expect(f.visible('sales').some(e=>e.id===f.e.id)).toBe(true);
    expect(f.visible('other').some(e=>e.id===f.e.id)).toBe(false);
    f.run({type:'task.complete',payload:{id:f.task,done:true}});
    expect(f.visible('sales').some(e=>e.id===f.e.id)).toBe(false);
    f.run({type:'task.complete',payload:{id:f.task,done:false}});
    expect(f.visible('sales').filter(e=>e.id===f.e.id)).toHaveLength(1);
    f.run({type:'crm.followUp.void',payload:{id:f.record.id,reason:'重复记录'}});
    expect(f.visible('sales').some(e=>e.id===f.e.id)).toBe(false);
    expect(()=>f.run({type:'task.complete',payload:{id:f.task,done:false}})).toThrow('作废');
  });
  it('does not infer an old link when two private appointments have the same original details',()=>{
    const f=scenario();delete f.e.sourceTaskId;f.state.calendar.push({...f.e,id:'similar-meeting'});
    f.run({type:'task.complete',payload:{id:f.task,done:true}});
    expect(f.visible('sales').filter(e=>e.title===f.e.title).map(e=>e.id)).toEqual([f.e.id,'similar-meeting']);
    expect(f.visible('other').some(e=>e.title===f.e.title)).toBe(false);
  });
  it('passes a rescheduled private follow-up to its new assignee and preserves an independent meeting',()=>{
    const f=scenario();const manual='separate-meeting';
    f.state.calendar.push({...f.e,id:manual,sourceTaskId:undefined} as typeof f.e);
    f.run({type:'task.save',payload:{id:f.task,title:'',due:'2026-11-10',assigneeId:'other',note:'调整交期'}});
    expect(f.visible('other').find(e=>e.id===f.e.id)).toMatchObject({date:'2026-11-10',ownerId:'other'});
    expect(f.visible('sales').map(e=>e.id)).not.toContain(f.e.id);
    expect(f.visible('sales').map(e=>e.id)).toContain(manual);
    expect(()=>f.run({type:'calendar.delete',payload:{id:f.e.id}})).toThrow();
  });
});
