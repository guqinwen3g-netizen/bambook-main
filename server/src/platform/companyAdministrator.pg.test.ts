import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {createPlatformRouter} from './route';
import {COMPANY_SYSTEM_ROLE_CODES} from './companyProvisioning';
import {SYSTEM_ROLE_META,type SystemRoleId} from '../_shared/rolePermissionMatrix';
import {createAuthService} from '../auth/service';
import {createAuthRouter} from '../auth/route';
import {createAuthorizationSnapshotGuard} from '../auth/authorizationSnapshotGuard';
import {requirePermission} from '../auth/permissionGuard';
import {createPlatformCompanySettings} from './companySettings';

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
  for(const [path,scope] of [['management','users:admin'],['finance','vouchers:write'],['qc','qc:inspect'],['approval','orders:approve']])app.post('/check/'+path,requirePermission(scope as any),(_req,res)=>res.json({ok:true}));
 });
 afterAll(async()=>{
  if(!db)return;
  await db.mistCommandReceipt.deleteMany({where:{workspace:{companyId:{in:companies}}}});
  await db.mistWorkspace.deleteMany({where:{companyId:{in:companies}}});
  await db.auditLog.deleteMany({where:{actorId:{in:users}}});
  await db.company.deleteMany({where:{id:{in:companies}}});
  await db.userAccount.deleteMany({where:{id:{in:users}}});
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
 it('allows only system management and denies finance, quality signing and business approvals',async()=>{
  for(const [path,status] of [['management',200],['finance',403],['qc',403],['approval',403]] as const){
   const result=await request(app).post('/check/'+path).set('Authorization','Bearer '+operatorToken);expect(result.status,path).toBe(status);
  }
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
});
