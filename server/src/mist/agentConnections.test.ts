import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import request from 'supertest';import {createMistLocalRuntime} from './local';import {createMistServer} from './server';
import {MistApiError} from './errors';
let directory:string;
beforeEach(async()=>{directory=await mkdtemp(path.join(tmpdir(),'mist-connection-'));vi.stubEnv('MIST_LOCAL_WORKSPACE','1');vi.stubEnv('NODE_ENV','test');});
afterEach(async()=>{vi.useRealTimers();vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});});
async function human(app:any,profileId='demo-buyer'){const client=request.agent(app);await client.get('/api/mist/session').expect(200);await client.post('/api/mist/session').send({profileId}).expect(200);const workspace=(await client.get('/api/mist/workspaces/default').expect(200)).body.workspace;return{client,workspace,base:'/api/mist/workspaces/'+workspace.id+'/agent-connections'};}
const rpc=(app:any,token:string)=>request(app).post('/api/mist/mcp').set('x-bambook-delegation',token).send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'connection-test',version:'1'}}});
describe('Registered self-service Agent connections',()=>{
 it('allows the human to renew an expired lease without reviving its old credential',async()=>{
  vi.useFakeTimers({toFake:['Date']});const app=createMistServer(undefined,{local:createMistLocalRuntime({directory})}),h=await human(app),id=randomUUID();
  const created=(await h.client.post(h.base).send({id,name:'到期验证',mode:'read'}).expect(201)).body;
  vi.setSystemTime(Date.now()+2*60*60*1000+1000);await rpc(app,created.delegation.token).expect(401);expect((await h.client.get(h.base+'/'+id).expect(200)).body.state).toBe('expired');
  const renewed=(await h.client.post(h.base+'/'+id+'/renew').send({requestId:randomUUID(),version:1}).expect(200)).body;await rpc(app,renewed.delegation.token).expect(200);await rpc(app,created.delegation.token).expect(401);
 });
 it('never expands a connection ceiling on renewal when the account acquires more grants',async()=>{
  const local=createMistLocalRuntime({directory});let grants=['ai:chat','orders:read'];const runtime={...local,authorize:async(db:any,prior:any,permission?:string|null)=>{const actor=await local.authorize(db,prior,permission);actor.permissions=[...grants];if(permission&&!grants.includes(permission))throw new MistApiError('FORBIDDEN','没有权限',403);return actor;}};
  const app=createMistServer(undefined,{local:runtime}),h=await human(app,'demo-buyer'),id=randomUUID();
  const created=(await h.client.post(h.base).send({id,name:'权限快照',mode:'read'}).expect(201)).body;expect(created.delegation.ceiling).toEqual(['ai:chat','orders:read']);
  grants.push('invoices:read','vouchers:read');const renewed=(await h.client.post(h.base+'/'+id+'/renew').send({requestId:randomUUID(),version:1}).expect(200)).body;expect(renewed.delegation.ceiling).toEqual(['ai:chat','orders:read']);
  await h.client.post(h.base+'/'+id+'/renew').send({requestId:randomUUID(),version:2,mode:'operate'}).expect(400);
  grants=['ai:chat'];const reduced=(await h.client.post(h.base+'/'+id+'/renew').send({requestId:randomUUID(),version:2}).expect(200)).body;expect(reduced.delegation.ceiling).toEqual(['ai:chat']);
  grants=[];expect((await h.client.get(h.base+'/'+id).expect(200)).body.state).toBe('invalid');expect((await h.client.get(h.base).expect(200)).body.canConnect).toBe(false);
  await h.client.post(h.base+'/'+id+'/renew').send({requestId:randomUUID(),version:3}).expect(403);await h.client.post(h.base+'/'+id+'/revoke').send({requestId:randomUUID()}).expect(200);
 });
 it('shows a stale account credential version as invalid until the human renews it',async()=>{
  const local=createMistLocalRuntime({directory});let version='before';const runtime={...local,authorize:async(db:any,prior:any,permission?:string|null)=>({...await local.authorize(db,prior,permission),credentialVersion:version})};
  const app=createMistServer(undefined,{local:runtime}),h=await human(app),id=randomUUID();await h.client.post(h.base).send({id,name:'账号安全验证',mode:'read'}).expect(201);
  version='after';expect((await h.client.get(h.base+'/'+id).expect(200)).body.state).toBe('invalid');
  expect((await h.client.post(h.base+'/'+id+'/renew').send({requestId:randomUUID(),version:1}).expect(200)).body.connection.state).toBe('active');
 });
 it('permits only one of two different renewals for the same version',async()=>{
  const app=createMistServer(undefined,{local:createMistLocalRuntime({directory})}),h=await human(app),id=randomUUID();await h.client.post(h.base).send({id,name:'并发续签',mode:'read'}).expect(201);
  const responses=await Promise.all([1,2].map(()=>h.client.post(h.base+'/'+id+'/renew').send({requestId:randomUUID(),version:1})));expect(responses.map(r=>r.status).sort()).toEqual([200,409]);await rpc(app,responses.find(r=>r.status===200)!.body.delegation.token).expect(200);
 });
 it('creates once, rotates on renewal, replays retries, revokes permanently and survives a server restart',async()=>{
  const local=createMistLocalRuntime({directory}),app=createMistServer(undefined,{local}),h=await human(app),id=randomUUID(),input={id,name:'采购助手',mode:'read'};
  const created=(await h.client.post(h.base).send(input).expect(201)).body;
  await h.client.post('/api/mist/agent/delegations').send({mode:'read'}).expect(400);
  const legacy=local.agentDelegation.issue(await local.actorForProfile('demo-buyer')).token;
  await rpc(app,legacy).expect(401);
  expect((await h.client.post(h.base).send(input).expect(201)).body.delegation.token).toBe(created.delegation.token);
  expect((await h.client.get(h.base).expect(200)).body.items).toHaveLength(1);expect(JSON.stringify((await h.client.get(h.base).expect(200)).body)).not.toContain(created.delegation.token);
  await h.client.get('/api/mist/workspaces/'+h.workspace.id+'/receipts/'+encodeURIComponent('mist-revision:agent-connection:'+id)).expect(400);
  await rpc(app,created.delegation.token).expect(200);
  const claims=local.agentDelegation.verify(created.delegation.token);expect(claims.v).toBe(2);
  if(claims.v===2){const changed=local.agentDelegation.signManaged({...claims,ceil:[...claims.ceil,'audit:read']}).token;await rpc(app,changed).expect(401);}
  const renewal={requestId:randomUUID(),version:1},renewed=(await h.client.post(h.base+'/'+id+'/renew').send(renewal).expect(200)).body;
  expect(renewed.delegation.token).not.toBe(created.delegation.token);expect(renewed.connection.version).toBe(2);
  expect((await h.client.post(h.base+'/'+id+'/renew').send(renewal).expect(200)).body.delegation.token).toBe(renewed.delegation.token);
  await h.client.post(h.base+'/'+id+'/renew').send({...renewal,version:99}).expect(409);
  await rpc(app,created.delegation.token).expect(401);await rpc(app,renewed.delegation.token).expect(200);
  await h.client.post(h.base+'/'+id+'/renew').send({requestId:randomUUID(),version:1}).expect(409);
  const revoked=(await h.client.post(h.base+'/'+id+'/revoke').send({requestId:randomUUID()}).expect(200)).body;expect(revoked.connection.state).toBe('revoked');expect(revoked.delegation).toBeUndefined();
  await h.client.post(h.base+'/'+id+'/revoke').send({requestId:randomUUID()}).expect(200);
  await rpc(app,renewed.delegation.token).expect(401);await h.client.post(h.base+'/'+id+'/renew').send({requestId:randomUUID(),version:3}).expect(410);
  const restarted=createMistServer(undefined,{local:createMistLocalRuntime({directory})}),again=await human(restarted);
  expect((await again.client.get(again.base).expect(200)).body.items[0].state).toBe('revoked');await rpc(restarted,renewed.delegation.token).expect(401);
  expect((await again.client.get('/api/mist/workspaces/default').expect(200)).body.workspace.revision).toBe(h.workspace.revision);
 });
 it('keeps connection ownership separate from company audit/manager privileges and refuses delegated management',async()=>{
  const app=createMistServer(undefined,{local:createMistLocalRuntime({directory})}),h=await human(app),id=randomUUID();
  const created=(await h.client.post(h.base).send({id,name:'读资料',mode:'read'}).expect(201)).body;
  const other=await human(app,'demo-finance');expect((await other.client.get(h.base).expect(200)).body.items).toHaveLength(0);
  await other.client.get(h.base+'/'+id).expect(404);await other.client.post(h.base+'/'+id+'/revoke').send({requestId:randomUUID()}).expect(404);
  await request(app).post(h.base+'/'+id+'/renew').set('x-bambook-delegation',created.delegation.token).send({requestId:randomUUID(),version:1}).expect(403);
  await request(app).post('/api/mist/agent/delegations').set('x-bambook-delegation',created.delegation.token).send({}).expect(403);
  const write=(await request(app).post('/api/mist/mcp').set('x-bambook-delegation',created.delegation.token).send({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'bambook_execute',arguments:{workspaceId:h.workspace.id,requestId:randomUUID(),command:{type:'calendar.save',payload:{title:'must not write',date:'2026-11-01',time:'09:00',note:''}}}}}).expect(200)).body;
  expect(write.result.isError).toBe(true);
 });
 it('does not resurrect a connection when renewal races with revocation',async()=>{
  const app=createMistServer(undefined,{local:createMistLocalRuntime({directory})}),h=await human(app),id=randomUUID();
  await h.client.post(h.base).send({id,name:'并发验证',mode:'read'}).expect(201);
  const [renew,revoke]=await Promise.all([h.client.post(h.base+'/'+id+'/renew').send({requestId:randomUUID(),version:1}),h.client.post(h.base+'/'+id+'/revoke').send({requestId:randomUUID()})]);
  expect(revoke.status).toBe(200);expect([200,410]).toContain(renew.status);expect((await h.client.get(h.base+'/'+id).expect(200)).body.state).toBe('revoked');if(renew.body.delegation)await rpc(app,renew.body.delegation.token).expect(401);
 });
});
