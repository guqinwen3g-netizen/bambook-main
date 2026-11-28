import{afterEach,beforeEach,expect,it,vi}from'vitest';
import request from'supertest';
import{mkdtemp,rm}from'node:fs/promises';
import{tmpdir}from'node:os';import path from'node:path';import{randomUUID}from'node:crypto';
import{createMistLocalRuntime}from'./local';import{createMistServer}from'./server';
import type{MistPlatformTaskWorker}from'./platformTaskWorker';
import type{LlmCompletionInput}from'../ai/llmProviders';
import{agentDailyUsage,taskRecord}from'./agentTasks';
import{agentDailyLimits}from'./agentLimits';
import{mistBusinessDate}from'../shared/mistBusinessClock';
let directory:string;const workers:MistPlatformTaskWorker[]=[];
beforeEach(async()=>{directory=await mkdtemp(path.join(tmpdir(),'agent-daily-'));vi.stubEnv('MIST_LOCAL_WORKSPACE','1');vi.stubEnv('NODE_ENV','test');});
afterEach(async()=>{await Promise.all(workers.splice(0).map(w=>w.stop()));vi.restoreAllMocks();vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});});
async function fixture(complete:(input:LlmCompletionInput)=>Promise<string>){
 const local=createMistLocalRuntime({directory});
 const app=createMistServer(undefined,{local,agentTasks:{complete,tickMs:3_600_000,pulseMs:20}}),human=request.agent(app);await human.get('/api/mist/session').expect(200);
 const workspace=(await human.get('/api/mist/workspaces/default').expect(200)).body.workspace,base='/api/mist/workspaces/'+workspace.id,id=randomUUID();
 await human.post(base+'/agent-identities').send({id,name:'业务助理',ownerId:'local-operator',mode:'operate'}).expect(201);
 await human.post(base+'/agent-identities/'+id+'/issue').send({requestId:randomUUID(),version:1}).expect(200);
 const worker=app.locals.platformTaskWorker as MistPlatformTaskWorker;workers.push(worker);
 const create=(executor?:'platform')=>human.post(base+'/agent-tasks').send({requestId:randomUUID(),identityId:id,name:'核对来信',instructions:'核对当前来信，缺少依据先问本人。',...(executor?{executor}:{})});
 const drain=async()=>{await worker.tick();await worker.settled();};
 return{local,human,workspace,base,worker,create,drain};
}
const tool=(name:string,args:Record<string,unknown>)=>JSON.stringify({name,arguments:args});

it('falls back to safe defaults and ignores malformed or out-of-range daily limits',()=>{
 expect(agentDailyLimits({})).toEqual({tasksPerUser:50,turnsPerUser:400,turnsPerCompany:3000});
 expect(agentDailyLimits({MIST_AGENT_DAILY_TASKS_PER_USER:'0',MIST_AGENT_DAILY_TURNS_PER_USER:'abc',MIST_AGENT_DAILY_TURNS_PER_COMPANY:'25'})).toEqual({tasksPerUser:50,turnsPerUser:400,turnsPerCompany:25});
});

it('refuses a platform task past the daily task cap, keeps external tasks open, and reports usage for today',async()=>{
 vi.stubEnv('MIST_AGENT_DAILY_TASKS_PER_USER','1');
 const f=await fixture(async()=>'');f.worker.start(3_600_000);
 await f.create('platform').expect(201);
 const refused=await f.create('platform').expect(429);
 expect(JSON.stringify(refused.body)).toContain('今日的小竹用量已达上限');
 await f.create().expect(201);
 const usage=(await f.human.get(f.base+'/personal-agent/usage?month='+new Date().toISOString().slice(0,7)).expect(200)).body;
 expect(usage.today).toMatchObject({tasks:1,taskLimit:1,turns:0,turnLimit:400});
});

it('pauses a running task before the model call that would pass the daily turn cap, then refuses new work until the next day',async()=>{
 vi.stubEnv('MIST_AGENT_DAILY_TURNS_PER_USER','10');
 let mail='';const complete=vi.fn(async()=>tool('bambook_get',{type:'email',id:mail}));const f=await fixture(complete);mail=f.workspace.state.email.messages[0].id;f.worker.start(3_600_000);
 const task=(await f.create('platform').expect(201)).body.item;
 await f.drain();
 expect(complete).toHaveBeenCalledTimes(10);
 const c=(await taskRecord(f.local.database,f.workspace.id,task.id)).value;
 expect(c.state).toBe('paused');expect(c.checkpoint).toContain('今日小竹用量已达上限');expect(c.platform!.failures??0).toBe(0);
 expect(JSON.stringify((await f.create('platform').expect(429)).body)).toContain('用量已达上限');
 const now=Date.now(),today=await agentDailyUsage(f.local.database,f.workspace.id,'local-operator',now),tomorrow=await agentDailyUsage(f.local.database,f.workspace.id,'local-operator',now+86400_000);
 expect(today).toMatchObject({turns:10,companyTurns:10,tasks:1});expect(tomorrow).toMatchObject({turns:0,companyTurns:0,tasks:0});
});

