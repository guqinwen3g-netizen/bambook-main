import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import request from 'supertest';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createMistLocalRuntime} from './local';import {createMistServer} from './server';
import type {MistPlatformTaskWorker} from './platformTaskWorker';
import type {LlmCompletionInput} from '../ai/llmProviders';
import {identityRecord,resolveServiceCredential,ensurePersonalIdentity,assertServiceLease,serviceActorFromIdentity} from './agentIdentities';
import {MemoryMistDatabase} from './__tests__/support';
import {AGENT_OPERATE_CEILING} from './agentDelegation';
import {createHash} from 'node:crypto';

let directory:string;const workers:MistPlatformTaskWorker[]=[];
beforeEach(async()=>{directory=await mkdtemp(path.join(tmpdir(),'mist-personal-agent-'));vi.stubEnv('MIST_LOCAL_WORKSPACE','1');vi.stubEnv('NODE_ENV','test');});
afterEach(async()=>{await Promise.all(workers.splice(0).map(w=>w.stop()));vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});});
async function human(app:any,profileId:string){const client=request.agent(app);await client.get('/api/mist/session').expect(200);await client.post('/api/mist/session').send({profileId}).expect(200);const workspace=(await client.get('/api/mist/workspaces/default').expect(200)).body.workspace;return{client,workspace,base:'/api/mist/workspaces/'+workspace.id};}
function server(complete:(input:LlmCompletionInput)=>Promise<string>){const local=createMistLocalRuntime({directory}),app=createMistServer(undefined,{local,agentTasks:{complete,tickMs:3_600_000,pulseMs:20}});const worker=app.locals.platformTaskWorker as MistPlatformTaskWorker;workers.push(worker);return{local,app,worker};}
const tool=(name:string,args:Record<string,unknown>)=>JSON.stringify({name,arguments:args});

it('each account opens one personal Agent owned by itself, without exposing a key, and hands it platform tasks',async()=>{
 const complete=vi.fn(async()=>tool('bambook_task',{action:'finish',outcome:'succeeded',result:'已核对，没有需要处理的事项。'}));
 const {app,local,worker}=server(complete);worker.start(3_600_000);
 const sales=await human(app,'demo-sales'),buyer=await human(app,'demo-buyer');
 const first=(await sales.client.post(sales.base+'/personal-agent').send({}).expect(200)).body.identity;
 expect(first).toMatchObject({kind:'personal',ownerId:'demo-sales',mode:'operate',state:'active'});
 expect(JSON.stringify(first)).not.toMatch(/bma1_/);
 const again=(await sales.client.post(sales.base+'/personal-agent').send({}).expect(200)).body.identity;
 expect(again.id).toBe(first.id);expect(again.version).toBe(first.version);
 const other=(await buyer.client.post(buyer.base+'/personal-agent').send({}).expect(200)).body.identity;
 expect(other.id).not.toBe(first.id);expect(other.ownerId).toBe('demo-buyer');
 const rows=await local.database.mistCommandReceipt.findMany({where:{workspaceId:sales.workspace.id}});expect(JSON.stringify(rows)).not.toMatch(/bma1_/);
 // 交给我的 Agent：直接建平台执行任务，不需要先配连接
 await sales.client.post(sales.base+'/personal-agent/tasks').send({requestId:randomUUID(),name:'核对',instructions:'核对今天的待办',identityId:other.id}).expect(400);
 const task=(await sales.client.post(sales.base+'/personal-agent/tasks').send({requestId:randomUUID(),name:'核对今日待办',instructions:'核对今天的待办并报告'}).expect(201)).body.item;
 expect(task).toMatchObject({executor:'platform',identityId:first.id,ownerId:'demo-sales',state:'queued'});
 await worker.tick();await worker.settled();
 expect((await sales.client.get(sales.base+'/agent-tasks/'+task.id).expect(200)).body.item.state).toBe('succeeded');
 await buyer.client.get(sales.base+'/agent-tasks/'+task.id).expect(404);
 // 用量：本人只看自己；公司管理员看全公司
 const month=new Date().toISOString().slice(0,7);
 const mine=(await sales.client.get(sales.base+'/personal-agent/usage?month='+month).expect(200)).body;
 expect(mine).toMatchObject({scope:'mine',items:[{ownerId:'demo-sales',tasks:1,modelTurns:1}]});
 expect((await buyer.client.get(buyer.base+'/personal-agent/usage?month='+month).expect(200)).body.items).toEqual([]);
 await sales.client.get(sales.base+'/personal-agent/usage?month=2026-13').expect(400);
 const admin=await human(app,'demo-admin');
 expect((await admin.client.get(admin.base+'/personal-agent/usage?month='+month).expect(200)).body).toMatchObject({scope:'company',items:[{ownerId:'demo-sales'}]});
});

it('administrators can stop a personal Agent but cannot hand it to someone else; a stopped Agent takes no new tasks',async()=>{
 const {app}=server(vi.fn(async()=>''));
 const sales=await human(app,'demo-sales'),admin=await human(app,'demo-admin');
 const mine=(await sales.client.post(sales.base+'/personal-agent').send({}).expect(200)).body.identity;
 await admin.client.post(admin.base+'/agent-identities/'+mine.id+'/configure').send({requestId:randomUUID(),version:mine.version,name:mine.name,ownerId:'demo-buyer',mode:'operate',enabled:true}).expect(422);
 await admin.client.post(admin.base+'/agent-identities/'+mine.id+'/configure').send({requestId:randomUUID(),version:mine.version,name:mine.name,ownerId:'demo-sales',mode:'read',enabled:true}).expect(422);
 await admin.client.post(admin.base+'/agent-identities/'+mine.id+'/configure').send({requestId:randomUUID(),version:mine.version,name:mine.name,ownerId:'demo-sales',mode:'operate',enabled:false}).expect(200);
 await sales.client.post(sales.base+'/personal-agent').send({}).expect(403);
 await sales.client.post(sales.base+'/personal-agent/tasks').send({requestId:randomUUID(),name:'x',instructions:'y'}).expect(403);
});

