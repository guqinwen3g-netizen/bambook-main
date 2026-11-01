import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import request from 'supertest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createMistLocalRuntime} from './local';
import {createMistServer} from './server';
import {SERVICE_KEY_HEADER} from './agentIdentities';
import {TASK_HEADER,taskRecord} from './agentTasks';
import {taskNotice,taskNoticeCandidates} from './agentTaskAttention';

let directory:string;
beforeEach(async()=>{directory=await mkdtemp(path.join(tmpdir(),'task-notices-'));vi.stubEnv('MIST_LOCAL_WORKSPACE','1');vi.stubEnv('NODE_ENV','test');});
afterEach(async()=>{vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});});
async function fixture(){
 const local=createMistLocalRuntime({directory}),ceiling:{value:string[]|null}={value:null},authorize=local.authorize;local.authorize=(db,prior,permission)=>authorize(db,ceiling.value===null?prior:{...prior,permissionCeiling:ceiling.value},permission);
 const app=createMistServer(undefined,{local}),human=request.agent(app);await human.get('/api/mist/session').expect(200);
 const workspace=(await human.get('/api/mist/workspaces/default').expect(200)).body.workspace,base='/api/mist/workspaces/'+workspace.id,identityId=randomUUID();
 await human.post(base+'/agent-identities').send({id:identityId,name:'业务助理',ownerId:'local-operator',mode:'read'}).expect(201);
 const key=(await human.post(base+'/agent-identities/'+identityId+'/issue').send({requestId:randomUUID(),version:1}).expect(200)).body.token;
 const task=(await human.post(base+'/agent-tasks').send({requestId:randomUUID(),identityId,name:'核对交期',instructions:'只读核对交期，缺依据请问本人。'}).expect(201)).body.item;
 const token=(await request(app).post(base+'/agent-tasks/'+task.id+'/claim').set(SERVICE_KEY_HEADER,key).send({requestId:randomUUID(),workerId:'test-reader'}).expect(200)).body.token;
 const question=(await request(app).post('/api/mist/mcp').set(TASK_HEADER,token).send({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'bambook_task',arguments:{workspaceId:workspace.id,taskId:task.id,action:'question',requestId:randomUUID(),question:'请提供工厂书面确认。'}}}).expect(200)).body.result;
 expect(question.isError).not.toBe(true);
 const notices=async()=> (await human.get(base+'/agent-task-notices').expect(200)).body.items;
 const current=async()=> (await human.get(base+'/agent-tasks/'+task.id).expect(200)).body.item;
 const read=(items:any[],status=200)=>human.post(base+'/agent-task-notices/read').send({items}).expect(status);
 return{local,app,human,workspace,base,key,task,ceiling,notices,current,read};
}
it('persists owner read state across a new runtime without changing business, task control or an unanswered question',async()=>{
 const f=await fixture(),before=(await f.human.get(f.base).expect(200)).body.workspace,notice=(await f.notices())[0],task=await f.current();
 expect(notice).toMatchObject({title:'Agent待补充资料',detail:'核对交期',readAt:null,target:{view:'account',id:f.task.id,section:'agents'}});expect(JSON.stringify(notice)).not.toContain('请提供工厂');
 await f.read([{taskId:notice.taskId,key:notice.key}]);const read=(await f.notices())[0];expect(read.id).toBe(notice.id);expect(read.readAt).toBeTruthy();
 await f.read([{taskId:notice.taskId,key:notice.key}]);expect((await f.notices())[0].readAt).toBe(read.readAt);expect(await f.current()).toEqual(task);expect((await f.human.get(f.base).expect(200)).body.workspace).toEqual(before);
 const local=createMistLocalRuntime({directory});await local.ready;const human=request.agent(createMistServer(undefined,{local}));await human.get('/api/mist/session').expect(200);expect((await human.get(f.base+'/agent-task-notices').expect(200)).body.items[0]).toEqual(read);
 await request(f.app).get(f.base+'/agent-task-notices').set(SERVICE_KEY_HEADER,f.key).expect(403);await request(f.app).get(f.base+'/agent-task-notices').expect(401);
 await request(f.app).post(f.base+'/agent-task-notices/read').set(SERVICE_KEY_HEADER,f.key).send({items:[{taskId:notice.taskId,key:notice.key}]}).expect(403);
 await f.human.get(f.base+'/agent-task-notices').query({ownerId:'other'}).expect(400);
});
it('does not manufacture new unread work when the owner pauses a question and rejects a stale read after answering',async()=>{
 const f=await fixture(),notice=(await f.notices())[0];await f.read([{taskId:notice.taskId,key:notice.key}]);let task=await f.current();
 await f.human.post(f.base+'/agent-tasks/'+task.id+'/pause').send({requestId:randomUUID(),version:task.version}).expect(200);expect((await f.notices())[0]).toMatchObject({id:notice.id,readAt:expect.any(String)});task=await f.current();
 await f.human.post(f.base+'/agent-tasks/'+task.id+'/answer').send({requestId:randomUUID(),version:task.version,questionId:task.questions[0].id,answer:'等待书面确认，先不要改交期。'}).expect(200);expect(await f.notices()).toEqual([]);
 const before=await f.current();await f.read([{taskId:notice.taskId,key:notice.key}],409);expect(await f.current()).toEqual(before);
});
it('removes a stopped question from actionable reminders without erasing its original unanswered record',async()=>{
 const f=await fixture(),notice=(await f.notices())[0],current=await f.current();await f.human.post(f.base+'/agent-tasks/'+current.id+'/cancel').send({requestId:randomUUID(),version:current.version}).expect(200);expect(await f.notices()).toEqual([]);expect((await f.current()).questions[0].answeredAt).toBeUndefined();await f.read([{taskId:notice.taskId,key:notice.key}],409);
});
it('masks content on authority loss, preserves owner cleanup and validates an entire read batch before writing',async()=>{
 const f=await fixture(),notice=(await f.notices())[0];await f.read([{taskId:notice.taskId,key:notice.key},{taskId:notice.taskId,key:'0'.repeat(64)}],409);expect((await f.notices())[0].readAt).toBeNull();
 f.ceiling.value=[];const masked=(await f.notices())[0];expect(masked).toMatchObject({title:'Agent任务权限已变化',detail:'Agent任务'});expect(JSON.stringify(masked)).not.toContain('核对交期');await f.read([{taskId:notice.taskId,key:notice.key}],409);await f.read([{taskId:masked.taskId,key:masked.key}]);expect((await f.notices())[0].readAt).toBeTruthy();
 const current=await f.current();await f.human.post(f.base+'/agent-tasks/'+current.id+'/cancel').send({requestId:randomUUID(),version:current.version}).expect(200);expect(await f.notices()).toEqual([]);
});
it('keeps an old active task in the bounded candidate set after many newer completed tasks',async()=>{
 const f=await fixture(),db=f.local.database,c=(await taskRecord(db,f.workspace.id,f.task.id)).value;
 await db.$transaction(async tx=>{for(let i=0;i<24;i++){const id=randomUUID(),copy={...c,id,state:'succeeded',createdAt:new Date(Date.now()+i+1).toISOString(),updatedAt:new Date(Date.now()+i+1).toISOString()};await tx.mistCommandReceipt.create({data:{id:randomUUID(),workspaceId:c.workspaceId,actorId:c.ownerId,inputHash:'mist-agent-task:v1',requestId:'mist-revision:agent-task:'+id,expectedRevision:0,createdAt:new Date(copy.createdAt),result:{revision:0,__agentTask:copy}}});}});
 const candidates=await taskNoticeCandidates(db,c.workspaceId,c.ownerId,Date.now());expect(candidates.map(c=>c.id)).toContain(c.id);expect(candidates).toHaveLength(21);
 expect(taskNotice(c,{...(await f.current()),lastHeartbeatAt:new Date().toISOString()})?.key).toBe((await f.notices()).find((n:any)=>n.taskId===c.id).key);
 const batch=(await f.notices()).slice(0,2);await f.read(batch.map((n:any)=>({taskId:n.taskId,key:n.key})));const read=await f.notices();expect(read.filter((n:any)=>batch.some((b:any)=>b.id===n.id)).every((n:any)=>!!n.readAt)).toBe(true);
});
it('does not expose or acknowledge another employee task even to the same-company administrator',async()=>{
 const f=await fixture(),human=f.human,app=f.app;await human.post('/api/mist/session').send({profileId:'demo-admin'}).expect(200);const workspace=(await human.get('/api/mist/workspaces/default').expect(200)).body.workspace,base='/api/mist/workspaces/'+workspace.id,identityId=randomUUID();
 await human.post(base+'/agent-identities').send({id:identityId,name:'业务助理',ownerId:'demo-sales',mode:'read'}).expect(201);await human.post('/api/mist/session').send({profileId:'demo-sales'}).expect(200);
 const key=(await human.post(base+'/agent-identities/'+identityId+'/issue').send({requestId:randomUUID(),version:1}).expect(200)).body.token,task=(await human.post(base+'/agent-tasks').send({requestId:randomUUID(),identityId,name:'核对交期',instructions:'只读核对工厂交期，缺依据先问本人。'}).expect(201)).body.item;
 const token=(await request(app).post(base+'/agent-tasks/'+task.id+'/claim').set(SERVICE_KEY_HEADER,key).send({requestId:randomUUID(),workerId:'test'}).expect(200)).body.token;
 const result=(await request(app).post('/api/mist/mcp').set(TASK_HEADER,token).send({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'bambook_task',arguments:{workspaceId:workspace.id,taskId:task.id,action:'question',requestId:randomUUID(),question:'请提供工厂书面确认。'}}}).expect(200)).body.result;expect(result.isError).not.toBe(true);
 const notice=(await human.get(base+'/agent-task-notices').expect(200)).body.items[0];expect(notice.detail).toBe('核对交期');
 const admin=request.agent(app);await admin.get('/api/mist/session').expect(200);await admin.post('/api/mist/session').send({profileId:'demo-admin'}).expect(200);expect((await admin.get(base+'/agent-task-notices').expect(200)).body.items).toEqual([]);await admin.post(base+'/agent-task-notices/read').send({items:[{taskId:notice.taskId,key:notice.key}]}).expect(404);expect((await human.get(base+'/agent-task-notices').expect(200)).body.items[0].readAt).toBeNull();
});
