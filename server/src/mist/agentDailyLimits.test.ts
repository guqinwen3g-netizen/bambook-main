import{afterEach,beforeEach,expect,it,vi}from'vitest';
import request from'supertest';
import{mkdtemp,rm}from'node:fs/promises';
import{tmpdir}from'node:os';import path from'node:path';import{randomUUID}from'node:crypto';
import{createMistLocalRuntime}from'./local';import{createMistServer}from'./server';
import type{MistPlatformTaskWorker}from'./platformTaskWorker';
import type{LlmCompletionInput}from'../ai/llmProviders';
import{agentDailyUsage,taskRecord}from'./agentTasks';
import{agentDailyLimits}from'./agentLimits';
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
