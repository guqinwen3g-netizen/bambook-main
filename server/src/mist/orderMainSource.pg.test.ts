import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import request from 'supertest';
import {PrismaClient} from '@prisma/client';
import {createMistServer} from './server';
import {createAuthService} from '../auth/service';
import {provisionCompanyRoles,companyRoleId} from '../platform/companyProvisioning';
import {SYSTEM_ROLE_IDS} from '../_shared/rolePermissionMatrix';
import {createMistState} from '../shared/mistWorkspace';
import {TEST_SIGNATURE} from './__tests__/signature';

const url=process.env.MIST_PG_CONFLICT_TEST_URL;
describe.skipIf(!url)('submitted main source with real company grants on PostgreSQL',()=>{
 const companyId=randomUUID(),key=randomUUID(),boss='source-boss-'+key,owner='source-owner-'+key,oldHead='source-old-'+key,newHead='source-new-'+key;
 const users=[boss,owner,oldHead,newHead],root=randomUUID(),fabric=randomUUID(),secondFabric=randomUUID(),support=randomUUID(),oldDepartment=randomUUID(),noOrdersRole='source-no-orders-'+key;
 let db:PrismaClient,app:ReturnType<typeof createMistServer>,directory:string,wid:string;const tokens:Record<string,string>={};
 beforeAll(async()=>{
  const target=new URL(url!);if(!['127.0.0.1','localhost'].includes(target.hostname)||!/^\/bambook_(account|acceptance|test)/.test(target.pathname))throw Error('A dedicated local acceptance database is required');
  directory=await mkdtemp(path.join(tmpdir(),'main-source-'));vi.stubEnv('NODE_ENV','test');vi.stubEnv('MIST_LOCAL_WORKSPACE','0');vi.stubEnv('MIST_FILES_DIR',path.join(directory,'files'));vi.stubEnv('MIST_MAIL_CREDENTIAL_DIR',path.join(directory,'mail'));vi.stubEnv('BAMBOOK_AI_SUBSCRIPTION_DIR',path.join(directory,'ai'));vi.stubEnv('BAMBOOK_MARKET_DIR',path.join(directory,'market'));
  db=new PrismaClient({datasourceUrl:url});await db.company.create({data:{id:companyId,slug:companyId,name:'Main source company'}});
  await db.department.create({data:{id:root,companyId,name:'Company'}});
  for(const[id,name,status,attributes]of[[fabric,'面料部','active',['fabric_business']],[secondFabric,'面料二部','active',['fabric_business']],[support,'综合部','active',['support']],[oldDepartment,'已撤部门','inactive',[]]] as const)await db.department.create({data:{id,companyId,parentId:root,name,status,metadata:{businessAttributes:[...attributes]}}});
  await db.$transaction(tx=>provisionCompanyRoles(tx,companyId));await db.role.create({data:{id:noOrdersRole,companyId,name:'资料查看',isSystem:false}});
  for(const id of users){await db.userAccount.create({data:{id,displayName:id,email:id+'@example.invalid',status:'active',primaryDeptId:id===owner?oldDepartment:fabric}});await db.companyMember.create({data:{companyId,userId:id,status:'active'}});tokens[id]=createAuthService().signToken({userId:id,companyId,roles:[],permissions:[],departmentIds:[]});}
  app=createMistServer(db,{host:'127.0.0.1'});
  for(const id of users)await db.userRole.create({data:{id:randomUUID(),userId:id,departmentId:id===boss?root:fabric,roleId:companyRoleId(id===boss?SYSTEM_ROLE_IDS.SUPER_ADMIN:SYSTEM_ROLE_IDS.SALES,companyId)}});
  wid=(await request(app).get('/api/mist/workspaces/default').set('Authorization','Bearer '+tokens[boss]).expect(200)).body.workspace.id;
 });
 beforeEach(async()=>{
  if(!wid)throw Error('Fixture workspace was not created');await db.mistCommandReceipt.deleteMany({where:{workspace:{companyId}}});await db.orderApprovalAuthority.deleteMany({where:{companyId}});
  await db.companyMember.updateMany({where:{companyId},data:{status:'active'}});await db.userAccount.updateMany({where:{id:{in:users}},data:{status:'active'}});
  await db.userRole.deleteMany({where:{userId:{in:users},role:{companyId}}});for(const id of users)await db.userRole.create({data:{id:randomUUID(),userId:id,departmentId:id===boss?root:fabric,roleId:companyRoleId(id===boss?SYSTEM_ROLE_IDS.SUPER_ADMIN:SYSTEM_ROLE_IDS.SALES,companyId)}});
  await db.department.update({where:{id:fabric},data:{headId:oldHead}});
  await db.department.update({where:{id:secondFabric},data:{headId:newHead}});
  const state=createMistState({id:randomUUID,now:new Date().toISOString(),actorName:boss,actorId:boss},'empty');state.customers.push({id:'customer',name:'Pine Studio',code:'PINE',country:'UK',city:'Bath',industry:'品牌',owner,ownerId:owner,grade:'',currency:'GBP',terms:'T/T 100% 预付',incoterm:'FOB 上海',categories:'面料',creditLimit:0,since:'2026-11-01'});
  await db.mistWorkspace.update({where:{id:wid},data:{revision:0,state:state as any}});
 });
 afterAll(async()=>{
  if(db){await db.mistCommandReceipt.deleteMany({where:{workspace:{companyId}}});await db.mistWorkspace.deleteMany({where:{companyId}});await db.auditLog.deleteMany({where:{OR:[{companyId},{actorId:{in:users}}]}});await db.orderApprovalAuthority.deleteMany({where:{companyId}});await db.userRole.deleteMany({where:{userId:{in:users}}});await db.role.deleteMany({where:{companyId}});await db.companyMember.deleteMany({where:{companyId}});await db.userAccount.deleteMany({where:{id:{in:users}}});await db.department.deleteMany({where:{companyId}});await db.company.deleteMany({where:{id:companyId}});await db.$disconnect();}vi.unstubAllEnvs();if(directory)await rm(directory,{recursive:true,force:true});
 });
 const workspace=async(id=boss)=>(await request(app).get('/api/mist/workspaces/'+wid).set('Authorization','Bearer '+tokens[id]).expect(200)).body.workspace;
 const command=async(id:string,type:string,payload:Record<string,unknown>)=>{const w=await workspace(id);return request(app).post('/api/mist/workspaces/'+wid+'/commands').set('Authorization','Bearer '+tokens[id]).send({requestId:randomUUID(),expectedRevision:w.revision,command:{type,payload}});};
 const reviews=async(id:string)=>(await request(app).get('/api/mist/reviews').set('Authorization','Bearer '+tokens[id]).expect(200)).body.reviews;
 const raw=()=>db.mistWorkspace.findUniqueOrThrow({where:{id:wid}});
 const decide=async(id:string,reviewId:string,decision='rejected',signature?:{svg:string})=>{const w=await workspace(boss);return request(app).post('/api/mist/reviews/'+wid+'/'+encodeURIComponent(reviewId)).set('Authorization','Bearer '+tokens[id]).send({requestId:randomUUID(),expectedRevision:w.revision,decision,note:decision==='approved'?'核对原客户PO，按原条件批准合同。':'请补充书面确认',...(signature?{signature}:{})});};
 const createOrder=async(fileId:string,po='PO-001')=>{
  const r=await command(owner,'order.create',{type:'fabric',customerId:'customer',season:'SS28',currency:'GBP',due:'2026-12-28',ownerId:owner,governance:{kind:'external',poNumber:po,confirmationFileIds:[fileId],internalPurpose:'',receiver:'',paymentMethod:'TT',depositPercent:100,preShipmentPercent:100,paymentNote:'T/T 100% 预付',incoterm:'FOB',deliveryPlace:'上海',overPercent:0,shortPercent:0},lines:[{name:'塔丝隆',nameEn:'Taslon',style:po,qty:12,price:2.3,unit:'米',img:'clay'}]});expect(r.status).toBe(200);const w=await workspace(boss);return w.state.orders.find((o:any)=>o.governance.contract.poNumber===po);
 };
 const submit=async()=>{
  const w=await workspace(owner),uploaded=await request(app).post('/api/mist/workspaces/'+wid+'/files').set('Authorization','Bearer '+tokens[owner]).field('requestId',randomUUID()).field('expectedRevision',String(w.revision)).attach('file',Buffer.from('Customer PO:12 metres GBP27.60;100% prepaid;FOB Shanghai'),{filename:'PO.txt',contentType:'text/plain'}).expect(201);
  const fileId=uploaded.body.receipt.result.fileId||uploaded.body.receipt.result.id,order=await createOrder(fileId);const result=await command(owner,'order.governance.submit',{orderId:order.id,approvalSource:{schemaVersion:1,mode:'organization',companyId:'forged',businessLine:'garment',requesterId:boss,departmentSnapshotId:support}});expect(result.status).toBe(200);const state=(await workspace(boss)).state,current=state.orders.find((o:any)=>o.id===order.id),round=current.governance.rounds.at(-1);expect(round.approvalSource).toEqual({schemaVersion:1,mode:'organization',companyId,businessLine:'fabric',requesterId:owner,departmentSnapshotId:fabric});expect([...round.reviewerIds].sort()).toEqual([oldHead,boss].sort());return{order:current,round,reviewId:'order:'+round.id,fileId};
 };
 it.each(['head','requester-department'])('preserves original assignment after %s changes, with no broader order-read grant',async change=>{
  const first=await submit();if(change==='head')await db.department.update({where:{id:fabric},data:{headId:newHead}});else await db.userRole.updateMany({where:{userId:owner,role:{companyId}},data:{departmentId:secondFabric}});
  expect((await reviews(oldHead)).find((r:any)=>r.id===first.reviewId)?.canDecide).toBe(true);expect((await workspace(oldHead)).state.orders.some((o:any)=>o.id===first.order.id)).toBe(false);
  const before=await raw();const unassigned=await decide(newHead,first.reviewId);expect(unassigned.status).toBe(404);expect(await raw()).toEqual(before);expect((await command(oldHead,'order.governance.saveDraft',{orderId:first.order.id,input:first.order.governance.contract})).status).toBe(404);expect(await raw()).toEqual(before);
  const unrelated=await createOrder(first.fileId,'PO-UNRELATED'),beforeExtra=await raw();expect((await command(oldHead,'order.update',{orderId:unrelated.id,season:'SS29'})).status).toBe(404);expect(await raw()).toEqual(beforeExtra);
  const result=change==='head'?await decide(oldHead,first.reviewId):await command(oldHead,'order.governance.decide',{id:first.order.id,decision:'rejected',note:'请补充书面确认',otherOrderId:unrelated.id});expect(result.status,JSON.stringify(result.body.error)).toBe(200);const state=(await workspace(boss)).state,round=state.orders.find((o:any)=>o.id===first.order.id).governance.rounds[0];expect(round.status).toBe('rejected');expect(round.approvalSource).toEqual(first.round.approvalSource);const completed=await raw();expect((completed.state as any).orders.find((o:any)=>o.id===unrelated.id)).toEqual((beforeExtra.state as any).orders.find((o:any)=>o.id===unrelated.id));
  if(change==='requester-department'){const order=await createOrder(first.fileId,'PO-002');expect((await command(owner,'order.governance.submit',{orderId:order.id})).status).toBe(200);const next=(await workspace(boss)).state.orders.find((o:any)=>o.id===order.id).governance.rounds[0];expect(next.approvalSource.departmentSnapshotId).toBe(secondFabric);expect([...next.reviewerIds].sort()).toEqual([newHead,boss].sort());}
 });
 it.each(['approved','rejected'])('allows the current assigned reviewer to decide an ended requester’s valid contract as %s, without rewriting operational ownership',async decision=>{
  const first=await submit();await db.companyMember.updateMany({where:{companyId,userId:owner},data:{status:'suspended'}});expect((await reviews(oldHead)).find((r:any)=>r.id===first.reviewId)?.canDecide).toBe(true);const inactive=await request(app).get('/api/mist/reviews').set('Authorization','Bearer '+tokens[owner]);expect([401,403]).toContain(inactive.status);const result=await decide(oldHead,first.reviewId,decision,decision==='approved'?TEST_SIGNATURE:undefined);expect(result.status).toBe(200);const state=(await workspace(boss)).state,current=state.orders.find((o:any)=>o.id===first.order.id);expect(current.ownerId).toBe(owner);expect(current.governance.rounds[0]).toMatchObject({status:decision,decidedBy:oldHead,approvalSource:first.round.approvalSource});expect(state.decisionSignatures??[]).toHaveLength(decision==='approved'?1:0);
 });
 it.each(['module','domain','explicit'])('does not turn a stored assignment into a bypass of current %s qualification',async loss=>{
  const first=await submit();await db.department.update({where:{id:fabric},data:{headId:newHead}});
  if(loss==='module'){await db.userRole.deleteMany({where:{userId:oldHead,role:{companyId}}});await db.userRole.create({data:{id:randomUUID(),userId:oldHead,roleId:noOrdersRole,departmentId:fabric}});}
  if(loss==='domain')await db.userRole.updateMany({where:{userId:oldHead,role:{companyId}},data:{departmentId:support}});
  if(loss==='explicit')await db.orderApprovalAuthority.create({data:{userId:boss,companyId,businessLine:'fabric',active:true,createdBy:boss}});
  expect((await reviews(oldHead)).find((r:any)=>r.id===first.reviewId)?.canDecide).not.toBe(true);const before=await raw();expect((await decide(oldHead,first.reviewId)).status).toBe(403);expect(await raw()).toEqual(before);
 });
 it('rejects a departed reviewer while keeping the other assigned reviewer queue available',async()=>{
  const first=await submit();await db.companyMember.updateMany({where:{companyId,userId:oldHead},data:{status:'suspended'}});expect((await reviews(boss)).find((r:any)=>r.id===first.reviewId)?.canDecide).toBe(true);const before=await raw(),result=await decide(oldHead,first.reviewId);expect([401,403]).toContain(result.status);expect(await raw()).toEqual(before);
 });
});
