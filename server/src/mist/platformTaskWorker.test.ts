import{afterEach,beforeEach,expect,it,vi}from'vitest';
import request from'supertest';
import{mkdtemp,rm}from'node:fs/promises';
import{tmpdir}from'node:os';import path from'node:path';import{randomUUID}from'node:crypto';
import{createMistLocalRuntime}from'./local';import{createMistServer}from'./server';
import{SERVICE_KEY_HEADER}from'./agentIdentities';
import type{MistPlatformTaskWorker}from'./platformTaskWorker';
import type{MistRepository}from'./repository';
import type{LlmCompletionInput}from'../ai/llmProviders';
let directory:string;const workers:MistPlatformTaskWorker[]=[];
beforeEach(async()=>{directory=await mkdtemp(path.join(tmpdir(),'platform-agent-'));vi.stubEnv('MIST_LOCAL_WORKSPACE','1');vi.stubEnv('NODE_ENV','test');});
afterEach(async()=>{await Promise.all(workers.splice(0).map(w=>w.stop()));vi.restoreAllMocks();vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});});
async function fixture(complete:(input:LlmCompletionInput)=>Promise<string>,options:{ceiling?:{value:string[]|null};mode?:'read'|'operate'}={}){
 const local=createMistLocalRuntime({directory});if(options.ceiling){const authorize=local.authorize;local.authorize=(db,prior,permission)=>authorize(db,options.ceiling!.value===null?prior:{...prior,permissionCeiling:options.ceiling!.value},permission);}
 const app=createMistServer(undefined,{local,agentTasks:{complete,tickMs:3_600_000,pulseMs:20}}),human=request.agent(app);await human.get('/api/mist/session').expect(200);
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
it('does not take over external tasks and does not promise unavailable platform execution',async()=>{
 const complete=vi.fn(async()=>tool('bambook_task',{action:'finish',outcome:'succeeded',result:'核对结束。'})),f=await fixture(complete);
 await f.human.post(f.base+'/agent-tasks').send({requestId:randomUUID(),identityId:f.id,name:'平台任务',instructions:'核对资料。',executor:'platform'}).expect(503);
 const external=await f.create();f.worker.start(3_600_000);expect((await f.human.get(f.base+'/agent-task-capabilities').expect(200)).body.platformAvailable).toBe(true);await f.drain();expect(complete).not.toHaveBeenCalled();expect((await f.current(external.id)).state).toBe('queued');
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
