import{afterEach,beforeEach,expect,it,vi}from'vitest';
import request from'supertest';
import{mkdtemp,rm}from'node:fs/promises';
import{tmpdir}from'node:os';import path from'node:path';import{randomUUID}from'node:crypto';
import{createMistLocalRuntime}from'./local';import{createMistServer}from'./server';
import{SERVICE_KEY_HEADER}from'./agentIdentities';
import type{MistPlatformTaskWorker}from'./platformTaskWorker';
import {platformTaskClock}from'./platformTaskWorker';
import type{MistRepository}from'./repository';
import type{LlmCompletionInput}from'../ai/llmProviders';
import{taskRecord}from'./agentTasks';
let directory:string;const workers:MistPlatformTaskWorker[]=[];
beforeEach(async()=>{directory=await mkdtemp(path.join(tmpdir(),'platform-agent-'));vi.stubEnv('MIST_LOCAL_WORKSPACE','1');vi.stubEnv('NODE_ENV','test');});
afterEach(async()=>{await Promise.all(workers.splice(0).map(w=>w.stop()));vi.restoreAllMocks();vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});});
async function fixture(complete:(input:LlmCompletionInput)=>Promise<string>,options:{ceiling?:{value:string[]|null};mode?:'read'|'operate';concurrency?:number}={}){
 const local=createMistLocalRuntime({directory});if(options.ceiling){const authorize=local.authorize;local.authorize=(db,prior,permission)=>authorize(db,options.ceiling!.value===null?prior:{...prior,permissionCeiling:options.ceiling!.value},permission);}
 const app=createMistServer(undefined,{local,agentTasks:{complete,tickMs:3_600_000,pulseMs:20,concurrency:options.concurrency}}),human=request.agent(app);await human.get('/api/mist/session').expect(200);
 const workspace=(await human.get('/api/mist/workspaces/default').expect(200)).body.workspace,base='/api/mist/workspaces/'+workspace.id,id=randomUUID();
 await human.post(base+'/agent-identities').send({id,name:'业务助理',ownerId:'local-operator',mode:options.mode??'operate'}).expect(201);
 const key=(await human.post(base+'/agent-identities/'+id+'/issue').send({requestId:randomUUID(),version:1}).expect(200)).body.token;
 const worker=app.locals.platformTaskWorker as MistPlatformTaskWorker,repository=app.locals.mistRepository as MistRepository;workers.push(worker);
 const create=async(executor?:'platform',locale?:'zh-CN'|'en-US')=>(await human.post(base+'/agent-tasks').send({requestId:randomUUID(),identityId:id,name:'核对来信',instructions:'核对当前来信，缺少依据先问本人，任何移动都先交本人确认。',...(executor?{executor,...(locale?{locale}:{})}:{})}).expect(201)).body.item;
 const current=async(taskId:string)=>(await human.get(base+'/agent-tasks/'+taskId).expect(200)).body.item;
 const command=async(type:string,payload:any)=>{const w=(await human.get(base).expect(200)).body.workspace;return human.post(base+'/commands').send({requestId:randomUUID(),expectedRevision:w.revision,command:{type,payload}}).expect(200);};
 const drain=async()=>{await worker.tick();await worker.settled();};
 return{local,app,human,workspace,base,id,key,worker,repository,create,current,command,drain};
}
const tool=(name:string,args:Record<string,unknown>)=>JSON.stringify({name,arguments:args});

it.each(['rejected','confirmed'] as const)('distinguishes an owner refusal from a genuine failed finish (%s)',async decision=>{
 let calls=0,customer='';const complete=vi.fn(async()=>[tool('bambook_get',{type:'customer',id:customer}),tool('bambook_execute',{command:{type:'customer.update',payload:{id:customer,patch:{terms:'T/T 30% 预付'}}}}),tool('bambook_get',{type:'customer',id:customer}),tool('bambook_task',{action:'finish',outcome:'stopped',result:'本人拒绝后已停止，原业务未修改。'}),tool('bambook_task',{action:'finish',outcome:'failed',result:'没有本人拒绝依据，不能报告为按本人决定停止。'})][calls++]);
 const f=await fixture(complete);customer=f.workspace.state.customers[0].id;f.worker.start(3_600_000);const task=await f.create('platform');await f.drain();const waiting=await f.current(task.id);expect(waiting.state).toBe('waiting_human');await f.command('agent.proposal.'+(decision==='rejected'?'reject':'confirm'),{id:waiting.waitingProposalIds[0]});await f.drain();
 const ended=await f.current(task.id);expect(ended.state).toBe(decision==='rejected'?'cancelled':'failed');expect(ended.stopReason).toBe(decision==='rejected'?'owner_declined':undefined);const notices=(await f.human.get(f.base+'/agent-task-notices').expect(200)).body.items;expect(notices.find((n:any)=>n.taskId===task.id)?.title).toBe(decision==='rejected'?'Agent已按本人决定停止':'Agent执行失败');
});

