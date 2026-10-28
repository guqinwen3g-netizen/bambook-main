import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {createPlatformRouter} from './route';
import {COMPANY_SYSTEM_ROLE_CODES,provisionCompanyRoles} from './companyProvisioning';
import {SYSTEM_ROLE_META,getDefaultScopeListForRole,type SystemRoleId} from '../_shared/rolePermissionMatrix';
import {createAuthService} from '../auth/service';
import {createAuthRouter} from '../auth/route';
import {createAuthorizationSnapshotGuard} from '../auth/authorizationSnapshotGuard';
import {requirePermission} from '../auth/permissionGuard';
import {createPlatformCompanySettings} from './companySettings';
import {createAdminRouter} from '../admin/route';

const url=process.env.TEST_DATABASE_URL;
describe.runIf(url)('independent company administration and explicit onboarding',()=>{
 const key=randomUUID(),platformId='platform-'+key,password='SyntheticCompany7!';
 const auth=createAuthService(),companies:string[]=[],users:string[]=[platformId],templates:string[]=[];
 let db:PrismaClient,app:express.Express,platformToken:string,operatorId:string,operatorCompany:string,operatorToken:string;
 const post=(body:any)=>request(app).post('/api/platform/companies').set('Authorization','Bearer '+platformToken).send(body);
 beforeAll(async()=>{
  db=new PrismaClient({datasourceUrl:url});
  for(const code of COMPANY_SYSTEM_ROLE_CODES)if(!await db.role.findUnique({where:{id:code}})){
   await db.role.create({data:{id:code,name:SYSTEM_ROLE_META[code as SystemRoleId].name,isSystem:true}});templates.push(code);
  }
  await db.userAccount.create({data:{id:platformId,displayName:'平台管理员',email:platformId+'@example.invalid',platformRole:'platform_admin',status:'active'}});
  platformToken=auth.signToken({userId:platformId,roles:[],permissions:[],departmentIds:[]});
  app=express();app.use(express.json());app.use(cookieParser());app.use('/api/platform',createPlatformRouter({prisma:db}));
  app.use('/auth',createAuthRouter({prisma:db,requireEmailVerification:false,loginRateLimit:false}));
  app.use('/check',createAuthorizationSnapshotGuard({prisma:db}));
  app.use('/api/admin',createAuthorizationSnapshotGuard({prisma:db}),createAdminRouter({prisma:db}));
  for(const [path,scope] of [['management','users:admin'],['finance','vouchers:write'],['qc','qc:inspect'],['approval','orders:approve'],['suppliers','suppliers:write'],['marketing','marketing:write'],['pricing','pricing:write']])app.post('/check/'+path,requirePermission(scope as any),(_req,res)=>res.json({ok:true}));
 });
 afterAll(async()=>{
  if(!db)return;
  await db.mistCommandReceipt.deleteMany({where:{workspace:{companyId:{in:companies}}}});
  await db.mistWorkspace.deleteMany({where:{companyId:{in:companies}}});
  await db.auditLog.deleteMany({where:{actorId:{in:users}}});
  await db.company.deleteMany({where:{id:{in:companies}}});
  await db.userAccount.deleteMany({where:{id:{in:users}}});
  await db.permission.deleteMany({where:{id:'users-admin-'+key}});
  await db.role.deleteMany({where:{id:{in:templates}}});await db.$disconnect();
 });
 it('opens an ordinary company with a salesperson administrator and an explicitly supplied initial password',async()=>{
  const email='operator-'+key+'@example.invalid';
  const result=await post({name:'青屿纺织服饰',slug:'operator-'+key,ownerName:'公司操作员',ownerEmail:email,ownerRoleCode:'role-sales',deliveryMode:'password',initialPassword:password});
  expect(result.status).toBe(201);operatorId=result.body.owner.id;operatorCompany=result.body.company.id;users.push(operatorId);companies.push(operatorCompany);
  expect(result.body.invitation.status).toBe('manual');expect(JSON.stringify(result.body)).not.toContain(password);
  const company=await db.company.findUnique({where:{id:operatorCompany}});expect(company?.settings).toMatchObject({administratorIds:[operatorId]});
  const roles=await db.userRole.findMany({where:{userId:operatorId},include:{role:true}});expect(roles.map(row=>row.role.code)).toEqual(['role-sales']);
  const member=await db.companyMember.findUnique({where:{companyId_userId:{companyId:operatorCompany,userId:operatorId}}});expect(member?.jobTitle).toBe('业务员');
  const login=await request(app).post('/auth/login').send({email,password});expect(login.status).toBe(200);operatorToken=login.body.token;
  const payload=auth.verifyToken(operatorToken);expect(payload.companyId).toBe(operatorCompany);expect(payload.globalBusinessScope).toBe(false);expect(payload.roles).not.toContain('owner');
  const audit=await db.auditLog.findFirst({where:{action:'platform.company.create',targetId:operatorCompany}});expect(JSON.stringify(audit)).not.toContain(password);
 });
 it('initializes current standard company duties and allows the normal salesperson business actions',async()=>{
  for(const code of COMPANY_SYSTEM_ROLE_CODES){
   const grants=await db.rolePermission.findMany({where:{roleId:code+'@'+operatorCompany},include:{permission:true}});
   expect(grants.map(row=>row.permission.scope).sort(),code).toEqual(getDefaultScopeListForRole(code as SystemRoleId).sort());
  }
  for(const path of ['suppliers','marketing','pricing'])expect((await request(app).post('/check/'+path).set('Authorization','Bearer '+operatorToken)).status,path).toBe(200);
 });
 it('keeps administration separate from finance, quality signing and approval authority',async()=>{
  for(const [path,status] of [['management',200],['finance',403],['qc',403],['approval',403]] as const){
   const result=await request(app).post('/check/'+path).set('Authorization','Bearer '+operatorToken);expect(result.status,path).toBe(status);
  }
 });
 it('does not copy a stale global template with an unrelated finance grant into new company jobs',async()=>{
  const rollback=new Error('rollback-role-template-fixture');
  await expect(db.$transaction(async tx=>{
   const companyId=randomUUID();await tx.company.create({data:{id:companyId,slug:companyId,name:'Default role fixture'}});
   const finance=await tx.permission.upsert({where:{scope:'vouchers:write'},update:{},create:{id:randomUUID(),scope:'vouchers:write'}});
   const legacy=new Proxy(tx,{get(target,name){if(name==='rolePermission')return new Proxy(target.rolePermission,{get(delegate,method){if(method==='findMany')return async(args:any)=>args?.where?.roleId==='role-sales'?[{permissionId:finance.id}]:[];const value=Reflect.get(delegate,method);return typeof value==='function'?value.bind(delegate):value;}});return Reflect.get(target,name);}});
   await provisionCompanyRoles(legacy,companyId);
   const grants=await tx.rolePermission.findMany({where:{roleId:'role-sales@'+companyId},include:{permission:true}});
   expect(grants.map(row=>row.permission.scope).sort()).toEqual(getDefaultScopeListForRole('role-sales').sort());
   expect(grants.some(row=>row.permission.scope==='vouchers:write')).toBe(false);
   throw rollback;
  })).rejects.toBe(rollback);
 });
 it('preserves explicit existing company job changes when provisioning is repeated',async()=>{
  const rollback=new Error('rollback-custom-role-fixture');
  await expect(db.$transaction(async tx=>{
   const roleId='role-sales@'+operatorCompany,permission=await tx.permission.findUniqueOrThrow({where:{scope:'suppliers:write'}});
   await tx.rolePermission.upsert({where:{roleId_permissionId:{roleId:'role-sales',permissionId:permission.id}},update:{},create:{id:randomUUID(),roleId:'role-sales',permissionId:permission.id}});
   await tx.rolePermission.deleteMany({where:{roleId,permissionId:permission.id}});
   const before=await tx.rolePermission.findMany({where:{roleId},orderBy:{permissionId:'asc'}});
   await provisionCompanyRoles(tx,operatorCompany);
   expect(await tx.rolePermission.findMany({where:{roleId},orderBy:{permissionId:'asc'}})).toEqual(before);
   throw rollback;
  })).rejects.toBe(rollback);
 });
 it('can initialize company settings with an explicit administrator who has no manager job',async()=>{
  const service=createPlatformCompanySettings(db);
  const result=await service.update(auth.verifyToken(platformToken),operatorCompany,{requestId:'initialize-'+key,expectedRevision:0,patch:{workspaceName:'青屿服饰'}});
  expect(result.snapshot.revision).toBe(1);expect(result.snapshot.ownerId).toBe(operatorId);
 });
 it('requires explicit authorization configuration on every request, with no privilege from a mailbox or display name',async()=>{
  await db.company.update({where:{id:operatorCompany},data:{settings:{administratorIds:[]}}});
  const denied=await request(app).post('/check/management').set('Authorization','Bearer '+operatorToken);expect(denied.status).toBe(403);
  await db.company.update({where:{id:operatorCompany},data:{settings:{administratorIds:[operatorId]}}});
 });
 it('keeps general-manager powers only when that business job is explicitly selected',async()=>{
  const email='manager-'+key+'@example.invalid';
  const result=await post({name:'商务岗位独立',slug:'manager-'+key,ownerName:'总经理',ownerEmail:email,ownerRoleCode:'role-super-admin',deliveryMode:'password',initialPassword:password});
  expect(result.status).toBe(201);users.push(result.body.owner.id);companies.push(result.body.company.id);
  const login=await request(app).post('/auth/login').send({email,password});expect(login.status).toBe(200);
  const approved=await request(app).post('/check/approval').set('Authorization','Bearer '+login.body.token);expect(approved.status).toBe(200);
 });
 it('validates initial passwords and cannot overwrite an existing account password',async()=>{
  const weak=await post({name:'无效密码',slug:'weak-'+key,ownerEmail:'weak-'+key+'@example.invalid',deliveryMode:'password',initialPassword:'123'});expect(weak.status).toBe(400);
  expect(await db.company.count({where:{slug:'weak-'+key}})).toBe(0);
  const before=await db.userAccount.findUnique({where:{id:operatorId}});
  const existing=await post({name:'重复账号',slug:'existing-'+key,ownerEmail:before!.email,deliveryMode:'password',initialPassword:'DifferentPassword7!'});expect(existing.status).toBe(409);
  expect((await db.userAccount.findUnique({where:{id:operatorId}}))?.passwordHash).toBe(before!.passwordHash);
  expect(await db.company.count({where:{slug:'existing-'+key}})).toBe(0);
 });
 it('protects the last explicit company administrator even when that person is not a manager',async()=>{
  const result=await request(app).delete(`/api/platform/companies/${operatorCompany}/members/${operatorId}`).set('Authorization','Bearer '+platformToken);
  expect(result.status).toBe(409);
 });
 it('exposes a first-manager capability only to the explicit administrator of an unconfigured company',async()=>{
  const directory=await request(app).get('/api/admin/users').set('Authorization','Bearer '+operatorToken);
  expect(directory.status).toBe(200);expect(directory.body.capabilities).toEqual({canAppointInitialGeneralManager:true});
  await db.company.update({where:{id:operatorCompany},data:{settings:{administratorIds:[]}}});
  const denied=await request(app).get('/api/admin/users').set('Authorization','Bearer '+operatorToken);expect(denied.status).toBe(403);
  await db.company.update({where:{id:operatorCompany},data:{settings:{administratorIds:[operatorId]}}});
 });
 it('requires explicit first-manager confirmation and cannot promote the administrator or reuse an account',async()=>{
  const root=await db.department.findFirstOrThrow({where:{companyId:operatorCompany,parentId:null}});
  const departmentId='management-'+key;await db.department.create({data:{id:departmentId,name:'总经办',companyId:operatorCompany,parentId:root.id}});
  const body={displayName:'总经理',email:'first-manager-'+key+'@example.invalid',password,roles:['role-super-admin@'+operatorCompany],departmentId};
  const create=(data:any)=>request(app).post('/api/admin/users').set('Authorization','Bearer '+operatorToken).send(data);
  expect((await create(body)).status).toBe(403);
  const before=await db.userAccount.findUniqueOrThrow({where:{id:operatorId}});
  expect((await create({...body,email:before.email,appointInitialGeneralManager:true})).status).toBe(409);
  expect((await db.userAccount.findUniqueOrThrow({where:{id:operatorId}})).passwordHash).toBe(before.passwordHash);
  expect(await db.userRole.count({where:{userId:operatorId,role:{code:'role-super-admin'}}})).toBe(0);
 });
 it('does not offer bootstrap to a business administrator without the explicit system duty',async()=>{
  const id='business-admin-'+key;users.push(id);
  await db.userAccount.create({data:{id,displayName:'业务管理',email:id+'@example.invalid',passwordHash:await auth.hashPassword(password),status:'active'}});
  await db.companyMember.create({data:{id:randomUUID(),companyId:operatorCompany,userId:id}});
  await db.userRole.create({data:{id:randomUUID(),userId:id,roleId:'role-admin@'+operatorCompany,departmentId:'management-'+key}});
  const login=await request(app).post('/auth/login').send({email:id+'@example.invalid',password});expect(login.status).toBe(200);
  const directory=await request(app).get('/api/admin/users').set('Authorization','Bearer '+login.body.token);expect(directory.status).toBe(200);expect(directory.body.capabilities.canAppointInitialGeneralManager).toBe(false);
  const denied=await request(app).post('/api/admin/users').set('Authorization','Bearer '+login.body.token).send({displayName:'不可指定',email:'denied-'+key+'@example.invalid',password,roles:['role-super-admin@'+operatorCompany],departmentId:'management-'+key,appointInitialGeneralManager:true});expect(denied.status).toBe(403);
  expect(await db.userAccount.count({where:{email:'denied-'+key+'@example.invalid'}})).toBe(0);
 });
 it('checks company capacity and rolls back the initial appointment if its audit cannot be written',async()=>{
  const email='rollback-manager-'+key+'@example.invalid';
  const body={displayName:'总经理',email,password,roles:['role-super-admin@'+operatorCompany],departmentId:'management-'+key,appointInitialGeneralManager:true};
  const company=await db.company.findUniqueOrThrow({where:{id:operatorCompany}});
  await db.company.update({where:{id:operatorCompany},data:{seatLimit:1}});
  const full=await request(app).post('/api/admin/users').set('Authorization','Bearer '+operatorToken).send(body);expect(full.status).toBe(409);expect(full.body.error).toBe('SEAT_LIMIT_REACHED');
  await db.company.update({where:{id:operatorCompany},data:{seatLimit:company.seatLimit}});
  const failing=new Proxy(db,{get(target,name){if(name==='$transaction')return (fn:any)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,n){return n==='auditLog'?{create:async()=>{throw Error('audit unavailable');}}:Reflect.get(t,n);}})));const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;}});
  const failApp=express();failApp.use(express.json());failApp.use(createAuthorizationSnapshotGuard({prisma:db}));failApp.use('/api/admin',createAdminRouter({prisma:failing}));
  const failed=await request(failApp).post('/api/admin/users').set('Authorization','Bearer '+operatorToken).send(body);expect(failed.status).toBe(500);
  expect(await db.userAccount.count({where:{email}})).toBe(0);
  expect((await db.company.findUniqueOrThrow({where:{id:operatorCompany}})).settings).toEqual(company.settings);
 });
 it('appoints only one initial manager under concurrent requests and preserves the business-role boundary',async()=>{
  const create=(suffix:string)=>request(app).post('/api/admin/users').set('Authorization','Bearer '+operatorToken).send({displayName:'总经理'+suffix,email:'first-manager-'+suffix+'-'+key+'@example.invalid',password,roles:['role-super-admin@'+operatorCompany],departmentId:'management-'+key,appointInitialGeneralManager:true});
  const results=await Promise.all([create('a'),create('b')]);
  for(const result of results)if(result.body.userId)users.push(result.body.userId);
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  const manager=results.find(r=>r.status===200)!.body.userId;
  expect(await db.companyMember.count({where:{companyId:operatorCompany,userId:manager,status:'active'}})).toBe(1);
  expect((await db.company.findUniqueOrThrow({where:{id:operatorCompany}})).settings).toMatchObject({administratorIds:[operatorId],generalManagerAppointedAt:expect.any(String)});
  const audit=await db.auditLog.findFirst({where:{actorId:operatorId,action:'appoint_initial_general_manager'}});
  expect(audit?.targetId).toBe(manager);expect(JSON.stringify(audit)).not.toContain(password);
  const listing=await request(app).get('/api/admin/users').set('Authorization','Bearer '+operatorToken);expect(listing.body.capabilities.canAppointInitialGeneralManager).toBe(false);
  expect((await request(app).post('/check/approval').set('Authorization','Bearer '+operatorToken)).status).toBe(403);
  expect((await request(app).patch('/api/admin/users/'+manager+'/roles').set('Authorization','Bearer '+operatorToken).send({roles:['role-sales@'+operatorCompany],departmentId:'management-'+key})).status).toBe(403);
  // An inactive/removed manager is a recovery case, never a fresh company bootstrap.
  await db.userRole.deleteMany({where:{userId:manager}});
  expect((await create('c')).status).toBe(409);
 });
});
