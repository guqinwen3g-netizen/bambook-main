import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MistRepository} from './repository';
import {MistPrivateFiles} from './files';
import {MemoryMistDatabase,testActor,testAuthority} from './__tests__/support';
import * as contract from '../shared/mistWorkspace';
import { TEST_SIGNATURE } from './__tests__/signature';
const env=vi.hoisted(()=>({leader:'' as string,routes:new Map<string,string>(),users:null as null|Map<string,{active:boolean;permissions:string[]}>}));
vi.mock('../approvals/approvalRoutingService',()=>({createApprovalRoutingService:()=>({
 resolveReviewerByDepartment:async(id:string)=>{const reviewerId=env.routes.get(id);if(!reviewerId)throw Object.assign(new Error('missing'),{code:'NO_REVIEWER_RESOLVED'});return{reviewerId};},
 resolveClaimLeader:async(id:string)=>{if(!env.leader||env.leader===id)throw Object.assign(new Error('missing'),{code:'NO_REVIEWER_RESOLVED'});return{reviewerId:env.leader};},
})}));
vi.mock('../auth/tokenHelpers',()=>({
 loadUserWithRoles:async(_db:unknown,id:string)=>{const user=env.users?.get(id);return user?{id,status:user.active?'active':'disabled',deletedAt:null}:null;},
 buildLoadedAuthTokenPayload:async(_db:unknown,user:{id:string})=>({userId:user.id,displayName:user.id,permissions:[...(env.users?.get(user.id)?.permissions||[])],roles:[],departmentIds:[],authorizationLoaded:true}),
}));
let root:string,repo:MistRepository,db:MemoryMistDatabase,auth:ReturnType<typeof testAuthority>;
const actor=(id='owner')=>({...testActor(id),roles:[]});
beforeEach(async()=>{
 root=await mkdtemp(path.join(tmpdir(),'mist-payment-approval-'));db=new MemoryMistDatabase();auth=testAuthority();env.users=auth.users;env.routes.clear();env.leader='';
 auth.users.get('owner')!.permissions.push('products:read','procurement:read','procurement:write','invoices:read','inventory:read','finance:read','orders:read','orders:write','relations:read','relations:write','finance:payment_request:create');
 for(const id of ['manager','manager2'])auth.users.set(id,{active:true,permissions:['finance:read','finance:payment_request:approve','vouchers:approve:pay_lt5','orders:read','products:read']});
 env.routes.set('owner','manager');env.routes.set('manager','manager');env.routes.set('manager2','manager2');
 repo=new MistRepository(db,contract,new MistPrivateFiles(root),auth.authorize,()=>new Date('2026-10-19T08:00:00Z'));
});
afterEach(async()=>{await rm(root,{recursive:true,force:true});vi.unstubAllEnvs();});
async function fixture(first=false,amount=100,extra:string[]=[]){
 const w=await repo.create(actor(),{name:'Payment approval',seed:'demo'});let revision=w.revision,sequence=0;
 const run=async(command:any)=>{const next=await repo.execute(actor(),w.id,{requestId:'setup-'+(++sequence),expectedRevision:revision,command});revision=next.workspace.revision;return next;};
 const row=db.workspaces.get(w.id)!;const ids=['manager','manager2','boss',...extra];row.state.memberIds=ids;row.state.members=ids.map(userId=>({userId,name:userId,addedBy:'owner',addedByName:'owner',addedAt:'2026-10-19T08:00:00Z'}));row.state.memberGroups=ids.map(userId=>({userId,groups:['fabric','garment']}));
 const state=(await repo.get(actor(),w.id)).state,po=state.fulfillment.purchases.find(p=>p.code==='PO-2026-00001')!;
 // 默认该供应商已有历史付款（非首笔），只走金额档一级。
 if(!first)db.workspaces.get(w.id)!.state.payables!.payments.push({id:'old-pay',paymentId:'old-v',code:'SP-OLD',supplierId:po.supplierId,supplier:po.supplier,date:'2026-09-01',amount:1,currency:po.currency,reference:'OLD',fileIds:[],note:'',createdAt:'2026-09-01T00:00:00Z',actor:'财务',backfill:true});
 const bill=(await run({type:'payable.bill.register',payload:{supplierId:po.supplierId,invoiceNo:'AP-PERMISSION',invoiceDate:'2026-10-19',currency:po.currency,amount,taxAmount:0,lines:[{purchaseId:po.id,amount}],due:'2026-11-30',dueBasis:'模拟合同'}})).receipt.result.id as string;
 const submitted=await run({type:'payable.request.submit',payload:{purpose:'bill',supplierId:po.supplierId,currency:po.currency,lines:[{billId:bill,amount}],reason:'核对供应商票据后申请付款'}}),id=submitted.receipt.result.id as string;
 const task=contract.getMistReviewTasks(db.workspaces.get(w.id)!.state).find(t=>t.kind==='payment'&&t.entityId===id)!;if(!first)expect(task.reviewerIds).toEqual(['manager']);
 return{workspaceId:w.id,id,task,revision:submitted.workspace.revision};
}
for(const endpoint of ['command','review'] as const)describe(`付款审批：${endpoint} 入口`,()=>{
 const decide=async(f:Awaited<ReturnType<typeof fixture>>,who='manager',requestId='approve')=>endpoint==='command'
  ? repo.execute(actor(who),f.workspaceId,{requestId,expectedRevision:f.revision,command:{type:'payable.request.decide',payload:{id:f.id,decision:'approved',note:'核对合同、票据与应付，同意'}},signature:TEST_SIGNATURE})
  : repo.decideReview(actor(who),f.workspaceId,f.task.id,{requestId,expectedRevision:f.revision,decision:'approved',note:'核对合同、票据与应付，同意',signature:TEST_SIGNATURE});
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

describe('付款申请撤回：本人和当前权限',()=>{
 it.each(['pending','approved'])('不能凭申请权限撤回其他人的%s申请，拒绝不占用请求号也不改状态',async status=>{
  const f=await fixture();let revision=f.revision;
  if(status==='approved'){const next=await repo.execute(actor('manager'),f.workspaceId,{requestId:'approve-for-cancel',expectedRevision:revision,command:{type:'payable.request.decide',payload:{id:f.id,decision:'approved',note:'核对后批准'}},signature:TEST_SIGNATURE});revision=next.workspace.revision;}
  auth.users.get('manager2')!.permissions.push('finance:payment_request:create');
  const before=structuredClone(db.workspaces.get(f.workspaceId));
  const input={requestId:'cancel-other-'+status,expectedRevision:revision,command:{type:'payable.request.cancel',payload:{id:f.id,reason:'申请依据已变化'}}};
  await expect(repo.execute(actor('manager2'),f.workspaceId,input as any)).rejects.toMatchObject({code:'FORBIDDEN',status:403});
  expect(db.workspaces.get(f.workspaceId)).toEqual(before);
  const own=await repo.execute(actor(),f.workspaceId,input as any);
  expect(own.workspace.revision).toBe(revision+1);expect(db.workspaces.get(f.workspaceId)!.state.payables.requests.find((r:any)=>r.id===f.id).state).toBe('cancelled');
 });
 it('本人失去申请权限后旧会话也不能撤回，恢复同一权限后正常办理',async()=>{
  const f=await fixture(),stale=actor(),before=structuredClone(db.workspaces.get(f.workspaceId));
  auth.users.get('owner')!.permissions=auth.users.get('owner')!.permissions.filter(p=>p!=='finance:payment_request:create');
  const input={requestId:'cancel-current-scope',expectedRevision:f.revision,command:{type:'payable.request.cancel',payload:{id:f.id,reason:'申请依据已变化'}}};
  await expect(repo.execute(stale,f.workspaceId,input as any)).rejects.toMatchObject({code:'FORBIDDEN',status:403});expect(db.workspaces.get(f.workspaceId)).toEqual(before);
  auth.users.get('owner')!.permissions.push('finance:payment_request:create');await repo.execute(stale,f.workspaceId,input as any);
  expect(db.workspaces.get(f.workspaceId)!.state.payables.requests.find((r:any)=>r.id===f.id).state).toBe('cancelled');
 });
});

describe('付款审批分档：服务端按当前权限重建每一级审批人',()=>{
 it('部门主管没有首笔付款加签权时上抬到总领导；两级都批准才放行，审批页按级显示审批人',async()=>{
  auth.users.set('boss',{active:true,permissions:['finance:read','finance:payment_request:approve','vouchers:approve:pay_lt5','vouchers:approve:pay_gt5','vouchers:approve:pay_new_supplier','orders:read','products:read']});
  env.leader='boss';
  const f=await fixture(true);const row=db.workspaces.get(f.workspaceId)!;
  const request=row.state.payables!.requests!.find((r:any)=>r.id===f.id)!;
  expect(request.tier!.levels).toEqual([{level:'pay_lt5',reviewerIds:['manager']},{level:'pay_new_supplier',reviewerIds:['boss']}]);
  expect(f.task.reviewerIds).toEqual(['manager','boss']);
  const first=await repo.execute(actor('manager'),f.workspaceId,{requestId:'lvl-1',expectedRevision:f.revision,command:{type:'payable.request.decide',payload:{id:f.id,decision:'approved',note:'金额档核对通过'}},signature:TEST_SIGNATURE});
  expect(db.workspaces.get(f.workspaceId)!.state.payables!.requests!.find((r:any)=>r.id===f.id)!.state).toBe('pending');
  const after=contract.getMistReviewTasks(db.workspaces.get(f.workspaceId)!.state).find(t=>t.id===f.task.id)!;
  expect(after.reviewerIds).toEqual(['boss']);expect(after.details.find(d=>d.label==='审批进度')!.value).toContain('还差：首笔付款加签');
  await expect(repo.execute(actor('manager'),f.workspaceId,{requestId:'lvl-dup',expectedRevision:first.workspace.revision,command:{type:'payable.request.decide',payload:{id:f.id,decision:'approved',note:'再批一次'}},signature:TEST_SIGNATURE})).rejects.toMatchObject({code:'FORBIDDEN'});
  await repo.decideReview(actor('boss'),f.workspaceId,f.task.id,{requestId:'lvl-2',expectedRevision:first.workspace.revision,decision:'approved',note:'新供应商资质已核',signature:TEST_SIGNATURE});
  expect(db.workspaces.get(f.workspaceId)!.state.payables!.requests!.find((r:any)=>r.id===f.id)!.state).toBe('approved');
 });
 // 默认岗位形状：业务主管只有 ≤5 万档；公司管理员（总领导）持 >5 万档与首笔加签。
 const ADMIN=['finance:read','finance:payment_request:approve','vouchers:approve:pay_lt5','vouchers:approve:pay_gt5','vouchers:approve:pay_new_supplier','orders:read','products:read'];
 it('业务员 >5 万元首笔付款：公司另有一位持 >5 万档的领导时可提交，由两人分别签完',async()=>{
  auth.users.set('boss',{active:true,permissions:[...ADMIN]});env.leader='boss';
  auth.users.set('director',{active:true,permissions:['finance:read','finance:payment_request:approve','vouchers:approve:pay_gt5','orders:read','products:read']});
  const f=await fixture(true,60000,['director']);
  const request=()=>db.workspaces.get(f.workspaceId)!.state.payables!.requests!.find((r:any)=>r.id===f.id)!;
  expect(request().tier!.levels).toEqual([{level:'pay_gt5',reviewerIds:['boss','director']},{level:'pay_new_supplier',reviewerIds:['boss']}]);
  const first=await repo.execute(actor('boss'),f.workspaceId,{requestId:'big-1',expectedRevision:f.revision,command:{type:'payable.request.decide',payload:{id:f.id,decision:'approved',note:'新供应商资质已核'}},signature:TEST_SIGNATURE});
  // 总领导先签只有他能签的首笔加签，金额档留给另一位领导。
  expect(request()).toMatchObject({state:'pending',approvals:[{level:'pay_new_supplier',actorId:'boss'}]});
  await expect(repo.execute(actor('boss'),f.workspaceId,{requestId:'big-dup',expectedRevision:first.workspace.revision,command:{type:'payable.request.decide',payload:{id:f.id,decision:'approved',note:'再签'}},signature:TEST_SIGNATURE})).rejects.toMatchObject({code:'FORBIDDEN'});
  expect(request().state).toBe('pending');
  await repo.decideReview(actor('director'),f.workspaceId,f.task.id,{requestId:'big-2',expectedRevision:first.workspace.revision,decision:'approved',note:'金额核对通过',signature:TEST_SIGNATURE});
  expect(request()).toMatchObject({state:'approved',approvals:[{level:'pay_new_supplier',actorId:'boss'},{level:'pay_gt5',actorId:'director'}]});
 });
 it('业务员 >5 万元首笔付款：只有总领导一人能签两级时拒绝提交',async()=>{
  auth.users.set('boss',{active:true,permissions:[...ADMIN]});env.leader='boss';
  await expect(fixture(true,60000)).rejects.toMatchObject({code:'PRECONDITION',message:expect.stringContaining('缺少第二位审批人')});
 });
 it('总领导失去首笔付款加签权后不能签该级',async()=>{
  auth.users.set('boss',{active:true,permissions:['finance:payment_request:approve','vouchers:approve:pay_new_supplier']});env.leader='boss';
  const f=await fixture(true);auth.users.get('boss')!.permissions=['finance:payment_request:approve'];
  await expect(repo.decideReview(actor('boss'),f.workspaceId,f.task.id,{requestId:'lvl-x',expectedRevision:f.revision,decision:'approved',note:'同意',signature:TEST_SIGNATURE})).rejects.toMatchObject({code:'FORBIDDEN'});
 });
});
