import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadEffectivePermissionScopes } from '../permissionService';
import * as contract from '../../shared/mistWorkspace';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createAuthService } from '../service';
import { createAuthorizationSnapshotGuard } from '../authorizationSnapshotGuard';
import { tenantSurfaceGuard } from '../tenantSurfaceGuard';
import { createMistRouter } from '../../mist/route';
import { createAuthRouter } from '../route';
import { createAdminRouter } from '../../admin/route';
import { createHRRouter } from '../../hr/route';
import { createPlatformRouter } from '../../platform/route';
const url=process.env.MIST_PG_CONFLICT_TEST_URL;
describe.skipIf(!url)('real HTTP company isolation',()=>{
 const key=randomUUID(), companies=[randomUUID(),randomUUID()], user='shared-'+key, outsider='other-'+key, staff='staff-'+key, platform='platform-'+key, depts=['a-'+key,'b-'+key], teams=['ta-'+key,'tb-'+key],position='position-'+key;
 let filesRoot:string; let db:PrismaClient,app:express.Express,tokens:string[],legacy:string,pt:string; const workspaces:string[]=[]; const auth=createAuthService();
 const api=()=>request(app); const bearer=(i=0)=>'Bearer '+tokens[i];
 beforeAll(async()=>{
  db=new PrismaClient({datasourceUrl:url}); filesRoot=await mkdtemp(path.join(tmpdir(),'tenant-files-'));
  for(const id of [user,outsider,platform,staff])await db.userAccount.create({data:{id,email:id+'@example.invalid',displayName:id,status:'active',passwordHash:'unused',...(id===platform?{platformRole:'platform_admin'}:{})}});
  for(let i=0;i<2;i++){
   await db.company.create({data:{id:companies[i],name:'Company '+i,slug:'isolation-'+i+'-'+key}});
   await db.department.create({data:{id:'root-'+companies[i],companyId:companies[i],name:'Root'}});
   await db.department.create({data:{id:depts[i],companyId:companies[i],name:'Dept '+i,parentId:'root-'+companies[i]}});
   await db.role.create({data:{id:'role-super-admin@'+companies[i],companyId:companies[i],code:'role-super-admin',name:'Owner '+i+' '+key,isSystem:true}});
   await db.companyMember.create({data:{companyId:companies[i],userId:user}});
   await db.userRole.create({data:{id:randomUUID(),userId:user,roleId:'role-super-admin@'+companies[i],departmentId:depts[i]}});
   await db.team.create({data:{id:teams[i],name:'Team '+i,departmentId:depts[i]}});
   await db.teamMember.create({data:{id:randomUUID(),teamId:teams[i],userId:user}});
  }
  for(let i=0;i<2;i++) await db.companyMember.create({data:{companyId:companies[i],userId:staff}});
  await db.role.create({data:{id:'role-sales@'+companies[0],companyId:companies[0],code:'role-sales',name:'Sales '+key,isSystem:true}});
  await db.userRole.create({data:{id:randomUUID(),userId:staff,roleId:'role-sales@'+companies[0],departmentId:depts[0]}});
  await db.userRole.create({data:{id:randomUUID(),userId:staff,roleId:'role-super-admin@'+companies[1],departmentId:depts[1]}});
  await db.jobPosition.create({data:{id:position,title:'Company A role',departmentId:depts[0]}});
  await db.employeeProfile.create({data:{id:randomUUID(),companyId:companies[0],userId:staff,employeeNo:'employee-'+key,hireDate:'2026-01-01',positionId:position}});
  tokens=companies.map(companyId=>auth.signToken({userId:user,companyId,roles:['owner'],permissions:[],departmentIds:[]}));
  legacy=auth.signToken({userId:user,roles:['owner'],permissions:[],departmentIds:[]}); pt=auth.signToken({userId:platform,roles:[],permissions:[],departmentIds:[]});
  app=express();app.use(express.json());app.use(cookieParser());app.use('/api',createAuthorizationSnapshotGuard({prisma:db}),tenantSurfaceGuard);
  app.use('/api/admin',createAdminRouter({prisma:db}));app.use('/api/hr',createHRRouter({prisma:db}));app.use('/api/platform',createPlatformRouter({prisma:db}));app.use('/api/auth',createAuthRouter({prisma:db,requireEmailVerification:false,loginRateLimit:false}));app.use('/api/mist',createMistRouter({prisma:db,contract,filesRoot}));
  for(let i=0;i<2;i++){const r=await api().post('/api/mist/workspaces').set('Authorization',bearer(i)).send({name:'Same name',slug:'same-key',seed:'empty'});expect(r.status).toBe(201);workspaces.push(r.body.workspace.id);}
 });
 afterAll(async()=>{if(!db)return;await db.mistCommandReceipt.deleteMany({where:{workspaceId:{in:workspaces}}});await db.mistWorkspace.deleteMany({where:{id:{in:workspaces}}});await db.employeeProfile.deleteMany({where:{userId:staff}});await db.jobPosition.deleteMany({where:{id:position}});await db.teamMember.deleteMany({where:{teamId:{in:teams}}});await db.team.deleteMany({where:{id:{in:teams}}});await db.userRole.deleteMany({where:{userId:{in:[user,outsider,platform,staff]}}});await db.company.deleteMany({where:{id:{in:companies}}});await db.auditLog.deleteMany({where:{actorId:{in:[user,outsider,platform,staff]}}});await db.userPermissionOverrides.deleteMany({where:{userId:{in:[user,outsider,platform,staff]}}});await db.userAccount.deleteMany({where:{id:{in:[user,outsider,platform,staff]}}});await db.$disconnect();await rm(filesRoot,{recursive:true,force:true});});
 it('default entry selects the current company only',async()=>{for(let i=0;i<2;i++){const r=await api().get('/api/mist/workspaces/default').set('Authorization',bearer(i));expect(r.status).toBe(200);expect(r.body.workspace.id).toBe(workspaces[i]);}});
 it('isolates identical names across companies and rejects a second company library',async()=>{expect(workspaces[0]).not.toBe(workspaces[1]);for(let i=0;i<2;i++){const r=await api().post('/api/mist/workspaces').set('Authorization',bearer(i)).send({name:'Same name',slug:'same-key',seed:'empty'});expect(r.status).toBe(409);expect(await db.mistWorkspace.count({where:{companyId:companies[i]}})).toBe(1);}});
 it.each([0,1])('lists only current company %s for a shared owner',async i=>{const r=await api().get('/api/mist/workspaces').set('Authorization',bearer(i));expect(r.status).toBe(200);expect(r.body.workspaces.map((w:any)=>w.id)).toEqual([workspaces[i]]);});
 it.each(['','/revision','/receipts/unknown','/agent/query?type=products'])('hides foreign workspace %s',async suffix=>{expect((await api().get('/api/mist/workspaces/'+workspaces[1]+suffix).set('Authorization',bearer())).status).toBe(404);});
 it('rejects foreign command without changing state',async()=>{const old=await db.mistWorkspace.findUniqueOrThrow({where:{id:workspaces[1]}});const r=await api().post('/api/mist/workspaces/'+workspaces[1]+'/commands').set('Authorization',bearer()).send({requestId:randomUUID(),expectedRevision:0,command:{type:'market.product.save',payload:{name:'Foreign'}}});expect(r.status).toBe(404);expect((await db.mistWorkspace.findUniqueOrThrow({where:{id:workspaces[1]}})).state).toEqual(old.state);});
 it('rejects foreign archive',async()=>{expect((await api().post('/api/mist/workspaces/'+workspaces[1]+'/archive').set('Authorization',bearer()).send({requestId:randomUUID(),expectedRevision:0})).status).toBe(404);});
 it('rejects migrated legacy session',async()=>{expect((await api().get('/api/mist/workspaces').set('Authorization','Bearer '+legacy)).status).toBe(401);});
 it('ignores forged company header',async()=>{const r=await api().get('/api/mist/workspaces').set('Authorization',bearer()).set('x-company-id',companies[1]);expect(r.body.workspaces.map((w:any)=>w.id)).toEqual([workspaces[0]]);});
 it('company owner cannot manage the shared platform AI connection',async()=>{expect((await api().get('/api/mist/ai/platform-model').set('Authorization',bearer())).status).toBe(403);});
 it('company owner is not platform admin',async()=>{expect((await api().get('/api/platform/companies').set('Authorization',bearer())).status).toBe(403);});
 it('platform identity may list companies',async()=>{expect((await api().get('/api/platform/companies').set('Authorization','Bearer '+pt)).status).toBe(200);});
 it.each(['/api/v1/orders','/api/admin/audit-logs','/api/hr/payroll-runs','/api/admin/order-approval-authorities'])('closes unscoped old endpoint %s',async p=>{expect((await api().get(p).set('Authorization',bearer())).status).toBe(403);});
 it('scopes role list',async()=>{const r=await api().get('/api/admin/roles').set('Authorization',bearer());expect(r.status).toBe(200);expect(JSON.stringify(r.body)).not.toContain(companies[1]);});
 it('rejects foreign role without clearing existing grants',async()=>{const r=await api().patch('/api/admin/users/'+user+'/roles').set('Authorization',bearer()).send({roles:['role-super-admin@'+companies[1]],departmentId:depts[0]});expect(r.status).toBe(400);expect(await db.userRole.count({where:{userId:user}})).toBe(2);});
 it('rejects foreign department assignment',async()=>{expect((await api().patch('/api/admin/users/'+user+'/roles').set('Authorization',bearer()).send({roles:[],departmentId:depts[1]})).status).toBe(400);});
 it('preserves other company grants on role replacement',async()=>{const r=await api().patch('/api/admin/users/'+user+'/roles').set('Authorization',bearer()).send({roles:['role-super-admin@'+companies[0]],departmentId:depts[0]});expect(r.status).toBe(200);expect(await db.userRole.count({where:{userId:user}})).toBe(2);});
 it('hides an unassigned account',async()=>{expect((await api().patch('/api/admin/users/'+outsider).set('Authorization',bearer()).send({displayName:'changed'})).status).toBe(404);});
 it.each(['/api/hr/teams','/api/hr/teams/mine','/api/hr/personnel'])('scopes organization endpoint %s',async p=>{const r=await api().get(p).set('Authorization',bearer());expect(r.status).toBe(200);expect(JSON.stringify(r.body)).not.toContain(depts[1]);expect(JSON.stringify(r.body)).not.toContain(teams[1]);});
 it('rejects foreign team mutation',async()=>{expect((await api().patch('/api/hr/teams/'+teams[1]).set('Authorization',bearer()).send({name:'hijacked'})).status).toBeGreaterThanOrEqual(400);expect((await db.team.findUniqueOrThrow({where:{id:teams[1]}})).name).toBe('Team 1');});
 it('keeps assistant delegation in its issuing company',async()=>{const issue=await api().post('/api/mist/agent/delegations').set('Authorization',bearer()).send({});expect(issue.status).toBe(201);expect((await api().get('/api/mist/workspaces/'+workspaces[1]+'/agent/query?type=products').set('x-bambook-delegation',issue.body.delegation.token)).status).toBe(404);});
 it('scopes personal permission grants to the company',async()=>{await db.userPermissionOverrides.create({data:{id:randomUUID(),userId:user,companyId:companies[0],scope:'sensitive:salary',grantedBy:user,reason:'isolation fixture'}});expect(await loadEffectivePermissionScopes(db,user,[],companies[0])).toEqual(['sensitive:salary']);expect(await loadEffectivePermissionScopes(db,user,[],companies[1])).toEqual([]);});
 it('switches company using only memberships and refreshes token',async()=>{const r=await api().post('/api/auth/switch-company').set('Authorization',bearer()).send({companyId:companies[1]});expect(r.status).toBe(200);expect(auth.verifyToken(r.body.token).companyId).toBe(companies[1]);expect(auth.verifyToken(r.body.token).roleIds).toEqual(['role-super-admin@'+companies[1]]);});
 it('rejects switching to an unrelated company',async()=>{expect((await api().post('/api/auth/switch-company').set('Authorization',bearer()).send({companyId:randomUUID()})).status).toBe(403);});
 it('explicit Bearer company wins over another company cookie',async()=>{const r=await api().get('/api/mist/workspaces').set('Authorization',bearer()).set('Cookie','bambook_token='+tokens[1]);expect(r.body.workspaces.map((w:any)=>w.id)).toEqual([workspaces[0]]);});
 it('real attachment is private to its company',async()=>{const current=await db.mistWorkspace.findUniqueOrThrow({where:{id:workspaces[0]}});const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2kAAAAASUVORK5CYII=','base64');const upload=await api().post('/api/mist/workspaces/'+workspaces[0]+'/files').set('Authorization',bearer()).field('requestId',randomUUID()).field('expectedRevision',String(current.revision)).attach('file',png,'sample.png');expect(upload.status).toBe(201);const fileId=upload.body.workspace.state.files[0].id;expect((await api().get('/api/mist/workspaces/'+workspaces[0]+'/files/'+fileId).set('Authorization',bearer())).status).toBe(200);expect((await api().get('/api/mist/workspaces/'+workspaces[0]+'/files/'+fileId).set('Authorization',bearer(1))).status).toBe(404);});
 it('rejects a foreign attachment upload before storing a file',async()=>{expect((await api().post('/api/mist/workspaces/'+workspaces[1]+'/files').set('Authorization',bearer()).field('requestId',randomUUID()).field('expectedRevision','0').attach('file',Buffer.from('private'),'note.txt')).status).toBe(404);});
 it('foreign approval actions and evidence cannot be accessed',async()=>{expect((await api().post('/api/mist/reviews/'+workspaces[1]+'/unknown').set('Authorization',bearer()).send({requestId:randomUUID(),expectedRevision:0,decision:'approved',note:'isolation check'})).status).toBe(404);expect((await api().get('/api/mist/reviews/'+workspaces[1]+'/unknown/files/unknown').set('Authorization',bearer())).status).toBe(404);});
 it('owner in B cannot borrow owner authority while working in A',async()=>{const token=auth.signToken({userId:staff,companyId:companies[0],roles:['owner'],permissions:['users:admin'],departmentIds:[]});const r=await api().get('/api/admin/users').set('Authorization','Bearer '+token);expect(r.status).toBe(403);const me=await api().get('/api/auth/me').set('Authorization','Bearer '+token);expect(me.status).toBe(200);expect(me.body.user.roles).not.toContain('owner');expect(me.body.user.roleIds).toEqual(['role-sales@'+companies[0]]);});
 it('employee profile from A is not exposed in B for a shared account',async()=>{expect((await api().get('/api/hr/employees/'+staff).set('Authorization',bearer())).status).toBe(200);expect((await api().get('/api/hr/employees/'+staff).set('Authorization',bearer(1))).status).toBe(404);});
 it('platform staff cannot switch into or read a customer company',async()=>{expect((await api().post('/api/auth/switch-company').set('Authorization','Bearer '+pt).send({companyId:companies[0]})).status).toBe(403);const forged=auth.signToken({userId:platform,companyId:companies[0],roles:['owner'],permissions:['*'],departmentIds:[]});expect((await api().get('/api/mist/workspaces').set('Authorization','Bearer '+forged)).status).toBe(403);});
 it('company administrators cannot grant the company owner role by its scoped id',async()=>{await db.userPermissionOverrides.create({data:{id:randomUUID(),userId:staff,companyId:companies[0],scope:'users:admin',grantedBy:user,reason:'administrator fixture'}});const token=auth.signToken({userId:staff,companyId:companies[0],roles:['owner'],permissions:[],departmentIds:[]});expect((await api().patch('/api/admin/users/'+user+'/roles').set('Authorization','Bearer '+token).send({roles:['role-super-admin@'+companies[0]],departmentId:depts[0]})).status).toBe(403);});
 it('suspension invalidates current session immediately',async()=>{await db.company.update({where:{id:companies[0]},data:{status:'suspended'}});try{expect((await api().get('/api/mist/workspaces').set('Authorization',bearer())).status).toBe(403);}finally{await db.company.update({where:{id:companies[0]},data:{status:'active'}});}});
 it('a valid password with every company suspended is a clear access denial, not a server failure',async()=>{
  const password='IsolatedPassword43!';await db.userAccount.update({where:{id:user},data:{passwordHash:await auth.hashPassword(password)}});
  await db.companyMember.updateMany({where:{userId:user},data:{status:'suspended'}});
  try{const response=await api().post('/api/auth/login').send({email:user+'@example.invalid',password});expect(response.status).toBe(403);expect(response.body.error).toBe('COMPANY_ACCESS_DENIED');expect(response.body.token).toBeUndefined();}
  finally{await db.companyMember.updateMany({where:{userId:user},data:{status:'active'}});}
 });
 it('membership removal invalidates current session immediately',async()=>{await db.companyMember.updateMany({where:{companyId:companies[0],userId:user},data:{status:'left'}});try{expect((await api().get('/api/mist/workspaces').set('Authorization',bearer())).status).toBe(403);}finally{await db.companyMember.updateMany({where:{companyId:companies[0],userId:user},data:{status:'active'}});}});
 it('applies row scope to real PostgreSQL sessions while sharing marketing and seasonal materials',async()=>{
  const roleId='role-sales@'+companies[0], permissionLinks:string[]=[], original=await db.mistWorkspace.findUniqueOrThrow({where:{id:workspaces[0]}}), department=await db.department.findUniqueOrThrow({where:{id:depts[0]}});
  try{
   for(const scope of ['orders:read','orders:write','marketing:read','seasons:read']){
    const permission=await db.permission.upsert({where:{scope},create:{id:'p3-'+scope,scope},update:{}}), id=randomUUID();
    await db.rolePermission.create({data:{id,roleId,permissionId:permission.id}});permissionLinks.push(id);
   }
   await db.department.update({where:{id:depts[0]},data:{metadata:{businessAttributes:['garment_business']}}});
   let n=0;const ctx:any={id:()=>`pg-scope-${++n}`,now:'2026-10-13T00:00:00Z',actorName:'fixture',actorId:user};
   const state:any=contract.createMistState(ctx,'demo');
   const [first,second]=state.orders;state.customers=state.customers.slice(0,2);state.customers[0].ownerId=staff;state.customers[1].ownerId=user;
   state.orders=[{...first,id:'pg-own',customerId:state.customers[0].id,ownerId:staff,governance:undefined,checklist:[{id:'pg-check-own',done:false,note:''}]},{...second,id:'pg-hidden',customerId:state.customers[1].id,ownerId:user,governance:undefined,checklist:[{id:'pg-check-hidden',done:false,note:''}]}];
   state.orderLines=[];state.devs=[];state.versions=[];state.rounds=[];state.crm.opportunities=[];state.market.quotations=[];
   state.market.leads=[{id:'pg-shared-lead',name:'Shared',company:'Example',email:'',phone:'',demand:'',source:'show',parentId:'',customerId:'',status:'New',followUpDate:'',estimatedValue:'',actualValue:'',currency:'USD',convertedAt:null,createdAt:ctx.now,updatedAt:ctx.now,fileIds:[],note:''}];
   await db.mistCommandReceipt.deleteMany({where:{workspaceId:workspaces[0]}});
   await db.mistWorkspace.update({where:{id:workspaces[0]},data:{state,revision:0}});
   const token=auth.signToken({userId:staff,companyId:companies[0],roles:[],permissions:[],departmentIds:[]});
   const get=()=>api().get('/api/mist/workspaces/'+workspaces[0]).set('Authorization','Bearer '+token);
   const view=await get();expect(view.status).toBe(200);expect(view.body.workspace.state.orders.map((row:any)=>row.id)).toEqual(['pg-own']);expect(view.body.workspace.state.market.leads.map((row:any)=>row.id)).toEqual(['pg-shared-lead']);
   const command=(orderId:string,itemId:string)=>api().post('/api/mist/workspaces/'+workspaces[0]+'/commands').set('Authorization','Bearer '+token).send({requestId:randomUUID(),expectedRevision:0,command:{type:'order.checklist',payload:{orderId,itemId,done:true}}});
   const denied=await command('pg-hidden','pg-check-hidden');expect(denied.status,JSON.stringify(denied.body)).toBe(404);
   const deniedUpdate=await api().post('/api/mist/workspaces/'+workspaces[0]+'/commands').set('Authorization','Bearer '+token).send({requestId:randomUUID(),expectedRevision:0,command:{type:'order.update',payload:{orderId:'pg-hidden',season:'AW27'}}});expect(deniedUpdate.status,JSON.stringify(deniedUpdate.body)).toBe(404);
   const saved=await api().post('/api/mist/workspaces/'+workspaces[0]+'/commands').set('Authorization','Bearer '+token).send({requestId:randomUUID(),expectedRevision:0,command:{type:'order.update',payload:{orderId:'pg-own'}}});expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect(saved.body.workspace.state.orders.map((row:any)=>row.id)).toEqual(['pg-own']);
  }finally{
   await db.mistWorkspace.update({where:{id:workspaces[0]},data:{state:original.state as any,revision:original.revision,name:original.name}});
   await db.department.update({where:{id:depts[0]},data:{metadata:department.metadata as any}});
   await db.rolePermission.deleteMany({where:{id:{in:permissionLinks}}});
  }
 });

});
