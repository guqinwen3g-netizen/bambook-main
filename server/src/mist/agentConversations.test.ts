import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import request from 'supertest';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {createMistLocalRuntime} from './local';import {createMistServer} from './server';
import type {MistPlatformTaskWorker} from './platformTaskWorker';

let directory:string;const workers:MistPlatformTaskWorker[]=[];
beforeEach(async()=>{directory=await mkdtemp(path.join(tmpdir(),'mist-agent-conversations-'));vi.stubEnv('MIST_LOCAL_WORKSPACE','1');vi.stubEnv('NODE_ENV','test');});
afterEach(async()=>{await Promise.all(workers.splice(0).map(w=>w.stop()));vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});});
async function human(app:any,profileId:string){const client=request.agent(app);await client.get('/api/mist/session').expect(200);await client.post('/api/mist/session').send({profileId}).expect(200);const workspace=(await client.get('/api/mist/workspaces/default').expect(200)).body.workspace;return{client,base:'/api/mist/workspaces/'+workspace.id};}

it('keeps conversation names and removals per person, and rejects bad input',async()=>{
 const local=createMistLocalRuntime({directory}),app=createMistServer(undefined,{local,agentTasks:{complete:async()=>'',tickMs:3_600_000,pulseMs:20}});workers.push(app.locals.platformTaskWorker as MistPlatformTaskWorker);
 const sales=await human(app,'demo-sales'),buyer=await human(app,'demo-buyer');
 const list=async(h:typeof sales)=>(await h.client.get(h.base+'/agent-conversations').expect(200)).body.items;
 expect(await list(sales)).toEqual([]);
 expect((await sales.client.put(sales.base+'/agent-conversations/c_0001abcd').send({title:'  交期核对 '}).expect(200)).body.item).toEqual({id:'c_0001abcd',title:'交期核对'});
 await sales.client.put(sales.base+'/agent-conversations/legacy_1234-abcd').send({hidden:true}).expect(200);
 expect(await list(sales)).toEqual(expect.arrayContaining([{id:'c_0001abcd',title:'交期核对'},{id:'legacy_1234-abcd',hidden:true}]));
 // 改名保留移除状态；标题为 null 恢复默认；取消移除且无标题时整条清掉
 await sales.client.put(sales.base+'/agent-conversations/legacy_1234-abcd').send({title:'旧对话'}).expect(200);
 expect((await list(sales)).find((c:any)=>c.id==='legacy_1234-abcd')).toEqual({id:'legacy_1234-abcd',title:'旧对话',hidden:true});
 await sales.client.put(sales.base+'/agent-conversations/legacy_1234-abcd').send({title:null,hidden:false}).expect(200);
 expect(await list(sales)).toEqual([{id:'c_0001abcd',title:'交期核对'}]);
 // 别人看不到，也改不到本人的设置
 expect(await list(buyer)).toEqual([]);
 await buyer.client.put(buyer.base+'/agent-conversations/c_0001abcd').send({hidden:true}).expect(200);
 expect(await list(sales)).toEqual([{id:'c_0001abcd',title:'交期核对'}]);
 // 无效输入
 await sales.client.put(sales.base+'/agent-conversations/bad:id').send({title:'x'}).expect(400);
 await sales.client.put(sales.base+'/agent-conversations/c_0001abcd').send({title:'   '}).expect(400);
 await sales.client.put(sales.base+'/agent-conversations/c_0001abcd').send({title:'长'.repeat(61)}).expect(400);
 await sales.client.put(sales.base+'/agent-conversations/c_0001abcd').send({hidden:'yes'}).expect(400);
 await sales.client.put(sales.base+'/agent-conversations/c_0001abcd').send({ownerId:'demo-buyer'}).expect(400);
 await sales.client.put(sales.base+'/agent-conversations/c_0001abcd').send({}).expect(400);
});