it('applies the company cap across everyone and shows it to the company admin',async()=>{
 vi.stubEnv('MIST_AGENT_DAILY_TURNS_PER_COMPANY','10');
 let mail='';const complete=vi.fn(async()=>tool('bambook_get',{type:'email',id:mail}));const f=await fixture(complete);mail=f.workspace.state.email.messages[0].id;f.worker.start(3_600_000);
 await f.create('platform').expect(201);await f.drain();
 expect(complete).toHaveBeenCalledTimes(10);
 expect(JSON.stringify((await f.create('platform').expect(429)).body)).toContain('公司今日小竹用量已达上限');
 const usage=(await f.human.get(f.base+'/personal-agent/usage?month='+new Date().toISOString().slice(0,7)).expect(200)).body;
 if(usage.scope==='company')expect(usage.today).toMatchObject({companyTurns:10,companyTurnLimit:10});
});

it('allows the last model turn after automatic order preparation and counts only the model plan',async()=>{
 vi.stubEnv('MIST_AGENT_DAILY_TURNS_PER_USER','10');
 let mail='',turn=0;
 const complete=vi.fn(async()=>++turn<=8
  ?tool('bambook_get',{type:'email',id:mail})
  :tool('bambook_task',{action:'finish',outcome:'succeeded',result:'已核对原件。'}));
 const f=await fixture(complete);mail=f.workspace.state.email.messages[0].id;
 f.worker.start(3_600_000);
 await f.create('platform').expect(201);await f.drain();
 expect(complete).toHaveBeenCalledTimes(9);
 const order=f.workspace.state.orders[0];
 const {item}=(await f.human.post(f.base+'/personal-agent/tasks').send({requestId:randomUUID(),name:'核对关联订单',
  instructions:'只读核对关联的模拟订单。',intentRefs:[{kind:'orders',id:order.id}],
 }).expect(201)).body;
 await f.drain();
 expect(complete).toHaveBeenCalledTimes(10);
 const done=(await f.human.get(f.base+'/agent-tasks/'+item.id).expect(200)).body.item;
 expect(done).toMatchObject({state:'succeeded',trail:[expect.objectContaining({kind:'read',completed:true})]});
 const {value}=await taskRecord(f.local.database,f.workspace.id,item.id);
 expect(value.platform?.steps.map(step=>step.prefetched)).toEqual([true,undefined]);
 const month=mistBusinessDate(new Date()).slice(0,7);
 const usage=(await f.human.get(f.base+'/personal-agent/usage?month='+month).expect(200)).body;
 expect(usage.today.turns).toBe(10);
 expect(usage.items).toMatchObject([{modelTurns:10}]);
 await f.create('platform').expect(429);
});

it.each([false,true])('reserves the last daily model turn for one task (first model fails: %s)',async firstFails=>{
 vi.stubEnv('MIST_AGENT_DAILY_TURNS_PER_USER','10');
 let clock=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>clock);
 let mail='',turn=0,finish!:()=>void;
 const gate=new Promise<void>(resolve=>{finish=resolve;});
 const report=tool('bambook_task',{action:'finish',outcome:'succeeded',result:'已核对原件。'});
 const complete=vi.fn(async()=>{
  if(++turn<=8)return tool('bambook_get',{type:'email',id:mail});
  if(turn===9)return report;
  const first=turn===10;
  await gate;
  if(first&&firstFails)throw Error('Synthetic provider failure');
  return report;
 });
 try{
  const f=await fixture(complete);mail=f.workspace.state.email.messages[0].id;
  f.worker.start(3_600_000);
  await f.create('platform').expect(201);await f.drain();
  const tasks=[];
  for(let i=0;i<2;i++)tasks.push((await f.create('platform').expect(201)).body.item.id as string);
  const current=()=>Promise.all(tasks.map(id=>taskRecord(f.local.database,f.workspace.id,id).then(({value})=>value)));
  await f.worker.tick();
  await vi.waitFor(async()=>{
   const records=await current();
   expect(complete.mock.calls.length>10||records.some(task=>task.state==='queued'&&task.lastHeartbeatAt!==undefined)).toBe(true);
  });
  expect(complete).toHaveBeenCalledTimes(10);
  expect((await agentDailyUsage(f.local.database,f.workspace.id,'local-operator',clock)).turns).toBe(9);
  finish();await f.worker.settled();clock+=1001;await f.drain();
  expect((await current()).map(task=>task.state).sort()).toEqual([firstFails?'queued':'paused','succeeded']);
  expect(complete).toHaveBeenCalledTimes(firstFails?11:10);
  expect((await agentDailyUsage(f.local.database,f.workspace.id,'local-operator',clock)).turns).toBe(10);
 }finally{finish();}
});

it('counts a model plan the day its call started even if saved after Shanghai midnight',async()=>{
 const start=Date.parse('2026-11-28T15:59:59Z');
 let clock=start;vi.spyOn(Date,'now').mockImplementation(()=>clock);
 const f=await fixture(async()=>{
  clock=start+2000;
  return tool('bambook_task',{action:'finish',outcome:'succeeded',result:'已核对原件。'});
 });
 f.worker.start(3_600_000);
 await f.create('platform').expect(201);await f.drain();
 expect((await agentDailyUsage(f.local.database,f.workspace.id,'local-operator',start)).turns).toBe(1);
 expect((await agentDailyUsage(f.local.database,f.workspace.id,'local-operator',clock)).turns).toBe(0);
});
