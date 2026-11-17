import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createMistState,applyMistCommand,mistCommandPermission} from '../shared/mistWorkspace';
import {MistRepository} from './repository';
import {MistPrivateFiles} from './files';
import {MemoryMistDatabase,testAuthority} from './__tests__/support';
import {taskRecord} from './agentTasks';
const company='11111111-1111-4111-8111-111111111111',foreignCompany='22222222-2222-4222-8222-222222222222';
let root:string,db:MemoryMistDatabase,repo:MistRepository,workspaceId:string,foreignWorkspaceId:string,auth:ReturnType<typeof testAuthority>;
const actor:any={userId:'demo-sales',displayName:'业务员',roles:[],departmentIds:[],companyId:company,authorizationLoaded:true};
const make=(w:string,i:string,g:string)=>[w,i,g].join('.');
const input=(refs?:unknown)=>({requestId:randomUUID(),name:'核对订单',instructions:'核对所选资料。',...(refs!==undefined?{intentRefs:refs}:{})});
beforeEach(async()=>{
 root=await mkdtemp(path.join(tmpdir(),'intent-scope-'));db=new MemoryMistDatabase();auth=testAuthority();
 auth.users.set(actor.userId,{active:true,permissions:['ai:chat','orders:read']});db.companyMembers.push({companyId:company,userId:actor.userId,status:'active'});
 let n=0;const state=createMistState({id:()=>`row-${++n}`,now:'2026-11-01T00:00:00Z',actorName:'业务员'}as any,'demo');
 state.orders[0].ownerId=actor.userId;state.orders[1].ownerId='another-user';state.orders[1].customerId=state.customers.find(c=>c.ownerId!==actor.userId)!.id;
 workspaceId=randomUUID();foreignWorkspaceId=randomUUID();const row={ownerId:'boss',companyId:company,slug:`company@${company}`,name:'公司',revision:0,state,createdAt:new Date(),updatedAt:new Date()};
 db.workspaces.set(workspaceId,{...row,id:workspaceId});const foreign=structuredClone(state);foreign.orders[0].id='foreign-order';db.workspaces.set(foreignWorkspaceId,{...row,id:foreignWorkspaceId,companyId:foreignCompany,slug:`company@${foreignCompany}`,state:foreign});
 repo=new MistRepository(db,{createMistState,applyMistCommand,mistCommandPermission},new MistPrivateFiles(root),auth.authorize);repo.setPlatformTaskRuntime(()=>true);
});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
it('validates fresh owner projection before bootstrapping personal identity or storing tasks',async()=>{
 const visible=await repo.get(actor,workspaceId),id=visible.state.orders[0].id,hidden=db.workspaces.get(workspaceId)!.state.orders.find((o:any)=>!visible.state.orders.some(v=>v.id===o.id)).id;
 const before=structuredClone(db.workspaces),receipts=db.receipts.size;
 for(const guessed of[hidden,'foreign-order','unknown'])await expect(repo.assignPersonalAgentTask(actor,workspaceId,input([{kind:'orders',id:guessed}]),make)).rejects.toMatchObject({status:404});
 for(const refs of[[{kind:'orders',id,label:'同名'}],Array.from({length:13},()=>({kind:'orders',id}))])await expect(repo.assignPersonalAgentTask(actor,workspaceId,input(refs),make)).rejects.toMatchObject({status:400});
 expect(db.workspaces).toEqual(before);expect(db.receipts.size).toBe(receipts);
 const task=await repo.assignPersonalAgentTask(actor,workspaceId,input([{kind:'orders',id}]),make);const stored=(await taskRecord(db,workspaceId,task.id)).value;expect(stored.intentRefs).toEqual([{kind:'orders',id}]);expect(stored.sources).toEqual([]);
});
it('rejects cross-company workspace access and revoked module access without creating any task',async()=>{
 const id=(await repo.get(actor,workspaceId)).state.orders[0].id;
 await expect(repo.assignPersonalAgentTask(actor,foreignWorkspaceId,input([{kind:'orders',id:'foreign-order'}]),make)).rejects.toMatchObject({status:404});
 auth.users.get(actor.userId)!.permissions=['ai:chat'];const count=db.receipts.size;
 await expect(repo.assignPersonalAgentTask(actor,workspaceId,input([{kind:'orders',id}]),make)).rejects.toMatchObject({status:404});expect(db.receipts.size).toBe(count);
});
it('hides an unreadable referenced task and blocks resume while preserving owner cancellation',async()=>{
 const id=(await repo.get(actor,workspaceId)).state.orders[0].id,task=await repo.assignPersonalAgentTask(actor,workspaceId,input([{kind:'orders',id}]),make);
 auth.users.get(actor.userId)!.permissions=['ai:chat'];const hidden=await repo.getAgentTask(actor,workspaceId,task.id);
 expect(hidden).toMatchObject({state:'access_changed',instructions:'',result:'',canControl:true});expect(hidden).not.toHaveProperty('intentRefs');
 await expect(repo.changeAgentTask(actor,workspaceId,task.id,'resume',{requestId:randomUUID(),version:hidden.version})).rejects.toMatchObject({status:403});
 await repo.cancelAgentTask(actor,workspaceId,task.id,{requestId:randomUUID(),version:hidden.version});expect((await repo.getAgentTask(actor,workspaceId,task.id)).state).toBe('cancelled');
});
it('keeps legacy personal clients without refs usable and does not rewrite their record shape',async()=>{
 const task=await repo.assignPersonalAgentTask(actor,workspaceId,input(),make);expect((await taskRecord(db,workspaceId,task.id)).value).not.toHaveProperty('intentRefs');
});
