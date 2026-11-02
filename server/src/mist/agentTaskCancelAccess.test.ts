import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import request from 'supertest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createMistLocalRuntime} from './local';
import {createMistServer} from './server';
import {SERVICE_KEY_HEADER} from './agentIdentities';

/** agent.task.cancel 权限映射为 null：两条停止路径（REST、/commands）都由仓储拒绝 Agent，并只认任务创建人。 */
let directory:string;
beforeEach(async()=>{directory=await mkdtemp(path.join(tmpdir(),'task-cancel-access-'));vi.stubEnv('MIST_LOCAL_WORKSPACE','1');vi.stubEnv('NODE_ENV','test');});
afterEach(async()=>{vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});});

it('only the task creator can stop a task; another member, the company admin and the Agent are refused on both paths',async()=>{
 const app=createMistServer(undefined,{local:createMistLocalRuntime({directory})}),sales=request.agent(app),admin=request.agent(app);
 await sales.get('/api/mist/session').expect(200);await sales.post('/api/mist/session').send({profileId:'demo-admin'}).expect(200);
 const workspace=(await sales.get('/api/mist/workspaces/default').expect(200)).body.workspace,base='/api/mist/workspaces/'+workspace.id,identityId=randomUUID();
 await sales.post(base+'/agent-identities').send({id:identityId,name:'业务助理',ownerId:'demo-sales',mode:'read'}).expect(201);
 await sales.post('/api/mist/session').send({profileId:'demo-sales'}).expect(200);
 const key=(await sales.post(base+'/agent-identities/'+identityId+'/issue').send({requestId:randomUUID(),version:1}).expect(200)).body.token;
 const task=(await sales.post(base+'/agent-tasks').send({requestId:randomUUID(),identityId,name:'核对交期',instructions:'只读核对工厂交期。'}).expect(201)).body.item;
 await admin.get('/api/mist/session').expect(200);await admin.post('/api/mist/session').send({profileId:'demo-admin'}).expect(200);
 const viaCommand=async(agent:ReturnType<typeof request.agent>)=>{const revision=(await agent.get(base).expect(200)).body.workspace.revision;return agent.post(base+'/commands').send({requestId:randomUUID(),expectedRevision:revision,command:{type:'agent.task.cancel',payload:{id:task.id,version:task.version}}});};
 await admin.post(base+'/agent-tasks/'+task.id+'/cancel').send({requestId:randomUUID(),version:task.version}).expect(404);
 expect((await viaCommand(admin)).status).toBe(404);
 await request(app).post(base+'/agent-tasks/'+task.id+'/cancel').set(SERVICE_KEY_HEADER,key).send({requestId:randomUUID(),version:task.version}).expect(res=>expect([401,403]).toContain(res.status));
 expect((await sales.get(base+'/agent-tasks/'+task.id).expect(200)).body.item.state).toBe('queued');
 expect((await viaCommand(sales)).status).toBe(200);
 expect((await sales.get(base+'/agent-tasks/'+task.id).expect(200)).body.item.state).toBe('cancelled');
});