it('never exports a personal Agent key through the external service identity issue endpoint',async()=>{
 const {app,local}=server(vi.fn(async()=>'')),sales=await human(app,'demo-sales');
 const mine=(await sales.client.post(sales.base+'/personal-agent').send({}).expect(200)).body.identity;
 expect(mine.canIssue).toBe(false);
 const before=(await identityRecord(local.database,sales.workspace.id,mine.id)).value;
 for(const input of [{requestId:randomUUID(),version:mine.version},{requestId:before.lastRequestId,version:before.lastExpectedVersion}]){
  const response=await sales.client.post(sales.base+'/agent-identities/'+mine.id+'/issue').send(input).expect(403);
  expect(JSON.stringify(response.body)).not.toMatch(/bma1_/);
 }
 expect((await identityRecord(local.database,sales.workspace.id,mine.id)).value).toEqual(before);
});

it.each(['password','permissions'] as const)('rotates personal credentials after %s changes and invalidates both the old key and an in-flight lease',async(change)=>{
 const db=new MemoryMistDatabase(),workspaceId=randomUUID(),now=Date.now();
 const actor:any={userId:'staff',displayName:'模拟员工',roles:[],permissions:[...AGENT_OPERATE_CEILING],authorizationLoaded:true,credentialVersion:'v1'};
 // Deterministic test-only signer; no model, network or real credential is used.
 const make=(workspace:string,id:string,generation:string)=>'bma1_'+workspace+'_'+id+'_'+createHash('sha256').update(generation).digest('base64url');
 const first=await ensurePersonalIdentity(db,actor,workspaceId,make,now);
 const original=(await identityRecord(db,workspaceId,first.id)).value;
 const token=make(workspaceId,first.id,original.key!.generation),old=await resolveServiceCredential(db,token);
 if(change==='password')actor.credentialVersion='v2';else actor.permissions=['ai:chat','emails:read'];
 const next=await ensurePersonalIdentity(db,actor,workspaceId,make,now+1);
 expect(next.version).toBe(first.version+1);expect(JSON.stringify(next)).not.toMatch(/bma1_|generation|credentialVersion|ceiling/);
 await expect(resolveServiceCredential(db,token)).rejects.toMatchObject({code:'AGENT_KEY_INVALID',status:401});
 await expect(assertServiceLease(db,actor,old.agentServiceLease!,now+1)).rejects.toMatchObject({code:'AGENT_KEY_INVALID',status:401});
 const current=(await identityRecord(db,workspaceId,first.id)).value;
 expect(current.key!.generation).not.toBe(original.key!.generation);
 expect(current.key!.credentialVersion).toBe(actor.credentialVersion);
 expect(current.key!.ceiling.every(scope=>actor.permissions.includes(scope))).toBe(true);
 expect((await resolveServiceCredential(db,make(workspaceId,first.id,current.key!.generation))).userId).toBe(actor.userId);
 expect((await ensurePersonalIdentity(db,actor,workspaceId,make,now+2)).version).toBe(next.version);
});

it('stops an in-flight personal task on administrator disable, without executing the pending model tool',async()=>{
 let release!:(value:string)=>void,entered!:()=>void;
 const held=new Promise<string>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 const complete=vi.fn(async()=>{entered();return held;});
 const {app,local,worker}=server(complete),sales=await human(app,'demo-sales'),admin=await human(app,'demo-admin');
 worker.start(3_600_000);
 const mine=(await sales.client.post(sales.base+'/personal-agent').send({}).expect(200)).body.identity;
 const before=(await identityRecord(local.database,sales.workspace.id,mine.id)).value;
 const lease=serviceActorFromIdentity(before,before.key!.hash).agentServiceLease!;
 const task=(await sales.client.post(sales.base+'/personal-agent/tasks').send({requestId:randomUUID(),name:'核对',instructions:'只核对资料'}).expect(201)).body.item;
 await worker.tick();await started;
 await admin.client.post(admin.base+'/agent-identities/'+mine.id+'/configure').send({requestId:randomUUID(),version:mine.version,name:mine.name,ownerId:mine.ownerId,mode:mine.mode,enabled:false}).expect(200);
 await expect(assertServiceLease(local.database,{userId:mine.ownerId} as any,lease,Date.now())).rejects.toMatchObject({code:'AGENT_KEY_INVALID'});
 release(tool('bambook_execute',{command:{type:'calendar.save',payload:{title:'不应写入',date:'2026-11-05',time:'10:00',note:''}}}));
 await worker.settled();
 expect(complete).toHaveBeenCalledTimes(1);
 expect((await sales.client.get(sales.base+'/agent-tasks/'+task.id).expect(200)).body.item.state).toBe('access_changed');
 const ws=(await sales.client.get(sales.base).expect(200)).body.workspace;
 expect(ws.state.calendar.some((item:any)=>item.title==='不应写入')).toBe(false);
 await sales.client.post(sales.base+'/personal-agent/tasks').send({requestId:randomUUID(),name:'新任务',instructions:'不应受理'}).expect(403);
});
