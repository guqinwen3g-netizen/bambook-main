import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import request from 'supertest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import type {Server} from 'node:http';
import {createMistLocalRuntime} from './local';
import {createMistServer} from './server';
import {SERVICE_KEY_HEADER} from './agentIdentities';
import {TASK_HEADER,TASK_CONTROL_HEADER} from './agentTasks';

let directory:string;
const clients:Client[]=[],servers:Server[]=[];
beforeEach(async()=>{directory=await mkdtemp(path.join(tmpdir(),'agent-task-protocol-'));vi.stubEnv('MIST_LOCAL_WORKSPACE','1');vi.stubEnv('NODE_ENV','test');});
afterEach(async()=>{await Promise.all(clients.splice(0).map(c=>c.close()));await Promise.all(servers.splice(0).map(s=>new Promise<void>(resolve=>{s.close(()=>resolve());s.closeAllConnections();})));vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});});
async function setup(mode:'read'|'operate'='operate'){
 const local=createMistLocalRuntime({directory}),app=createMistServer(undefined,{local}),human=request.agent(app);await human.get('/api/mist/session').expect(200);
 let workspace=(await human.get('/api/mist/workspaces/default').expect(200)).body.workspace;
 const base='/api/mist/workspaces/'+workspace.id,id=randomUUID();
 await human.post(base+'/agent-identities').send({id,name:'订单助理',ownerId:'local-operator',mode}).expect(201);
 const key=(await human.post(base+'/agent-identities/'+id+'/issue').send({requestId:randomUUID(),version:1}).expect(200)).body.token;
 const task=(await human.post(base+'/agent-tasks').send({requestId:randomUUID(),identityId:id,name:'整理来信',instructions:'读取本人可见的来信，移动邮件先交本人确认。'}).expect(201)).body.item;
 const current=async()=> (await human.get(base+'/agent-tasks/'+task.id).expect(200)).body.item;
 const claim=async()=>{const r=await request(app).post(base+'/agent-tasks/'+task.id+'/claim').set(SERVICE_KEY_HEADER,key).send({requestId:randomUUID(),workerId:'protocol-client'}).expect(200);return r.body.token as string;};
 const tool=async(token:string,name:string,args:any={},status=200,operation=randomUUID())=>{
  const r=await request(app).post('/api/mist/mcp').set(TASK_HEADER,token).set('X-Bambook-Task-Operation',operation).send({jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name,arguments:args}}).expect(status);return r.body.result;
 };
 const command=async(type:string,payload:any,status=200)=>{workspace=(await human.get(base).expect(200)).body.workspace;return human.post(base+'/commands').send({requestId:randomUUID(),expectedRevision:workspace.revision,command:{type,payload}}).expect(status);};
 return{local,app,human,base,id,key,task,current,claim,tool,command,get workspace(){return workspace;}};
}
it('scopes execution grants, counts reads, waits atomically for human approval, resumes with a new grant and cancels pending work',async()=>{
 const f=await setup(),token=await f.claim();expect(token).toMatch(/^bmt1_/);
 await request(f.app).get('/api/mist/session').set(TASK_HEADER,token).expect(403);
 await request(f.app).post('/api/mist/mcp').set(TASK_HEADER,token).set(SERVICE_KEY_HEADER,f.key).send({jsonrpc:'2.0',id:1,method:'ping'}).expect(401);
 const operation=randomUUID(),q=await f.tool(token,'bambook_query',{workspaceId:f.workspace.id,type:'email',q:'PO 确认'},200,operation);expect(q.isError).not.toBe(true);
 await f.tool(token,'bambook_query',{workspaceId:f.workspace.id,type:'email',q:'PO 确认'},409,operation);
 expect((await f.current()).stepsUsed).toBe(1);
 const mail=q.structuredContent.results[0].id;
 const normal=await f.tool(token,'bambook_execute',{workspaceId:f.workspace.id,requestId:randomUUID(),command:{type:'email.flag',payload:{id:mail,flag:'starred',value:true}}});expect(normal.isError).not.toBe(true);
 const proposed=await f.tool(token,'bambook_execute',{workspaceId:f.workspace.id,requestId:randomUUID(),command:{type:'email.move',payload:{id:mail,folder:'archive'}}});expect(proposed.structuredContent.status).toBe('awaiting_confirmation');
 const waiting=await f.current();expect(waiting.state).toBe('waiting_human');expect(JSON.stringify(waiting)).not.toContain(token);expect(JSON.stringify(waiting)).not.toContain(f.key);
 await f.tool(token,'bambook_query',{workspaceId:f.workspace.id,type:'email'},401);
 await f.command('agent.proposal.confirm',{id:proposed.structuredContent.receipt.result.id});expect((await f.current()).state).toBe('queued');
 const second=await f.claim();expect(second).not.toBe(token);
 const read=await f.tool(second,'bambook_get',{workspaceId:f.workspace.id,type:'email',id:mail});expect(read.structuredContent.object.data.folder).toBe('archive');
 const pending=await f.tool(second,'bambook_execute',{workspaceId:f.workspace.id,requestId:randomUUID(),command:{type:'email.move',payload:{id:mail,folder:'trash'}}});expect(pending.structuredContent.status).toBe('awaiting_confirmation');
 const state=await f.current();await f.human.post(f.base+'/agent-tasks/'+f.task.id+'/cancel').send({requestId:randomUUID(),version:state.version}).expect(200);
 expect((await f.current()).state).toBe('cancelled');await f.tool(second,'bambook_query',{workspaceId:f.workspace.id,type:'email'},401);
 const loaded=(await f.human.get(f.base).expect(200)).body.workspace;expect(loaded.state.email.messages.find((m:any)=>m.id===mail).folder).toBe('archive');expect(loaded.state.agentProposals.find((p:any)=>p.id===pending.structuredContent.receipt.result.id).state).toBe('rejected');
});
it('persists checkpoints and execution authority over restart; read-only task grants cannot write business data',async()=>{
 const f=await setup('read'),token=await f.claim();
 const checkpoint=await f.tool(token,'bambook_task',{workspaceId:f.workspace.id,action:'checkpoint',requestId:randomUUID(),summary:'已读取当前任务，尚未变更业务。'});expect(checkpoint.structuredContent.item.checkpoint).toContain('尚未变更');
 const denied=await f.tool(token,'bambook_execute',{workspaceId:f.workspace.id,requestId:randomUUID(),command:{type:'email.flag',payload:{id:'mail-ex-1',flag:'read',value:true}}});expect(denied.isError).toBe(true);
 const restarted=createMistServer(undefined,{local:createMistLocalRuntime({directory})});
 const r=await request(restarted).post('/api/mist/mcp').set(TASK_HEADER,token).send({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'bambook_task',arguments:{workspaceId:f.workspace.id,action:'status'}}}).expect(200);expect(r.body.result.structuredContent.item.checkpoint).toContain('尚未变更');
 await request(f.app).post(f.base+'/agent-tasks/'+f.task.id+'/pause').set(SERVICE_KEY_HEADER,f.key).send({requestId:randomUUID(),version:1}).expect(403);
});
it('does not let an unrelated own write mask an employee change to a previously read mail field',async()=>{
 const f=await setup(),token=await f.claim(),id='mail-ex-1';
 await f.tool(token,'bambook_get',{workspaceId:f.workspace.id,type:'email',id});
 await f.command('email.flag',{id,flag:'read',value:true});
 expect((await f.tool(token,'bambook_execute',{workspaceId:f.workspace.id,requestId:randomUUID(),command:{type:'email.flag',payload:{id,flag:'starred',value:true}}})).isError).not.toBe(true);
 expect((await f.tool(token,'bambook_execute',{workspaceId:f.workspace.id,requestId:randomUUID(),command:{type:'email.flag',payload:{id,flag:'read',value:false}}})).isError).toBe(true);
 await f.tool(token,'bambook_get',{workspaceId:f.workspace.id,type:'email',id});
 expect((await f.tool(token,'bambook_execute',{workspaceId:f.workspace.id,requestId:randomUUID(),command:{type:'email.flag',payload:{id,flag:'read',value:false}}})).isError).not.toBe(true);
});
it('rechecks a task proposal against changes after its source read instead of silently applying it to a new target state',async()=>{
 const f=await setup(),token=await f.claim(),id='mail-ex-1';await f.tool(token,'bambook_get',{workspaceId:f.workspace.id,type:'email',id});
 const proposed=await f.tool(token,'bambook_execute',{workspaceId:f.workspace.id,requestId:randomUUID(),command:{type:'email.move',payload:{id,folder:'archive'}}});
 await f.command('email.move',{id,folder:'trash'});
 const conflict=await f.command('agent.proposal.confirm',{id:proposed.structuredContent.receipt.result.id},409);expect(conflict.body.error.code).toBe('REVISION_CONFLICT');
 expect((await f.current()).state).toBe('waiting_human');
 const w=(await f.human.get(f.base).expect(200)).body.workspace;expect(w.state.email.messages.find((m:any)=>m.id===id).folder).toBe('trash');
 await f.command('agent.proposal.reject',{id:proposed.structuredContent.receipt.result.id,note:'来源已变化，重新核对'});expect((await f.current()).state).toBe('queued');
});
it('hides old task instructions and proposal contents after permission loss while still allowing the owner to stop safely',async()=>{
 const local=createMistLocalRuntime({directory});await local.ready;const authorize=local.authorize;let limited=false;
 local.authorize=async(db,prior,permission)=>{const actor=await authorize(db,prior,permission);return limited?{...actor,permissionCeiling:['ai:chat']}:actor;};
 const app=createMistServer(undefined,{local}),human=request.agent(app);await human.get('/api/mist/session').expect(200);const ws=(await human.get('/api/mist/workspaces/default').expect(200)).body.workspace,base='/api/mist/workspaces/'+ws.id,id=randomUUID();
 await human.post(base+'/agent-identities').send({id,name:'业务助理',ownerId:'local-operator',mode:'operate'}).expect(201);
 const key=(await human.post(base+'/agent-identities/'+id+'/issue').send({requestId:randomUUID(),version:1}).expect(200)).body.token;
 const task=(await human.post(base+'/agent-tasks').send({requestId:randomUUID(),identityId:id,name:'原权限内任务',instructions:'Private task instruction sentinel'}).expect(201)).body.item;
 const grant=(await request(app).post(base+'/agent-tasks/'+task.id+'/claim').set(SERVICE_KEY_HEADER,key).send({requestId:randomUUID(),workerId:'worker'}).expect(200)).body.token;
 await request(app).post('/api/mist/mcp').set(TASK_HEADER,grant).set('X-Bambook-Task-Operation',randomUUID()).send({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'bambook_execute',arguments:{workspaceId:ws.id,requestId:randomUUID(),command:{type:'email.move',payload:{id:'mail-ex-1',folder:'archive'}}}}}).expect(200);
 limited=true;
 const view=(await human.get(base+'/agent-tasks/'+task.id).expect(200)).body.item;expect(view).toMatchObject({state:'access_changed',instructions:'',checkpoint:''});
 const projected=(await human.get(base).expect(200)).body.workspace,proposal=projected.state.agentProposals.find((p:any)=>p.taskId===task.id);expect(proposal.unavailable).toBe(true);expect(proposal.command).toEqual({type:'unavailable',payload:{}});expect(JSON.stringify(proposal)).not.toContain('mail-ex-1');
 await human.post(base+'/agent-tasks/'+task.id+'/cancel').send({requestId:randomUUID(),version:view.version}).expect(200);
 expect((await human.get(base+'/agent-tasks/'+task.id).expect(200)).body.item.state).toBe('cancelled');
});
it('issues a task-only connection, binds and rotates standard MCP sessions without exposing execution or service keys',async()=>{
 const f=await setup(),issued=(await f.human.post(f.base+'/agent-tasks/'+f.task.id+'/issue').send({requestId:randomUUID(),version:f.task.version}).expect(200)).body;
 expect(issued.token).toMatch(/^bmc1_/);expect(issued.token).not.toBe(f.key);
 await request(f.app).get(f.base).set(TASK_CONTROL_HEADER,issued.token).expect(403);
 const init=await request(f.app).post('/api/mist/mcp').set(TASK_CONTROL_HEADER,issued.token).send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'task-client',version:'1'}}}).expect(200);
 const session=init.headers['mcp-session-id'];expect(session).toMatch(/^bms1_/);expect(JSON.stringify(init.body)).not.toMatch(/bma1_|bmt1_|bmc1_/);
 const call=async(name:string,args:any={},status=200)=>request(f.app).post('/api/mist/mcp').set(TASK_CONTROL_HEADER,issued.token).set('Mcp-Session-Id',session).send({jsonrpc:'2.0',id:randomUUID(),method:name==='tools/list'?name:'tools/call',params:name==='tools/list'?{}:{name,arguments:args}}).expect(status);
 const tools=(await call('tools/list')).body.result.tools;expect(tools).toHaveLength(9);expect(tools.some((t:any)=>t.name==='bambook_workspaces')).toBe(false);expect(tools.every((t:any)=>!t.inputSchema.properties.workspaceId)).toBe(true);
 await call('bambook_query',{workspaceId:randomUUID(),type:'email'},403);
 const q=await call('bambook_query',{type:'email'});expect(q.body.result.isError).not.toBe(true);expect((await f.current()).state).toBe('running');
 const current=await f.current(),rotated=(await f.human.post(f.base+'/agent-tasks/'+f.task.id+'/issue').send({requestId:randomUUID(),version:current.version}).expect(200)).body;
 expect(rotated.token).not.toBe(issued.token);await call('bambook_task',{action:'status'},401);
 expect(JSON.stringify(await f.local.database.mistCommandReceipt.findMany({where:{workspaceId:f.workspace.id}}))).not.toContain(issued.token);
});
it('works with an actual standard MCP client over HTTP through waiting and resumption without sending credentials to tools',async()=>{
 const f=await setup(),issued=(await f.human.post(f.base+'/agent-tasks/'+f.task.id+'/issue').send({requestId:randomUUID(),version:1}).expect(200)).body;
 const server=f.app.listen(0,'127.0.0.1');servers.push(server);await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Missing loopback port');
 const client=new Client({name:'standard-task-client',version:'1'},{versionNegotiation:{mode:'auto'}});clients.push(client);
 await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/api/mist/mcp`),{requestInit:{headers:{[TASK_CONTROL_HEADER]:issued.token}}}));
 expect((await client.listTools()).tools).toHaveLength(9);
 const status=await client.callTool({name:'bambook_task',arguments:{action:'status'}});expect((status.structuredContent as any).item.state).toBe('queued');expect(JSON.stringify(status)).not.toMatch(/bma1_|bmt1_|bmc1_/);
 const q=await client.callTool({name:'bambook_query',arguments:{type:'email',q:'PO 确认'}}),id=(q.structuredContent as any).results[0].id;
 const proposed=await client.callTool({name:'bambook_execute',arguments:{requestId:randomUUID(),command:{type:'email.move',payload:{id,folder:'archive'}}}});expect((proposed.structuredContent as any).status).toBe('awaiting_confirmation');
 expect(((await client.callTool({name:'bambook_task',arguments:{action:'status'}})).structuredContent as any).item.state).toBe('waiting_human');
 await f.command('agent.proposal.confirm',{id:(proposed.structuredContent as any).receipt.result.id});
 const read=await client.callTool({name:'bambook_get',arguments:{type:'email',id}});expect((read.structuredContent as any).object.data.folder).toBe('archive');
 const finished=await client.callTool({name:'bambook_task',arguments:{action:'finish',requestId:randomUUID(),outcome:'succeeded',result:'已从当前记录核对归档。'}});expect((finished.structuredContent as any).item.state).toBe('succeeded');
});

it('retains a human owner’s closed-task history after key revocation without restoring executor access',async()=>{
 const f=await setup(),token=await f.claim();
 await f.tool(token,'bambook_task',{workspaceId:f.workspace.id,action:'finish',requestId:randomUUID(),outcome:'succeeded',result:'当前核对结果保留。'});
 await f.human.post(f.base+'/agent-identities/'+f.id+'/revoke').send({requestId:randomUUID()}).expect(200);
 expect(await f.current()).toMatchObject({state:'succeeded',name:'整理来信',result:'当前核对结果保留。'});
 await f.tool(token,'bambook_task',{workspaceId:f.workspace.id,action:'status'},401);
});
it('does not overwrite a human edit to a draft after the task read its current draft object',async()=>{
 const f=await setup(),account=f.workspace.state.email.accounts[0],input={accountId:account.id,from:account.address,to:'buyer@example.test',cc:'',bcc:'',subject:'Draft review',body:'Agent version',template:'',links:[],fileIds:[]};
 const created=await f.command('email.draft.save',{input}),id=created.body.receipt.result.id,token=await f.claim();
 const read=await f.tool(token,'bambook_get',{workspaceId:f.workspace.id,type:'email_draft',id});expect(read.structuredContent.object.data.body).toBe('Agent version');
 await f.command('email.draft.save',{id,input:{...input,body:'Human corrected version'}});
 const attempt=await f.tool(token,'bambook_execute',{workspaceId:f.workspace.id,requestId:randomUUID(),command:{type:'email.draft.save',payload:{id,input}}});expect(attempt.isError).toBe(true);
 const current=(await f.human.get(f.base).expect(200)).body.workspace;expect(current.state.email.drafts.find((d:any)=>d.id===id).body).toBe('Human corrected version');
});
