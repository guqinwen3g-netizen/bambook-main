import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MistRepository} from './repository';
import {MistPrivateFiles} from './files';
import {MemoryMistDatabase,testActor,testAuthority} from './__tests__/support';
import * as contract from '../shared/mistWorkspace';
const env=vi.hoisted(()=>({routes:new Map<string,string>(),users:null as null|Map<string,{active:boolean;permissions:string[]}>}));
vi.mock('../approvals/approvalRoutingService',()=>({createApprovalRoutingService:()=>({
 resolveReviewerByDepartment:async(id:string)=>{const reviewerId=env.routes.get(id);if(!reviewerId)throw Object.assign(new Error('missing'),{code:'NO_REVIEWER_RESOLVED'});return{reviewerId};},
 resolveClaimLeader:async()=>{throw Object.assign(new Error('missing'),{code:'NO_REVIEWER_RESOLVED'});},
})}));
vi.mock('../auth/tokenHelpers',()=>({
 loadUserWithRoles:async(_db:unknown,id:string)=>{const user=env.users?.get(id);return user?{id,status:user.active?'active':'disabled',deletedAt:null}:null;},
 buildLoadedAuthTokenPayload:async(_db:unknown,user:{id:string})=>({userId:user.id,displayName:user.id,permissions:[...(env.users?.get(user.id)?.permissions||[])],roles:[],departmentIds:[],authorizationLoaded:true}),
}));
let root:string,repo:MistRepository,db:MemoryMistDatabase,auth:ReturnType<typeof testAuthority>;
const actor=(id='owner')=>({...testActor(id),roles:[]});
beforeEach(async()=>{
 root=await mkdtemp(path.join(tmpdir(),'mist-payment-approval-'));db=new MemoryMistDatabase();auth=testAuthority();env.users=auth.users;env.routes.clear();
 auth.users.get('owner')!.permissions.push('products:read','procurement:read','procurement:write','invoices:read','inventory:read','finance:read','orders:read','orders:write','relations:read','relations:write','finance:payment_request:create');
 for(const id of ['manager','manager2'])auth.users.set(id,{active:true,permissions:['finance:read','finance:payment_request:approve','orders:read','products:read']});
 env.routes.set('owner','manager');env.routes.set('manager','manager');env.routes.set('manager2','manager2');
 repo=new MistRepository(db,contract,new MistPrivateFiles(root),auth.authorize,()=>new Date('2026-10-19T08:00:00Z'));
});
afterEach(async()=>{await rm(root,{recursive:true,force:true});vi.unstubAllEnvs();});
async function fixture(){
 const w=await repo.create(actor(),{name:'Payment approval',seed:'demo'});let revision=w.revision,sequence=0;
 const run=async(command:any)=>{const next=await repo.execute(actor(),w.id,{requestId:'setup-'+(++sequence),expectedRevision:revision,command});revision=next.workspace.revision;return next;};
 const row=db.workspaces.get(w.id)!;row.state.memberIds=['manager','manager2'];row.state.members=['manager','manager2'].map(userId=>({userId,name:userId,addedBy:'owner',addedByName:'owner',addedAt:'2026-10-19T08:00:00Z'}));row.state.memberGroups=['manager','manager2'].map(userId=>({userId,groups:['fabric','garment']}));
 const state=(await repo.get(actor(),w.id)).state,po=state.fulfillment.purchases.find(p=>p.code==='PO-2026-00001')!;
 const bill=(await run({type:'payable.bill.register',payload:{supplierId:po.supplierId,invoiceNo:'AP-PERMISSION',invoiceDate:'2026-10-19',currency:po.currency,amount:100,taxAmount:0,lines:[{purchaseId:po.id,amount:100}],due:'2026-11-30',dueBasis:'模拟合同'}})).receipt.result.id as string;
 const submitted=await run({type:'payable.request.submit',payload:{purpose:'bill',supplierId:po.supplierId,currency:po.currency,lines:[{billId:bill,amount:100}],reason:'核对供应商票据后申请付款'}}),id=submitted.receipt.result.id as string;
 const task=contract.getMistReviewTasks(db.workspaces.get(w.id)!.state).find(t=>t.kind==='payment'&&t.entityId===id)!;expect(task.reviewerIds).toEqual(['manager']);
 return{workspaceId:w.id,id,task,revision:submitted.workspace.revision};
}
for(const endpoint of ['command','review'] as const)describe(`付款审批：${endpoint} 入口`,()=>{
 const decide=async(f:Awaited<ReturnType<typeof fixture>>,who='manager',requestId='approve')=>endpoint==='command'
  ? repo.execute(actor(who),f.workspaceId,{requestId,expectedRevision:f.revision,command:{type:'payable.request.decide',payload:{id:f.id,decision:'approved',note:'核对合同、票据与应付，同意'}}})
  : repo.decideReview(actor(who),f.workspaceId,f.task.id,{requestId,expectedRevision:f.revision,decision:'approved',note:'核对合同、票据与应付，同意'});
 it('按申请人的当前部门路由审批；主管自身部门由自己负责也不影响，并且重放不重复决定',async()=>{
  const f=await fixture();await decide(f);const replay=await decide(f);expect(replay.replayed).toBe(true);
  const saved=await repo.get(actor(),f.workspaceId),request=db.workspaces.get(f.workspaceId)!.state.payables!.requests!.find(r=>r.id===f.id)!;
  expect(request).toMatchObject({state:'approved',decision:{actorId:'manager'}});expect(saved.revision).toBe(f.revision+1);
 });
 it('部门主管改派后不按审批人自己部门的旧路由放行，原审批对象保持未处理',async()=>{
  const f=await fixture();env.routes.set('owner','manager2');await expect(decide(f)).rejects.toMatchObject({code:'FORBIDDEN'});
  expect((await repo.get(actor(),f.workspaceId)).revision).toBe(f.revision);
 });
 it('申请人已停用时拒绝审批并保持原版本',async()=>{
  const f=await fixture();auth.users.get('owner')!.active=false;await expect(decide(f)).rejects.toMatchObject({code:'REQUESTER_UNAVAILABLE'});
  expect(db.workspaces.get(f.workspaceId)!.revision).toBe(f.revision);
 });
 it('主管审批权已撤销时拒绝，不能用旧会话权限继续决定',async()=>{
  const f=await fixture();auth.users.get('manager')!.permissions=[];await expect(decide(f)).rejects.toMatchObject({code:'FORBIDDEN'});
  expect((await repo.get(actor(),f.workspaceId)).revision).toBe(f.revision);
 });
 it('申请人即使另有审批权限也不能自批',async()=>{
  const f=await fixture();auth.users.get('owner')!.permissions.push('finance:payment_request:approve');
  await expect(decide(f,'owner','self-approve')).rejects.toMatchObject({code:endpoint==='command'?'FORBIDDEN':'NOT_FOUND'});
  expect((await repo.get(actor(),f.workspaceId)).revision).toBe(f.revision);
 });
});
