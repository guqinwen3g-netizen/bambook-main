import{expect,it}from'vitest';
import{compactPlatformTaskSteps,newPlatformTaskStep,parsePlatformTaskPlan,platformTaskHistory}from'./platformTaskPlan';
import{platformReasoning}from'../ai/platformModel';

it('accepts only a bound business tool decision, without thoughts, owner impersonation or model request IDs',()=>{
  expect(parsePlatformTaskPlan('{"name":"bambook_query","arguments":{"type":"email"}}')).toEqual({name:'bambook_query',arguments:{type:'email'}});
  expect(()=>parsePlatformTaskPlan('{"name":"bambook_workspaces","arguments":{}}')).toThrow();
  expect(()=>parsePlatformTaskPlan('{"name":"bambook_get","arguments":{"workspaceId":"other"}}')).toThrow('MODEL_PLAN_SCOPE');
  expect(()=>parsePlatformTaskPlan('{"name":"bambook_task","arguments":{"action":"resume"}}')).toThrow();
  expect(()=>parsePlatformTaskPlan('{"name":"bambook_query","arguments":{},"reasoning":"private"}')).toThrow();
  const plan=parsePlatformTaskPlan('{"name":"bambook_execute","arguments":{"requestId":"model-id","command":{"type":"email.flag","payload":{}}}}'),step=newPlatformTaskStep(plan,0);
  expect(step.plan.arguments.requestId).toBe(step.id);expect(step.plan.arguments.requestId).not.toBe('model-id');
  expect(parsePlatformTaskPlan('{"name":"bambook_audit","arguments":{"requestId":"mcp-original-receipt"}}').arguments.requestId).toBe('mcp-original-receipt');
});
it('labels omitted results while retaining stable operation references for recovery',()=>{
  const plan={name:'bambook_query',arguments:{type:'email'}},old={...newPlatformTaskStep(plan,0),result:{body:'x'.repeat(150_000)}},latest={...newPlatformTaskStep(plan,1),result:{revision:3,body:'y'.repeat(150_000),results:[{id:'mail'}]}};
  const history=platformTaskHistory([old,latest]);expect(history.omitted).toBe(1);expect(history.recent).toHaveLength(1);expect(history.operations.map(x=>x.operationId)).toEqual([old.id,latest.id]);
});
it('rejects a concatenated future read and completion instead of treating proposed operations as executed facts',()=>{
 const status=JSON.stringify({name:'bambook_task',arguments:{action:'status'}}),read=JSON.stringify({name:'bambook_get',arguments:{type:'email',id:'original-mail'}}),finish=JSON.stringify({name:'bambook_task',arguments:{action:'finish',outcome:'succeeded',result:'Already reread and verified.'}});
 expect(()=>parsePlatformTaskPlan(status+read+finish)).toThrow('MODEL_PLAN_INVALID');
 expect(()=>parsePlatformTaskPlan(read+'\nAlready verified the original record.')).toThrow('MODEL_PLAN_INVALID');
 expect(parsePlatformTaskPlan(JSON.stringify({name:'bambook_task',arguments:{action:'wait',delaySeconds:60,summary:'Read the original record after the scheduled time.'}})).arguments.action).toBe('wait');
});
it('bounds completed history without altering an unacknowledged write or losing operation references',()=>{
 const plan={name:'bambook_execute',arguments:{command:{type:'email.draft.save',payload:{body:'a'.repeat(20_000)}}}},completed=Array.from({length:8},(_,i)=>({...newPlatformTaskStep(plan,i),result:{receipt:{requestId:'mcp-'+i,result:{id:'draft-'+i}},body:'b'.repeat(140_000)}})),pending=newPlatformTaskStep(plan,9),steps=compactPlatformTaskSteps([...completed,pending]);
 expect(JSON.stringify(steps).length).toBeLessThanOrEqual(600_000);expect(steps.at(-1)).toEqual(pending);expect(steps.map(s=>s.id)).toEqual([...completed,pending].map(s=>s.id));expect(steps.slice(0,-1).every(s=>s.result!==undefined)).toBe(true);expect(steps.some(s=>s.compacted)).toBe(true);
});
it('uses a dedicated platform task reasoning profile while retaining the existing override mechanism',()=>{
 expect(platformReasoning('agent-task',{})).toBe('high');expect(platformReasoning('agent-task',{BAMBOOK_PLATFORM_REASONING_AGENT_TASK:'medium'})).toBe('medium');
});
