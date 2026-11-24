import{expect,it}from'vitest';
import{compactPlatformTaskSteps,newPlatformTaskStep,parsePlatformTaskPlan,platformTaskHistory,resolvePlatformFileContinuation}from'./platformTaskPlan';
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


it('accepts a bounded public progress update without forwarding it to the tool',()=>{
  const plan=parsePlatformTaskPlan(JSON.stringify({name:'bambook_get',arguments:{type:'order',id:'so-demo'},progress:'先核对订单中的交期，再与附件对照。'}));
  expect(plan.progress).toBe('先核对订单中的交期，再与附件对照。');
  expect(plan.arguments).toEqual({type:'order',id:'so-demo'});
  expect(parsePlatformTaskPlan(JSON.stringify({...plan,progress:'Bearer abcdef1234567890'}))).not.toHaveProperty('progress');
  expect(parsePlatformTaskPlan(JSON.stringify({...plan,progress:'字'.repeat(300)})).progress).toHaveLength(240);
});


it('sends identical read bodies once while keeping each operation and changed revisions distinct',()=>{
  const plan={name:'bambook_get',arguments:{type:'order',id:'so'}};
  const result={revision:63,object:{data:{id:'so',text:'条款'.repeat(2000)}}};
  const first={...newPlatformTaskStep(plan,1000),result};
  const repeated={...newPlatformTaskStep(plan,2000),result:structuredClone(result)};
  const changed={...newPlatformTaskStep(plan,3000),result:{...result,revision:64}};
  const history=platformTaskHistory([first,repeated,changed]);
  expect(history.recent.map(step=>step.operationId)).toEqual([first.id,repeated.id,changed.id]);
  expect(history.recent[0].result).toMatchObject({duplicateOf:repeated.id});
  expect(history.recent[1].result).toEqual(result);
  expect(history.recent[2].result).toEqual({...result,revision:64});
  expect(first.result).toEqual(result);
});


it('uses the last verified continuation for the same file and only exposes a short cursor to the model',()=>{
 const read=(fileId:string)=>({name:'bambook_file_text',arguments:{fileId}});
 const next=(fileId:string)=>({name:'bambook_file_text',arguments:{fileId,cursor:'next',maxChars:7000}});
 const first={...newPlatformTaskStep(read('first'),1),result:{hasMore:true,nextCursor:'aft1.original-first',sourceHash:'source-one'}};
 const other={...newPlatformTaskStep(read('other'),2),result:{hasMore:true,nextCursor:'aft1.original-other'}};
 const failed={...newPlatformTaskStep(next('first'),3),result:{error:true}};
 const history=platformTaskHistory([first,other,failed]);
 expect(history.recent[0].result).toMatchObject({nextCursor:'next',sourceHash:'source-one'});
 expect(JSON.stringify(history)).not.toContain('aft1.original');
 expect(first.result.nextCursor).toBe('aft1.original-first');
 expect(resolvePlatformFileContinuation(next('first'),[first,other,failed]).arguments).toEqual({fileId:'first',cursor:'aft1.original-first',maxChars:7000});
 expect(resolvePlatformFileContinuation(next('missing'),[first,other])).toEqual(next('missing'));
 const done={...newPlatformTaskStep(next('first'),4),result:{hasMore:false}};
 expect(resolvePlatformFileContinuation(next('first'),[first,other,done])).toEqual(next('first'));
});