it('requires a fresh business read before reporting an owner-declined stop',async()=>{
 let calls=0,customer='';const complete=vi.fn(async()=>[tool('bambook_get',{type:'customer',id:customer}),tool('bambook_execute',{command:{type:'customer.update',payload:{id:customer,patch:{terms:'T/T 30% 预付'}}}}),tool('bambook_task',{action:'finish',outcome:'stopped',result:'本人拒绝，停止。'}),tool('bambook_get',{type:'customer',id:customer}),tool('bambook_task',{action:'finish',outcome:'stopped',result:'已读回原客户，按本人拒绝停止，未修改业务。'})][calls++]);
 const f=await fixture(complete);customer=f.workspace.state.customers[0].id;f.worker.start(3_600_000);const task=await f.create('platform');await f.drain();const before=(await f.human.get(f.base).expect(200)).body.workspace.state.customers.find((c:any)=>c.id===customer);await f.command('agent.proposal.reject',{id:(await f.current(task.id)).waitingProposalIds[0]});await f.drain();expect(await f.current(task.id)).toMatchObject({state:'cancelled',stopReason:'owner_declined'});expect(complete).toHaveBeenCalledTimes(5);expect((await f.human.get(f.base).expect(200)).body.workspace.state.customers.find((c:any)=>c.id===customer)).toEqual(before);
});
it('provides a real offset-qualified business clock across a UTC month boundary without changing the instant',()=>{
 const now=Date.parse('2026-10-31T16:00:00Z'),clock=platformTaskClock(now);expect(clock).toEqual({now:'2026-11-01T00:00:00.000+08:00',utc:'2026-10-31T16:00:00.000Z',timeZone:'Asia/Shanghai'});expect(Date.parse(clock.now)).toBe(now);expect(Date.parse(clock.utc)).toBe(now);
});
it.each([true,false])('supplies the company business date separately from real task time (fixed=%s)',async fixed=>{
 let customer='',calls=0;const complete=vi.fn(async(_input:LlmCompletionInput)=>calls++===0?tool('bambook_get',{type:'customer',id:customer}):tool('bambook_task',{action:'finish',outcome:'succeeded',result:'已核对客户资料。'})),f=await fixture(complete);customer=f.workspace.state.customers[0].id;
 const businessAt='2026-10-08T00:18:00.000Z';
 if(fixed)await f.local.database.$transaction(async db=>{await db.mistWorkspace.update({where:{id:f.workspace.id},data:{state:{...f.workspace.state,settings:{...f.workspace.state.settings,businessClock:{mode:'fixed',at:businessAt,timezone:'Asia/Shanghai'}}}}});});
 const started=Date.now();f.worker.start(3_600_000);const task=await f.create('platform');await f.drain();
 const message=String(complete.mock.calls[0][0].messages[0].content),facts=JSON.parse(message.slice(message.indexOf('{"task":')));
 expect(Date.parse(facts.clock.utc)).toBeGreaterThanOrEqual(started);expect(Date.parse(task.expiresAt)).toBeGreaterThan(started+23*60*60_000);
 if(fixed){expect(facts.businessClock.now).toBe('2026-10-08T08:18:00.000+08:00');expect(facts.businessClock.utc).toBe(businessAt);}else expect(Math.abs(Date.parse(facts.businessClock.utc)-Date.parse(facts.clock.utc))).toBeLessThan(1000);
 expect(await f.current(task.id)).toMatchObject({state:'succeeded'});
});
async function usedBudget(f:Awaited<ReturnType<typeof fixture>>,id:string,milliseconds:number){
 await f.local.database.$transaction(async db=>{const{row,value:c}=await taskRecord(db,f.workspace.id,id);await db.mistCommandReceipt.updateMany({where:{id:row.id},data:{result:{revision:0,__agentTask:{...c,version:c.version+1,runtimeUsedMs:milliseconds}}}});});
}
it('continues queued work behind exhausted runtime records without resetting their budgets or business data',async()=>{
 let count=0,mail='';const complete=vi.fn(async()=>++count===1?tool('bambook_get',{type:'email',id:mail}):tool('bambook_task',{action:'finish',outcome:'succeeded',result:'已只读核对。'})),f=await fixture(complete);mail=f.workspace.state.email.messages[0].id;f.worker.start(3_600_000);
 const first=await f.create('platform'),second=await f.create('platform');await usedBudget(f,first.id,first.runtimeLimitMs);await usedBudget(f,second.id,second.runtimeLimitMs);const later=await f.create('platform'),before=(await f.human.get(f.base).expect(200)).body.workspace;
 await f.drain();expect((await f.current(later.id)).state).toBe('succeeded');expect(complete).toHaveBeenCalledTimes(2);
 for(const task of[first,second]){const c=(await taskRecord(f.local.database,f.workspace.id,task.id)).value;expect(c.runtimeUsedMs).toBe(task.runtimeLimitMs);expect(c.platform!.nextRunAt).toBeGreaterThanOrEqual(c.expiresAt);expect((await f.current(task.id)).state).toBe('budget_exhausted');}
 expect((await f.human.get(f.base).expect(200)).body.workspace).toEqual(before);
});
it('recognizes runtime consumed by an expired lease and preserves a read limit reminder while advancing the queue',async()=>{
 const clock=Date.now();vi.spyOn(Date,'now').mockReturnValue(clock);let count=0,mail='';const complete=vi.fn(async()=>++count===1?tool('bambook_get',{type:'email',id:mail}):tool('bambook_task',{action:'finish',outcome:'succeeded',result:'已只读核对。'})),f=await fixture(complete,{concurrency:1});mail=f.workspace.state.email.messages[0].id;f.worker.start(3_600_000);
 const old=await f.create('platform');await usedBudget(f,old.id,old.runtimeLimitMs-1000);const job=(await f.repository.duePlatformTasks())[0];await f.repository.claimPlatformTask(job,'expired-run',f.local.agentDelegation.makeTaskCredential);vi.spyOn(Date,'now').mockReturnValue(clock+1001);
 const later=await f.create('platform'),notice=(await f.human.get(f.base+'/agent-task-notices').expect(200)).body.items.find((n:any)=>n.taskId===old.id);expect(notice.title).toBe('Agent任务达到限额');await f.human.post(f.base+'/agent-task-notices/read').send({items:[{taskId:notice.taskId,key:notice.key}]}).expect(200);
 const before=(await f.human.get(f.base).expect(200)).body.workspace;await f.drain();expect((await f.current(later.id)).state).toBe('succeeded');expect(complete).toHaveBeenCalledTimes(2);const kept=(await f.human.get(f.base+'/agent-task-notices').expect(200)).body.items.find((n:any)=>n.taskId===old.id);expect(kept.id).toBe(notice.id);expect(kept.readAt).toBeTruthy();expect((await f.current(old.id)).runtimeUsedMs).toBe(old.runtimeLimitMs);expect((await f.human.get(f.base).expect(200)).body.workspace).toEqual(before);
});
it('does not spin or invoke the model when a concurrent metadata change leaves the same spent candidate visible',async()=>{
 const complete=vi.fn(async()=>''),job={workspaceId:randomUUID(),taskId:randomUUID(),ownerId:'owner',version:1,exhausted:true},due=vi.fn(async()=>[job]),defer=vi.fn(async()=>{});
 const {MistPlatformTaskWorker}=await import('./platformTaskWorker');const worker=new MistPlatformTaskWorker({duePlatformTasks:due,duePlatformTaskConditions:async()=>[],deferPlatformTaskJob:defer}as unknown as MistRepository,{complete,makeCredential:()=>'',tickMs:3_600_000});workers.push(worker);worker.start(3_600_000);await worker.tick();await worker.settled();expect(due.mock.calls.length).toBeLessThanOrEqual(2);expect(defer).toHaveBeenCalledTimes(1);expect(complete).not.toHaveBeenCalled();
});
it('starts other owners before a second task from someone who already has work running',async()=>{
 const job=(owner:string,n:number)=>({workspaceId:'w',taskId:owner+n,ownerId:owner,version:1});
 const queue=[job('a',1),job('a',2),job('a',3),job('b',1),job('c',1)],due=vi.fn(async(_now:number,take:number)=>queue.slice(0,take));
 const {MistPlatformTaskWorker}=await import('./platformTaskWorker');const worker=new MistPlatformTaskWorker({duePlatformTasks:due,duePlatformTaskConditions:async()=>[],deferPlatformTaskJob:async()=>{}}as unknown as MistRepository,{complete:async()=>'',makeCredential:()=>'',tickMs:3_600_000,concurrency:2});workers.push(worker);
 const started:string[]=[],release:Array<()=>void>=[];vi.spyOn(worker as any,'perform').mockImplementation((j:any)=>{started.push(j.taskId);return new Promise<void>(r=>release.push(r));});
 worker.start(3_600_000);await worker.tick();expect(started).toEqual(['a1','b1']);
 release.splice(1,1)[0]();await new Promise(r=>setTimeout(r,0));queue.splice(0,1);queue.splice(2,1);await worker.tick();expect(started).toEqual(['a1','b1','c1']);
 release.forEach(r=>r());
});
it('releases timed waits for other work, wakes on the same budget and requires fresh business facts before completion',async()=>{
 let count=0,mail='';const replies=()=>[tool('bambook_get',{type:'email',id:mail}),tool('bambook_task',{action:'wait',delaySeconds:60,summary:'到约定时间重新核对。'}),tool('bambook_get',{type:'email',id:mail}),tool('bambook_task',{action:'finish',outcome:'succeeded',result:'其他任务已核对。'}),tool('bambook_task',{action:'status'}),tool('bambook_task',{action:'finish',outcome:'succeeded',result:'旧上下文不能直接结束。'}),tool('bambook_get',{type:'email',id:mail}),tool('bambook_task',{action:'finish',outcome:'succeeded',result:'已按当前原件核对。'})];const complete=vi.fn(async()=>replies()[count++]);
 const f=await fixture(complete,{concurrency:1});mail=f.workspace.state.email.messages[0].id;const clock=Date.now(),now=vi.spyOn(Date,'now').mockReturnValue(clock);f.worker.start(3_600_000);const first=await f.create('platform');await f.drain();const waiting=await f.current(first.id);expect(waiting.state).toBe('waiting_time');expect(complete).toHaveBeenCalledTimes(2);const before=(await f.human.get(f.base).expect(200)).body.workspace;
 const second=await f.create('platform');await f.drain();expect((await f.current(second.id)).state).toBe('succeeded');expect((await f.current(first.id)).state).toBe('waiting_time');now.mockReturnValue(clock+59999);await f.drain();expect(complete).toHaveBeenCalledTimes(4);now.mockReturnValue(clock+60001);await f.drain();expect((await f.current(first.id)).state).toBe('succeeded');expect(complete).toHaveBeenCalledTimes(8);const recovered=(await taskRecord(f.local.database,f.workspace.id,first.id)).value;expect(recovered.platform!.steps[2].result).toMatchObject({error:true,message:expect.stringContaining('任务状态不算回源读取')});expect((await f.current(first.id)).runtimeUsedMs).toBe(waiting.runtimeUsedMs);expect((await f.human.get(f.base).expect(200)).body.workspace).toEqual(before);
});
it('does not take over external tasks and does not promise unavailable platform execution',async()=>{
 const complete=vi.fn(async()=>tool('bambook_task',{action:'finish',outcome:'succeeded',result:'核对结束。'})),f=await fixture(complete);
 await f.human.post(f.base+'/agent-tasks').send({requestId:randomUUID(),identityId:f.id,name:'平台任务',instructions:'核对资料。',executor:'platform'}).expect(503);
 const external=await f.create();f.worker.start(3_600_000);expect((await f.human.get(f.base+'/agent-task-capabilities').expect(200)).body.platformAvailable).toBe(true);await f.drain();expect(complete).not.toHaveBeenCalled();expect((await f.current(external.id)).state).toBe('queued');
});
it('checks unchanged conditions without spending a model slot, then rereads the exact changed original before reporting',async()=>{
 let count=0,mail='',other='';const replies=()=>[
  tool('bambook_get',{type:'email',id:mail}),tool('bambook_task',{action:'wait',delaySeconds:120,condition:{type:'email',id:mail},summary:'等待原邮件变化。'}),
  tool('bambook_get',{type:'email',id:other}),tool('bambook_task',{action:'finish',outcome:'succeeded',result:'其他任务已核对。'}),
  tool('bambook_task',{action:'status'}),tool('bambook_get',{type:'email',id:other}),tool('bambook_task',{action:'finish',outcome:'succeeded',result:'另一封邮件不能代替原件。'}),
  tool('bambook_get',{type:'email',id:mail}),tool('bambook_task',{action:'finish',outcome:'succeeded',result:'已重读变化后的原邮件。'})];
 const complete=vi.fn(async()=>replies()[count++]),f=await fixture(complete,{concurrency:1});mail=f.workspace.state.email.messages[0].id;other=f.workspace.state.email.messages[1].id;const starred=f.workspace.state.email.messages[0].starred,clock=Date.now(),now=vi.spyOn(Date,'now').mockReturnValue(clock);f.worker.start(3_600_000);
 const watched=await f.create('platform');await f.drain();const waiting=await f.current(watched.id);expect(waiting.state).toBe('waiting_condition');expect(complete).toHaveBeenCalledTimes(2);
 now.mockReturnValue(clock+30001);const later=await f.create('platform');await f.drain();expect(complete).toHaveBeenCalledTimes(4);expect((await f.current(later.id)).state).toBe('succeeded');expect((await f.current(watched.id)).state).toBe('waiting_condition');
 now.mockReturnValue(clock+59000);await f.command('email.flag',{id:mail,flag:'starred',value:!starred});const business=(await f.human.get(f.base).expect(200)).body.workspace;now.mockReturnValue(clock+60002);
 await f.drain();expect(complete).toHaveBeenCalledTimes(9);const ended=await f.current(watched.id);expect(ended).toMatchObject({state:'succeeded',requiredRead:null,runtimeUsedMs:waiting.runtimeUsedMs,expiresAt:waiting.expiresAt});
 const record=(await taskRecord(f.local.database,f.workspace.id,watched.id)).value;expect(record.platform!.steps[2].result).toMatchObject({error:true});expect(record.platform!.steps[4].result).toMatchObject({error:true});expect((record.platform!.steps[5].result as any).object.data.starred).toBe(!starred);expect((await f.human.get(f.base).expect(200)).body.workspace).toEqual(business);
});
it('does not inspect or resume a waiting condition under lost scope or a revoked original service credential',async()=>{
 let mail='',calls=0;const ceiling:{value:string[]|null}={value:null},complete=vi.fn(async()=>++calls===1?tool('bambook_get',{type:'email',id:mail}):tool('bambook_task',{action:'wait',delaySeconds:600,condition:{type:'email',id:mail},summary:'等待原邮件变化。'}));
 const f=await fixture(complete,{ceiling});mail=f.workspace.state.email.messages[0].id;const clock=Date.now(),now=vi.spyOn(Date,'now').mockReturnValue(clock);f.worker.start(3_600_000);const task=await f.create('platform');await f.drain();expect(complete).toHaveBeenCalledTimes(2);
 ceiling.value=['ai:chat'];now.mockReturnValue(clock+30001);await f.drain();const hidden=await f.current(task.id);expect(hidden).toMatchObject({state:'access_changed',instructions:'',waitingFor:null,requiredRead:null});expect(complete).toHaveBeenCalledTimes(2);
 ceiling.value=null;await f.human.post(f.base+'/agent-identities/'+f.id+'/revoke').send({requestId:randomUUID()}).expect(200);now.mockReturnValue(clock+340000);await f.drain();expect(complete).toHaveBeenCalledTimes(2);const revoked=await f.current(task.id);expect(revoked.state).toBe('access_changed');
 await f.human.post(f.base+'/agent-tasks/'+task.id+'/cancel').send({requestId:randomUUID(),version:revoked.version}).expect(200);expect((await f.current(task.id))).toMatchObject({state:'cancelled',waitingFor:null,resumeAt:null});
});
it('checks a due condition while the only model slot is genuinely busy, without starting another model run',async()=>{
 let mail='',other='',calls=0,release!:(value:string)=>void;const held=new Promise<string>(resolve=>{release=resolve;});
 const complete=vi.fn(async()=>{calls++;if(calls===1||calls===5)return tool('bambook_get',{type:'email',id:mail});if(calls===2)return tool('bambook_task',{action:'wait',delaySeconds:120,condition:{type:'email',id:mail},summary:'等待原邮件变化。'});if(calls===3)return tool('bambook_get',{type:'email',id:other});if(calls===4)return held;return tool('bambook_task',{action:'finish',outcome:'succeeded',result:'已重读原件。'});});
 const f=await fixture(complete,{concurrency:1});mail=f.workspace.state.email.messages[0].id;other=f.workspace.state.email.messages[1].id;const starred=f.workspace.state.email.messages[0].starred,clock=Date.now(),now=vi.spyOn(Date,'now').mockReturnValue(clock);f.worker.start(3_600_000);
 const watched=await f.create('platform');await f.drain();const busy=await f.create('platform');await f.worker.tick();await vi.waitFor(()=>expect(complete).toHaveBeenCalledTimes(4));expect((await taskRecord(f.local.database,f.workspace.id,busy.id)).value.state).toBe('running');
 await f.command('email.flag',{id:mail,flag:'starred',value:!starred});now.mockReturnValue(clock+30001);await f.worker.tick();
 // Read the registry directly: a GET/detail refresh must not be what wakes this test task.
 expect((await taskRecord(f.local.database,f.workspace.id,watched.id)).value).toMatchObject({state:'queued',wakeReason:'changed',requiredRead:{type:'email',id:mail}});expect(complete).toHaveBeenCalledTimes(4);
 release(tool('bambook_task',{action:'finish',outcome:'succeeded',result:'已核对另一原件。'}));await f.worker.settled();await f.drain();expect((await f.current(watched.id)).state).toBe('succeeded');expect(complete).toHaveBeenCalledTimes(6);
});
it('keyset-scans later due conditions even when the oldest registration is already due again',async()=>{
 let mail='',calls=0;const complete=vi.fn(async()=>++calls%2?tool('bambook_get',{type:'email',id:mail}):tool('bambook_task',{action:'wait',delaySeconds:600,condition:{type:'email',id:mail},summary:'等待原邮件变化。'})),f=await fixture(complete);mail=f.workspace.state.email.messages[0].id;
 const clock=Date.now();vi.spyOn(Date,'now').mockReturnValue(clock);f.worker.start(3_600_000);for(let i=0;i<3;i++){await f.create('platform');await f.drain();}
 const first=(await f.repository.duePlatformTaskConditions(clock+30001,1))[0];expect(first.scanCursor).toBeTruthy();
 expect((await f.repository.duePlatformTaskConditions(clock+90001,1))[0].taskId).toBe(first.taskId);
 const second=(await f.repository.duePlatformTaskConditions(clock+90001,1,first.scanCursor))[0],third=(await f.repository.duePlatformTaskConditions(clock+90001,1,second.scanCursor))[0];expect(new Set([first.taskId,second.taskId,third.taskId]).size).toBe(3);expect(await f.repository.duePlatformTaskConditions(clock+90001,1,third.scanCursor)).toEqual([]);
});
it('runs actual typed MCP tools, durably asks the owner, preserves pause and waits for a separate business approval',async()=>{
 let index=0,mail='';const complete=vi.fn(async()=>[
  tool('bambook_get',{type:'email',id:mail}),tool('bambook_task',{action:'question',question:'请提供准确交期及书面依据。'}),
  tool('bambook_get',{type:'email',id:mail}),tool('bambook_execute',{command:{type:'email.move',payload:{id:mail,folder:'archive'}}}),tool('bambook_get',{type:'email',id:mail}),tool('bambook_task',{action:'finish',outcome:'succeeded',result:'已在本人确认后核对归档；未发信或办理资金。'})
 ][index++]);
 const f=await fixture(complete);mail=f.workspace.state.email.messages[0].id;f.worker.start(3_600_000);const task=await f.create('platform');expect(await f.repository.duePlatformTasks()).toHaveLength(1);
 await f.human.post(f.base+'/agent-tasks/'+task.id+'/issue').send({requestId:randomUUID(),version:task.version}).expect(403);
 await request(f.app).post(f.base+'/agent-tasks/'+task.id+'/claim').set(SERVICE_KEY_HEADER,f.key).send({requestId:randomUUID(),workerId:'external'}).expect(403);
 await f.drain();let state=await f.current(task.id);expect(state).toMatchObject({state:'waiting_human',executor:'platform'});expect(state.questions).toHaveLength(1);expect(complete).toHaveBeenCalledTimes(2);
 const paused=(await f.human.post(f.base+'/agent-tasks/'+task.id+'/pause').send({requestId:randomUUID(),version:state.version}).expect(200)).body.item;
 state=(await f.human.post(f.base+'/agent-tasks/'+task.id+'/answer').send({requestId:randomUUID(),version:paused.version,questionId:state.questions[0].id,answer:'请先核对归档，移动仍交本人确认。'}).expect(200)).body.item;expect(state.state).toBe('paused');await f.drain();expect(complete).toHaveBeenCalledTimes(2);
 await f.human.post(f.base+'/agent-tasks/'+task.id+'/resume').send({requestId:randomUUID(),version:state.version}).expect(200);await f.drain();state=await f.current(task.id);expect(state.state).toBe('waiting_human');expect(state.waitingProposalIds).toHaveLength(1);
 expect((await f.human.get(f.base).expect(200)).body.workspace.state.email.messages.find((m:any)=>m.id===mail).folder).not.toBe('archive');
 await f.command('agent.proposal.confirm',{id:state.waitingProposalIds[0]});await f.drain();state=await f.current(task.id);expect(state.state).toBe('succeeded');expect(complete).toHaveBeenCalledTimes(6);
 const content=JSON.stringify(complete.mock.calls);expect(content).not.toContain(f.key);expect(content).not.toMatch(/bma1_|bmc1_|bmt1_|grantHash|credentialVersion/);expect(JSON.stringify(state)).not.toContain('platform_');
 const records=await f.local.database.mistCommandReceipt.findMany({where:{workspaceId:f.workspace.id}}),stored=records.find((r:any)=>r.result?.__agentTask?.id===task.id)!.result.__agentTask;expect(stored.platform.steps).toHaveLength(6);expect(stored.platform.steps.every((s:any)=>s.result!==undefined)).toBe(true);
});
it('replays the frozen write after its receipt was committed but progress acknowledgment failed',async()=>{
 let index=0,mail='';const complete=vi.fn(async()=>[tool('bambook_get',{type:'email',id:mail}),tool('bambook_execute',{command:{type:'email.flag',payload:{id:mail,flag:'starred',value:true}}}),tool('bambook_task',{action:'finish',outcome:'succeeded',result:'已核对星标。'})][index++]);
 const f=await fixture(complete);mail=f.workspace.state.email.messages[0].id;f.worker.start(3_600_000);const task=await f.create('platform'),ack=f.repository.acknowledgePlatformTaskStep.bind(f.repository);let failed=false;
 vi.spyOn(f.repository,'acknowledgePlatformTaskStep').mockImplementation(async(actor,id,result:any)=>{if(result.receipt&&!failed){failed=true;throw Error('simulated acknowledgment interruption');}return ack(actor,id,result);});
 await f.drain();let records=await f.local.database.mistCommandReceipt.findMany({where:{workspaceId:f.workspace.id}}),stored=records.find((r:any)=>r.result?.__agentTask?.id===task.id)!.result.__agentTask;expect(stored.platform.steps.at(-1).result).toBeUndefined();expect(complete).toHaveBeenCalledTimes(2);
 await f.worker.stop();const restarted=createMistLocalRuntime({directory}),app2=createMistServer(undefined,{local:restarted,agentTasks:{complete,tickMs:3_600_000}}),worker2=app2.locals.platformTaskWorker as MistPlatformTaskWorker;workers.push(worker2);worker2.start(3_600_000);
 const clock=Date.now()+2000;vi.spyOn(Date,'now').mockReturnValue(clock);await worker2.tick();await worker2.settled();expect((await f.current(task.id)).state).toBe('succeeded');expect(complete).toHaveBeenCalledTimes(3);
 records=await f.local.database.mistCommandReceipt.findMany({where:{workspaceId:f.workspace.id}});expect(records.filter((r:any)=>r.requestId==='mcp-'+stored.platform.steps.at(-1).id)).toHaveLength(1);stored=records.find((r:any)=>r.result?.__agentTask?.id===task.id)!.result.__agentTask;expect(stored.stepsUsed).toBe(2);expect(stored.platform.steps[1].result.replayed).toBe(true);
});
it('ignores late model output after human stop, even when the model ignores its abort signal',async()=>{
 let resolve!:(text:string)=>void;const complete=vi.fn(()=>new Promise<string>(done=>{resolve=done;})),f=await fixture(complete);f.worker.start(3_600_000);const task=await f.create('platform');
 const before=(await f.human.get(f.base).expect(200)).body.workspace.state,job=(await f.repository.duePlatformTasks())[0];await f.worker.tick();await vi.waitFor(()=>expect(complete).toHaveBeenCalledTimes(1));await expect(f.repository.claimPlatformTask(job,'another-worker',f.local.agentDelegation.makeTaskCredential)).rejects.toMatchObject({code:'AGENT_TASK_BUSY'});
 const current=await f.current(task.id);await f.human.post(f.base+'/agent-tasks/'+task.id+'/cancel').send({requestId:randomUUID(),version:current.version}).expect(200);const stopped=(await f.human.get(f.base).expect(200)).body.workspace.state;await f.worker.stop();resolve(tool('bambook_execute',{command:{type:'email.flag',payload:{id:before.email.messages[0].id,flag:'starred',value:true}}}));await Promise.resolve();
 expect((await f.current(task.id)).state).toBe('cancelled');const after=(await f.human.get(f.base).expect(200)).body.workspace.state;expect(after).toEqual(stopped);expect(after.email).toEqual(before.email);
});
it('retries a model outage without clearing the task, then uses the saved request language',async()=>{
 let calls=0,mail='';const complete=vi.fn(async(_input:LlmCompletionInput)=>{calls++;if(calls===1)throw Error('model transport unavailable');return calls===2?tool('bambook_get',{type:'email',id:mail}):tool('bambook_task',{action:'finish',outcome:'succeeded',result:'Reviewed the original email; no business changes.'});});
 const f=await fixture(complete);mail=f.workspace.state.email.messages[0].id;f.worker.start(3_600_000);const task=await f.create('platform','en-US');await f.drain();let state=await f.current(task.id);expect(state.state).toBe('queued');expect(state.executionIssue.code).toBe('model_unavailable');await f.drain();expect(complete).toHaveBeenCalledTimes(1);
 vi.spyOn(Date,'now').mockReturnValue(Date.now()+30_000);await f.drain();state=await f.current(task.id);expect(state.state).toBe('succeeded');expect(state.executionIssue).toBeUndefined();expect(state.checkpoint).not.toContain('模型暂不可用');expect(complete.mock.calls[1][0].systemPrompt).toContain('Default response language: English');
 for(const [input] of complete.mock.calls){expect(input.messages[0].content).toMatch(/^Interface language: English \(en-US\)/);expect(input.messages[0].content).toContain('核对当前来信');}
});
it('pauses repeated invalid model output and allows explicit owner recovery on the same task',async()=>{
 let valid=false,mail='',read=false;const complete=vi.fn(async()=>!valid?'not a tool decision':!read?(read=true,tool('bambook_get',{type:'email',id:mail})):tool('bambook_task',{action:'finish',outcome:'succeeded',result:'已核对原邮件。'}));
 const f=await fixture(complete);mail=f.workspace.state.email.messages[0].id;f.worker.start(3_600_000);const task=await f.create('platform');let clock=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>clock);
 for(let i=0;i<3;i++){await f.drain();clock+=300_001;}let state=await f.current(task.id);expect(state.state).toBe('paused');expect(state.executionIssue).toEqual({code:'model_response_invalid'});await f.drain();expect(complete).toHaveBeenCalledTimes(3);valid=true;
 const resumed=await f.human.post(f.base+'/agent-tasks/'+task.id+'/resume').send({requestId:randomUUID(),version:state.version}).expect(200);expect(resumed.body.item).toMatchObject({state:'queued',checkpoint:''});await f.drain();expect((await f.current(task.id)).state).toBe('succeeded');
});
it('rechecks authority before saving a late model decision and retains owner cleanup after AI loss',async()=>{
 const ceiling:{value:string[]|null}={value:null};let resolve!:(text:string)=>void;const complete=vi.fn(()=>new Promise<string>(done=>{resolve=done;})),f=await fixture(complete,{ceiling});f.worker.start(3_600_000);const task=await f.create('platform'),before=f.workspace.state.email;
 await f.worker.tick();await vi.waitFor(()=>expect(complete).toHaveBeenCalledTimes(1));ceiling.value=[];resolve(tool('bambook_execute',{command:{type:'email.flag',payload:{id:before.messages[0].id,flag:'starred',value:true}}}));await f.worker.settled();const masked=await f.current(task.id);expect(masked).toMatchObject({state:'access_changed',instructions:'',questions:[]});
 await f.human.post(f.base+'/agent-tasks/'+task.id+'/cancel').send({requestId:randomUUID(),version:masked.version}).expect(200);ceiling.value=null;expect((await f.human.get(f.base).expect(200)).body.workspace.state.email).toEqual(before);
});
it('retains read-only service ceilings when the platform model asks to write',async()=>{
 let index=0,mail='';const complete=vi.fn(async()=>[tool('bambook_execute',{command:{type:'email.flag',payload:{id:mail,flag:'starred',value:true}}}),tool('bambook_get',{type:'email',id:mail}),tool('bambook_task',{action:'finish',outcome:'succeeded',result:'只读权限，未修改邮件。'})][index++]);
 const f=await fixture(complete,{mode:'read'});mail=f.workspace.state.email.messages[0].id;f.worker.start(3_600_000);const task=await f.create('platform');await f.drain();expect((await f.current(task.id)).state).toBe('succeeded');expect((await f.human.get(f.base).expect(200)).body.workspace.state.email).toEqual(f.workspace.state.email);
});
it('turns a business command the model executes into an owner proposal, waits for confirmation and then continues',async()=>{
 // customer.update 属中风险：平台执行器经 bambook_execute 只能得到 awaiting_confirmation 提议，本人确认后任务继续，不能直接改客户。
 let index=0,customer='';const complete=vi.fn(async()=>[
  tool('bambook_get',{type:'customer',id:customer}),tool('bambook_execute',{command:{type:'customer.update',payload:{id:customer,patch:{terms:'T/T 30% 预付'}}}}),tool('bambook_get',{type:'customer',id:customer}),tool('bambook_task',{action:'finish',outcome:'succeeded',result:'本人确认后已核对付款条件。'})
 ][index++]);
 const f=await fixture(complete);customer=f.workspace.state.customers[0].id;const original=f.workspace.state.customers[0].terms;f.worker.start(3_600_000);const task=await f.create('platform');
 await f.drain();let state=await f.current(task.id);expect(state.state).toBe('waiting_human');expect(state.waitingProposalIds).toHaveLength(1);expect(complete).toHaveBeenCalledTimes(2);
 let ws=(await f.human.get(f.base).expect(200)).body.workspace.state;expect(ws.customers.find((c:any)=>c.id===customer).terms).toBe(original);
 expect(ws.agentProposals.find((p:any)=>p.id===state.waitingProposalIds[0])).toMatchObject({state:'pending',taskId:task.id,command:{type:'customer.update'}});
 await f.command('agent.proposal.confirm',{id:state.waitingProposalIds[0]});await f.drain();state=await f.current(task.id);expect(state.state).toBe('succeeded');expect(complete).toHaveBeenCalledTimes(4);
 ws=(await f.human.get(f.base).expect(200)).body.workspace.state;expect(ws.customers.find((c:any)=>c.id===customer).terms).toBe('T/T 30% 预付');
});
it.each([false,true])('keeps a valid development draft proposal visible across reads and rejects stale source (changed: %s)',async changed=>{
 let calls=0,draft='';const values={name:'大衣',customer:'Cedar & Crown',style:'',season:'',category:'',kind:'new',fabric:'',color:'',target:'',sizeBase:'',goal:'',factories:[],due:'',collaborators:[],sampleQuantity:1};
 const complete=vi.fn(async()=>++calls===1||calls===3?tool('bambook_get',{type:'development_draft',id:draft}):calls===2?tool('bambook_execute',{command:{type:'development.saveDraft',payload:{draftId:draft,values:{...values,style:'NW-31'},fileIds:[]}}}):tool('bambook_task',{action:'finish',outcome:'succeeded',result:'草稿已核对。'}));
 const ceiling:{value:string[]|null}={value:null};const f=await fixture(complete,{ceiling});draft=(await f.command('development.saveDraft',{values,fileIds:[]})).body.receipt.result.draftId;f.worker.start(3_600_000);const task=await f.create('platform');await f.drain();expect((await f.current(task.id)).state).toBe('waiting_human');
 const direct=(await f.human.get(f.base).expect(200)).body.workspace,proposal=direct.state.agentProposals.find((p:any)=>p.taskId===task.id);expect(proposal.unavailable).not.toBe(true);
 for(const ws of [(await f.human.get('/api/mist/workspaces/default').expect(200)).body.workspace,...(await f.human.get('/api/mist/workspaces').expect(200)).body.workspaces]){
  if(ws.id===f.workspace.id)expect(ws.state.agentProposals.find((p:any)=>p.id===proposal.id)).toMatchObject({command:{type:'development.saveDraft'}});
 }
 ceiling.value=['ai:chat','products:read','products:write'];const hidden=(await f.human.get('/api/mist/workspaces/default').expect(200)).body.workspace.state.agentProposals.find((p:any)=>p.id===proposal.id);expect(hidden).toMatchObject({unavailable:true,command:{type:'unavailable',payload:{}}});ceiling.value=null;
 expect(direct.state.drafts.find((d:any)=>d.id===draft).values.style).toBe('');if(changed){
  await f.command('development.saveDraft',{draftId:draft,values:{...values,style:'HUMAN-EDIT'},fileIds:[]});const before=(await f.human.get(f.base).expect(200)).body.workspace;
  const rejected=await f.human.post(f.base+'/commands').send({requestId:randomUUID(),expectedRevision:before.revision,command:{type:'agent.proposal.confirm',payload:{id:proposal.id}}});expect(rejected.status).toBe(409);
  const after=(await f.human.get(f.base).expect(200)).body.workspace;expect(after.state.drafts.find((d:any)=>d.id===draft).values.style).toBe('HUMAN-EDIT');expect(after.revision).toBe(before.revision);return;
 }
 await f.command('agent.proposal.confirm',{id:proposal.id});await f.drain();const after=(await f.human.get(f.base).expect(200)).body.workspace;expect(after.state.drafts.find((d:any)=>d.id===draft).values.style).toBe('NW-31');expect(after.state.drafts).toHaveLength(direct.state.drafts.length);expect(after.state.devs).toHaveLength(direct.state.devs.length);
});
